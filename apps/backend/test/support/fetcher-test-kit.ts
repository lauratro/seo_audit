// Test-only helpers for SafeFetcher integration tests. Nothing here is part
// of src/: the relaxed policy below must never be reachable from production
// code or configuration (docs/adr/0002-safe-fetcher.md, rule 10).
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import { BlockedUrlError } from '../../src/fetcher/fetcher.errors.js';
import {
  type FetchPolicy,
  type ResolvedAddress,
  type Resolver,
  STRICT_FETCH_POLICY,
} from '../../src/fetcher/fetch-policy.js';

/** The local test server's addresses. */
export const LOOPBACK_V4: ResolvedAddress = { address: '127.0.0.1', family: 4 };
/** Reaches the same server, but stays blocked even under the relaxed policy. */
export const LOOPBACK_V6: ResolvedAddress = { address: '::1', family: 6 };

/**
 * URL check for tests: the strict URL policy, except that any port is
 * allowed, because the local server listens on a random port.
 */
function checkUrlAnyPort(input: string, base?: URL): URL {
  try {
    return STRICT_FETCH_POLICY.checkUrl(input, base);
  } catch (error) {
    if (!(error instanceof BlockedUrlError) || error.reason !== 'port') {
      throw error;
    }
    // The port rule runs before the host and address rules, so check the
    // same URL again without its port to apply those.
    const url = new URL(input, base);
    const withoutPort = new URL(url);
    withoutPort.port = '';
    STRICT_FETCH_POLICY.checkUrl(withoutPort.href);
    return url;
  }
}

/**
 * Relaxed policy for local integration tests: strict rules, plus any port
 * and the IPv4 loopback address 127.0.0.1. Everything else, including ::1,
 * private ranges and cloud metadata, stays blocked.
 */
export const RELAXED_TEST_POLICY: FetchPolicy = Object.freeze({
  checkUrl: checkUrlAnyPort,
  isAllowedAddress: (ip: string) =>
    ip === LOOPBACK_V4.address || STRICT_FETCH_POLICY.isAllowedAddress(ip),
});

/** Any port, but the strict address policy: 127.0.0.1 is blocked. */
export const STRICT_ADDRESS_TEST_POLICY: FetchPolicy = Object.freeze({
  checkUrl: checkUrlAnyPort,
  isAllowedAddress: STRICT_FETCH_POLICY.isAllowedAddress,
});

/**
 * Fake resolver: answers the n-th call with the n-th entry (the last entry
 * repeats). Never touches real DNS.
 */
export function fakeResolver(...answers: (ResolvedAddress[] | Error)[]): {
  resolver: Resolver;
  calls: string[];
} {
  const calls: string[] = [];
  const resolver: Resolver = (hostname) => {
    calls.push(hostname);
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    return answer instanceof Error
      ? Promise.reject(answer)
      : Promise.resolve(answer ?? []);
  };
  return { resolver, calls };
}

export type TestServer = {
  port: number;
  /** Remote address of every request the server received. */
  requests: string[];
  /** Number of client connections that are currently open. */
  openConnections: () => number;
  close: () => Promise<void>;
};

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const defaultHandler: Handler = (_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Test page</title>');
};

/** Starts an HTTP server on a random port, reachable on 127.0.0.1 and ::1. */
export async function startTestServer(
  handler: Handler = defaultHandler,
): Promise<TestServer> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.socket.remoteAddress ?? '');
    handler(request, response);
  });
  let open = 0;
  server.on('connection', (socket) => {
    open += 1;
    socket.on('close', () => {
      open -= 1;
    });
  });

  await new Promise<void>((resolve) => {
    // "::" with ipv6Only false accepts IPv4 (127.0.0.1) and IPv6 (::1).
    server.listen({ port: 0, host: '::', ipv6Only: false }, resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    requests,
    openConnections: () => open,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
