import { type Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import { type Dispatcher, errors } from 'undici';

import {
  FetcherError,
  ResponseTooLargeError,
  UnsupportedContentEncodingError,
  UnsupportedContentTypeError,
  UpstreamUnreachableError,
} from './fetcher.errors.js';

type ResponseData = Dispatcher.ResponseData;

// Content-Encoding values we decode (docs/adr/0002-safe-fetcher.md, rule 6).
// A Map, not an object: "constructor" or "toString" must not be found.
const DECODERS: ReadonlyMap<string, (() => Transform) | null> = new Map([
  ['identity', null],
  ['gzip', createGunzip],
  ['x-gzip', createGunzip],
  ['deflate', createInflate],
  ['br', createBrotliDecompress],
]);

/**
 * Reads the body of a final 2xx page response: checks the Content-Type
 * before reading anything, decodes the Content-Encoding and counts the
 * decoded bytes while streaming, so a compressed "bomb" is stopped as soon
 * as it passes `maxBytes`. The text is decoded with the header charset, or
 * UTF-8 when the charset is missing or unknown.
 */
export async function readHtmlBody(
  response: ResponseData,
  maxBytes: number,
): Promise<string> {
  const { headers, body } = response;

  const contentType = parseContentType(headers['content-type']);
  if (contentType?.mediaType !== 'text/html') {
    discardBody(body);
    throw new UnsupportedContentTypeError();
  }

  const decoder = pickDecoder(headers['content-encoding']);
  if (decoder === undefined) {
    discardBody(body);
    throw new UnsupportedContentEncodingError();
  }

  // Content-Length counts bytes on the wire. Only without an encoding does
  // it equal the decoded size, so only then can it reject early. It is never
  // trusted to allow a body: the counter below always runs.
  const contentLength = Number(headers['content-length']);
  if (decoder === null && contentLength > maxBytes) {
    discardBody(body);
    throw new ResponseTooLargeError();
  }

  const chunks: Buffer[] = [];
  let total = 0;
  // The last stream of the pipeline: it counts and collects, it outputs nothing.
  const counter = new Writable({
    write(chunk: Buffer, _encoding, done) {
      total += chunk.length;
      if (total > maxBytes) {
        done(new ResponseTooLargeError());
        return;
      }
      chunks.push(chunk);
      done();
    },
  });

  const decoding = decoder?.() ?? null;
  // Remember an error the decoder raised itself (a corrupt body). pipeline
  // destroys every stream with the first error, so after a body error
  // (connection reset, timeout abort) the decoder emits that error too, and
  // after a decoder error the body does. The stream that fails first wins.
  let bodyFailed = false;
  let decoderError: unknown;
  body.once('error', () => {
    bodyFailed = true;
  });
  decoding?.once('error', (error) => {
    if (!bodyFailed) {
      decoderError = error;
    }
  });

  try {
    // pipeline destroys every stream on error, which also closes the socket.
    await (decoding
      ? pipeline(body, decoding, counter)
      : pipeline(body, counter));
  } catch (error) {
    // Our own errors first: pipeline destroys the decoder with the counter's
    // ResponseTooLargeError, so the decoder "fails" with it too.
    if (error instanceof FetcherError) {
      throw error;
    }
    if (error !== undefined && error === decoderError) {
      throw new UpstreamUnreachableError({ cause: error });
    }
    throw error;
  }

  return decodeText(Buffer.concat(chunks), contentType.charset);
}

/** Destroys a body without reading it (redirects, errors, rejections). */
export function discardBody(body: ResponseData['body']): void {
  // An unfinished undici body emits RequestAbortedError when destroyed.
  body.on('error', ignoreExpectedAbort).destroy();
}

/**
 * Error listener for a body destroyed on purpose: ignores the expected
 * RequestAbortedError and reports anything else as a process warning,
 * instead of silently swallowing it.
 */
export function ignoreExpectedAbort(error: unknown): void {
  if (!(error instanceof errors.RequestAbortedError)) {
    process.emitWarning(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}

type ContentType = { mediaType: string; charset: string | undefined };

/** "text/html; charset=UTF-8" → { mediaType: 'text/html', charset: 'UTF-8' } */
function parseContentType(
  header: string | string[] | undefined,
): ContentType | undefined {
  // A missing or repeated header is not a reliable media type.
  if (typeof header !== 'string') {
    return undefined;
  }
  const [type = '', ...params] = header.split(';');
  let charset: string | undefined;
  for (const param of params) {
    const [name = '', value = ''] = param.split('=');
    if (name.trim().toLowerCase() === 'charset') {
      charset = value.trim().replace(/^"(.*)"$/, '$1');
    }
  }
  return { mediaType: type.trim().toLowerCase(), charset };
}

/**
 * The decoder factory for the header, null for no encoding, or undefined
 * for an unknown or stacked encoding.
 */
function pickDecoder(
  header: string | string[] | undefined,
): (() => Transform) | null | undefined {
  if (header === undefined) {
    return null;
  }
  // A repeated header means stacked encodings: rejected.
  if (typeof header !== 'string') {
    return undefined;
  }
  // Only one known value matches exactly, so a stacked value such as
  // "gzip, br" is not found and rejected too.
  const encoding = header.trim().toLowerCase();
  return encoding === '' ? null : DECODERS.get(encoding);
}

function decodeText(bytes: Buffer, charset: string | undefined): string {
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(bytes);
  } catch {
    // Unknown charset label (TextDecoder throws a RangeError): UTF-8.
    return new TextDecoder('utf-8').decode(bytes);
  }
}
