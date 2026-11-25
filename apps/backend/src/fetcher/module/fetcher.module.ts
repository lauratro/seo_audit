import { Module } from '@nestjs/common';

import {
  DNS_RESOLVER,
  FETCH_POLICY,
  STRICT_FETCH_POLICY,
  systemResolver,
} from '../fetch-policy.js';
import { SafeFetcherService } from '../service/safe-fetcher.service.js';

/**
 * Provides SafeFetcherService with the strict production policy and the
 * system DNS resolver. Nothing here reads configuration, so no environment
 * variable (NODE_ENV included) can switch to a relaxed policy
 * (docs/adr/0002-safe-fetcher.md, rule 10). Only the service is exported;
 * the policy and resolver tokens stay private to this module.
 */
@Module({
  providers: [
    { provide: FETCH_POLICY, useValue: STRICT_FETCH_POLICY },
    { provide: DNS_RESOLVER, useValue: systemResolver },
    SafeFetcherService,
  ],
  exports: [SafeFetcherService],
})
export class FetcherModule {}
