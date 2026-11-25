import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockedUrlError } from '../../../src/fetcher/fetcher.errors.js';
import {
  DNS_RESOLVER,
  FETCH_POLICY,
  STRICT_FETCH_POLICY,
  systemResolver,
} from '../../../src/fetcher/fetch-policy.js';
import { FetcherModule } from '../../../src/fetcher/module/fetcher.module.js';
import { SafeFetcherService } from '../../../src/fetcher/service/safe-fetcher.service.js';

// Production wiring must use the strict policy and the system resolver,
// with no way to switch to a relaxed policy (docs/adr/0002-safe-fetcher.md,
// rule 10). These tests make no network requests: every URL below is
// blocked by the URL policy before any DNS lookup.

let moduleRef: TestingModule;

beforeEach(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [FetcherModule],
  }).compile();
});

afterEach(async () => {
  await moduleRef.close();
});

describe('FetcherModule', () => {
  it('wires the strict production policy', () => {
    expect(moduleRef.get(FETCH_POLICY, { strict: false })).toBe(
      STRICT_FETCH_POLICY,
    );
  });

  it('wires the system DNS resolver', () => {
    expect(moduleRef.get(DNS_RESOLVER, { strict: false })).toBe(systemResolver);
  });

  it('provides SafeFetcherService', () => {
    expect(moduleRef.get(SafeFetcherService)).toBeInstanceOf(
      SafeFetcherService,
    );
  });

  it('keeps the strict policy immutable', () => {
    expect(Object.isFrozen(STRICT_FETCH_POLICY)).toBe(true);
  });

  it.each([
    ['http://127.0.0.1/', 'address'],
    ['http://169.254.169.254/latest/meta-data/', 'address'],
    ['http://[::1]/', 'address'],
    ['http://localhost/', 'host'],
    ['http://example.com:8080/', 'port'],
  ])('the wired service blocks %s (%s)', async (url, reason) => {
    const fetcher = moduleRef.get(SafeFetcherService);
    await expect(fetcher.fetchPage(url)).rejects.toSatisfy(
      (error) => error instanceof BlockedUrlError && error.reason === reason,
    );
  });

  it('closes the fetcher when the module is closed', async () => {
    const fetcher = moduleRef.get(SafeFetcherService);
    const destroy = vi.spyOn(fetcher, 'onModuleDestroy');
    await moduleRef.close();
    expect(destroy).toHaveBeenCalledOnce();
    // Recreate, so afterEach can close a module again.
    moduleRef = await Test.createTestingModule({
      imports: [FetcherModule],
    }).compile();
  });
});

describe('Relaxed test policy stays out of production code', () => {
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return path.endsWith('.ts') ? [path] : [];
    });
  }

  const srcDirectory = join(import.meta.dirname, '../../../src');

  it.each(sourceFiles(srcDirectory).map((file) => [file]))(
    '%s imports nothing from test/',
    (file) => {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*\/test\//);
      expect(source).not.toMatch(/RELAXED_TEST_POLICY|fetcher-test-kit/);
    },
  );
});
