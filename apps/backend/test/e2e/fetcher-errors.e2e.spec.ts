import type { Server } from 'node:http';

import {
  BadRequestException,
  Controller,
  Get,
  type INestApplication,
  NotFoundException,
  Param,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../src/app.module.js';
import {
  BlockedUrlError,
  FetcherError,
  FetchTimeoutError,
  ResponseTooLargeError,
  UpstreamUnreachableError,
} from '../../src/fetcher/fetcher.errors.js';
import { setupApp } from '../../src/setup-app.js';

// The exception filter is registered in setupApp, so the running server and
// these tests share it. A test-only controller throws the errors that
// SafeFetcher will throw once the audits endpoint uses it (task 2.7).

const internalCause = new Error('connect ECONNREFUSED 10.0.0.5:80');

const THROWERS: Record<string, () => never> = {
  'blocked-address': () => {
    throw new BlockedUrlError('address');
  },
  'too-large': () => {
    throw new ResponseTooLargeError();
  },
  unreachable: () => {
    throw new UpstreamUnreachableError({ cause: internalCause });
  },
  timeout: () => {
    throw new FetchTimeoutError({ cause: internalCause });
  },
  'unknown-fetcher-error': () => {
    class UnknownFetcherError extends FetcherError {}
    throw new UnknownFetcherError('internal detail 10.0.0.5');
  },
  'not-found': () => {
    throw new NotFoundException();
  },
  'bad-request': () => {
    throw new BadRequestException('Validation failed');
  },
  'plain-error': () => {
    throw new Error('internal detail 10.0.0.5');
  },
};

@Controller('test-errors')
class ThrowingController {
  @Get(':kind')
  throw(@Param('kind') kind: string): never {
    const thrower = THROWERS[kind];
    if (!thrower) throw new NotFoundException();
    return thrower();
  }
}

describe('Fetcher exception filter (API boundary)', () => {
  let app: INestApplication<Server>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ThrowingController],
    }).compile();

    // logger: false keeps the expected error logs out of the test output.
    app = moduleRef.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function get(kind: string) {
    return request(app.getHttpServer()).get(`/api/test-errors/${kind}`);
  }

  it.each([
    ['blocked-address', 400, 'BLOCKED_URL'],
    ['too-large', 422, 'RESPONSE_TOO_LARGE'],
    ['unreachable', 502, 'UPSTREAM_UNREACHABLE'],
    ['timeout', 504, 'FETCH_TIMEOUT'],
  ])('responds to %s with HTTP %i %s', async (kind, statusCode, code) => {
    const response = await get(kind);

    expect(response.status).toBe(statusCode);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.body).toEqual({
      statusCode,
      code,
      message: expect.any(String) as string,
    });
  });

  it.each([['unreachable'], ['timeout'], ['blocked-address']])(
    'reveals no internal details for %s',
    async (kind) => {
      const response = await get(kind);
      expect(response.text).not.toContain('10.0.0.5');
      expect(response.text).not.toContain('ECONNREFUSED');
      expect(response.text).not.toMatch(/stack|cause/i);
    },
  );

  it('answers an unmapped FetcherError with a generic 500', async () => {
    const response = await get('unknown-fetcher-error');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  describe('unrelated exceptions keep the NestJS default behaviour', () => {
    it('NotFoundException → 404', async () => {
      const response = await get('not-found');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ statusCode: 404, message: 'Not Found' });
    });

    it('BadRequestException → 400 with its own message', async () => {
      const response = await get('bad-request');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        statusCode: 400,
        message: 'Validation failed',
        error: 'Bad Request',
      });
    });

    it('a plain Error → generic 500 without details', async () => {
      const response = await get('plain-error');
      expect(response.status).toBe(500);
      expect(response.body).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
    });

    it('an unknown route → 404', async () => {
      const response = await request(app.getHttpServer()).get('/api/nowhere');
      expect(response.status).toBe(404);
    });
  });
});
