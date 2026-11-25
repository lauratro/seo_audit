import type { INestApplication } from '@nestjs/common';

import { FetcherExceptionFilter } from './fetcher/filter/fetcher-exception.filter.js';

// App-wide settings shared by main.ts and the e2e tests,
// so tests exercise the same routes as the running server.
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  // Maps SafeFetcher errors to API error responses (ADR 0002, rule 9).
  app.useGlobalFilters(new FetcherExceptionFilter());
}
