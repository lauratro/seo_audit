import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/config/config.js';

const SECRET = 's3cret-pass';
const DATABASE_URL = `postgresql://seo_audit:${SECRET}@localhost:5433/seo_audit`;

const validEnv = {
  NODE_ENV: 'development',
  PORT: '3001',
  DATABASE_URL,
};

describe('loadConfig', () => {
  it('returns a typed config for a valid environment', () => {
    expect(loadConfig(validEnv)).toEqual({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: DATABASE_URL,
    });
  });

  it('applies defaults for NODE_ENV and PORT', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      nodeEnv: 'development',
      port: 3001,
      databaseUrl: DATABASE_URL,
    });
  });

  it('ignores unrelated environment variables', () => {
    const config = loadConfig({
      ...validEnv,
      HOME: '/home/user',
      SHELL: 'zsh',
    });

    expect(Object.keys(config).sort()).toEqual([
      'databaseUrl',
      'nodeEnv',
      'port',
    ]);
  });

  it.each(['development', 'test', 'production'])(
    'accepts NODE_ENV=%s',
    (nodeEnv) => {
      expect(loadConfig({ ...validEnv, NODE_ENV: nodeEnv }).nodeEnv).toBe(
        nodeEnv,
      );
    },
  );

  it('accepts the postgres:// scheme as well as postgresql://', () => {
    const url = 'postgres://seo_audit:pw@localhost:5433/seo_audit';

    expect(loadConfig({ DATABASE_URL: url }).databaseUrl).toBe(url);
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: 'staging' })).toThrow(
      /NODE_ENV/,
    );
  });

  it.each(['abc', '0', '70000', '3.5', ''])('rejects PORT=%j', (port) => {
    expect(() => loadConfig({ ...validEnv, PORT: port })).toThrow(/PORT/);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it.each([
    ['not a URL', 'localhost:5433/seo_audit'],
    ['another database scheme', 'mysql://user:pw@localhost:3306/seo_audit'],
    ['an HTTP URL', 'http://localhost:5433/seo_audit'],
  ])('rejects DATABASE_URL that is %s', (_label, url) => {
    expect(() => loadConfig({ ...validEnv, DATABASE_URL: url })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('reports every invalid variable in one error', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'staging', PORT: 'abc', DATABASE_URL: '' }),
    ).toThrow(/NODE_ENV[\s\S]*PORT[\s\S]*DATABASE_URL/);
  });

  it('never includes variable values in the error message', () => {
    const attempts = [
      { ...validEnv, PORT: 'abc' },
      { ...validEnv, DATABASE_URL: `mysql://seo_audit:${SECRET}@localhost/db` },
    ];

    for (const env of attempts) {
      expect(() => loadConfig(env)).toThrow();
      try {
        loadConfig(env);
      } catch (error) {
        expect(String(error)).not.toContain(SECRET);
      }
    }
  });
});
