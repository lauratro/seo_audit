import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Agent, type Dispatcher, request } from 'undici';

import {
  DNS_RESOLVER,
  FETCH_POLICY,
  type FetchPolicy,
  type Resolver,
} from '../fetch-policy.js';
import {
  FetcherError,
  FetchTimeoutError,
  TooManyRedirectsError,
  UpstreamUnreachableError,
} from '../fetcher.errors.js';
import { discardBody, readHtmlBody } from '../read-html-body.js';
import { createSafeLookup } from '../safe-lookup.js';

export const USER_AGENT =
  'SEOAuditTool/0.1 (+https://github.com/lauratro/seo_audit)';

/** One redirect that was followed: the URL that answered, and its status. */
export interface RedirectHop {
  url: string;
  status: number;
}

/** The response of the audited page. 4xx/5xx are results, not errors. */
export interface FetchResult {
  status: number;
  headers: Record<string, string>;
  finalUrl: URL;
  /** Redirects followed before the final response, in order. */
  redirects: RedirectHop[];
  body: string | null;
}

/** ADR 0002, rule 4: at most 5 redirects, i.e. at most 6 requests. */
export const MAX_REDIRECTS = 5;

/** ADR 0002, rule 5: default and maximum deadline for the whole operation. */
export const MAX_DEADLINE_MS = 10_000;

export interface FetchPageOptions {
  /** Shorter deadline in ms; can only tighten MAX_DEADLINE_MS. */
  deadlineMs?: number;
  /** Smaller limit on decoded body bytes; can only tighten MAX_BODY_BYTES. */
  maxBytes?: number;
}

/** ADR 0002, rule 6: default and maximum decoded body size (5 MiB). */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export { ignoreExpectedAbort } from '../read-html-body.js';

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301, 302, 303, 307, 308,
]);

// undici's own timeouts: a second layer behind the deadline.
const TIMEOUT_CODES: ReadonlySet<string> = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

// Socket and TLS error codes that mean "the website could not be reached".
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
]);

/**
 * The only way the API makes requests to user-supplied URLs
 * (docs/adr/0002-safe-fetcher.md). Every connection goes through the safe
 * lookup, so the socket only ever connects to an address that passed the
 * IP policy.
 */
@Injectable()
export class SafeFetcherService implements OnModuleDestroy {
  private readonly agent: Agent;

  constructor(
    @Inject(FETCH_POLICY) private readonly policy: FetchPolicy,
    @Inject(DNS_RESOLVER) resolver: Resolver,
  ) {
    // undici's per-phase timeouts never exceed the deadline; the deadline
    // signal below is what actually bounds the operation.
    this.agent = new Agent({
      headersTimeout: MAX_DEADLINE_MS,
      bodyTimeout: MAX_DEADLINE_MS,
      connect: {
        lookup: createSafeLookup(resolver, policy.isAllowedAddress),
        timeout: MAX_DEADLINE_MS,
      },
    });
  }

  async fetchPage(
    input: string,
    options: FetchPageOptions = {},
  ): Promise<FetchResult> {
    const deadlineMs = checkLimit(
      'deadlineMs',
      options.deadlineMs,
      MAX_DEADLINE_MS,
    );
    const maxBytes = checkLimit('maxBytes', options.maxBytes, MAX_BODY_BYTES);
    // One signal for the whole operation: DNS, connect, every redirect hop,
    // headers and body. Per-request timeouts would add up across redirects.
    const signal = AbortSignal.timeout(deadlineMs);

    try {
      return await this.fetchWithin(input, signal, maxBytes);
    } catch (error) {
      if (signal.aborted && !(error instanceof FetcherError)) {
        throw new FetchTimeoutError({ cause: error });
      }
      throw toFetcherError(error);
    }
  }

  private async fetchWithin(
    input: string,
    signal: AbortSignal,
    maxBytes: number,
  ): Promise<FetchResult> {
    let url = this.policy.checkUrl(input);
    const redirects: RedirectHop[] = [];

    // Redirects are followed here, not by undici, so every target passes
    // the URL policy and a new host goes through the safe lookup again.
    for (;;) {
      const response = await this.send(url, signal);
      const location = response.headers.location;

      if (
        REDIRECT_STATUSES.has(response.statusCode) &&
        typeof location === 'string'
      ) {
        // Never download a redirect body: it could be large or slow.
        // Destroying it closes the connection, which is cheap here.
        discardBody(response.body);
        if (redirects.length === MAX_REDIRECTS) {
          throw new TooManyRedirectsError();
        }
        redirects.push({ url: url.href, status: response.statusCode });
        url = this.policy.checkUrl(location, url);
        continue;
      }

      // Non-2xx responses (incl. 3xx without Location) are results; their
      // body is not read, whatever its Content-Type (ADR 0002, rule 8).
      const isSuccess = response.statusCode >= 200 && response.statusCode < 300;
      let body: string | null = null;
      if (isSuccess) {
        body = await readHtmlBody(response, maxBytes);
      } else {
        discardBody(response.body);
      }

      return {
        status: response.statusCode,
        headers: toHeaderRecord(response.headers),
        finalUrl: url,
        redirects,
        body,
      };
    }
  }

  /** One GET request through the safe Agent; never follows redirects. */
  private send(
    url: URL,
    signal: AbortSignal,
  ): Promise<Dispatcher.ResponseData> {
    return request(url, {
      dispatcher: this.agent,
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      signal,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.agent.close();
  }
}

/** Keeps our typed errors; maps known network failures; rethrows the rest. */
export function toFetcherError(error: unknown): unknown {
  if (error instanceof FetcherError) {
    return error;
  }
  const code =
    error instanceof Error && 'code' in error ? String(error.code) : '';
  if (TIMEOUT_CODES.has(code)) {
    return new FetchTimeoutError({ cause: error });
  }
  if (UNREACHABLE_CODES.has(code)) {
    return new UpstreamUnreachableError({ cause: error });
  }
  return error;
}

/**
 * Per-call limits can only tighten the maximum (ADR 0002, rules 5–6). A
 * wrong value is a programming error, so it throws a RangeError.
 */
function checkLimit(
  name: string,
  value: number | undefined,
  max: number,
): number {
  if (value === undefined) {
    return max;
  }
  if (!Number.isInteger(value) || value <= 0 || value > max) {
    throw new RangeError(
      `${name} must be an integer in 1..${max}, got ${value}`,
    );
  }
  return value;
}

function toHeaderRecord(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined) {
      record[name] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  return record;
}
