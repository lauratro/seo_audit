import { lookup } from 'node:dns/promises';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { systemResolver } from '../../../src/fetcher/fetch-policy.js';

// Unit tests never touch real DNS: the OS resolver is replaced.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));

/** Makes the mocked OS resolver return the given answer. */
function osAnswers(answers: { address: string; family: number }[]): void {
  // The mock returns the `all: true` overload's shape; the cast picks it.
  vi.mocked(lookup).mockResolvedValue(answers as never);
}

describe('systemResolver', () => {
  beforeEach(() => {
    vi.mocked(lookup).mockReset();
  });

  it('keeps family 4 for an IPv4 address', async () => {
    osAnswers([{ address: '8.8.8.8', family: 4 }]);
    await expect(systemResolver('example.com')).resolves.toEqual([
      { address: '8.8.8.8', family: 4 },
    ]);
  });

  it('keeps family 6 for an IPv6 address', async () => {
    osAnswers([{ address: '2001:4860:4860::8888', family: 6 }]);
    await expect(systemResolver('example.com')).resolves.toEqual([
      { address: '2001:4860:4860::8888', family: 6 },
    ]);
  });

  it.each([[0], [5], [Number.NaN]])(
    'rejects an unexpected family %s instead of guessing',
    async (family) => {
      osAnswers([
        { address: '8.8.8.8', family: 4 },
        { address: '8.8.4.4', family },
      ]);
      await expect(systemResolver('example.com')).rejects.toThrow(
        'Unexpected address family',
      );
    },
  );
});
