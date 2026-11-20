import { describe, expect, it } from 'vitest';

import { CHECK_IDS } from '../../src/checks/check-id.js';

describe('CHECK_IDS', () => {
  it('contains no duplicates across categories', () => {
    expect(new Set(CHECK_IDS).size).toBe(CHECK_IDS.length);
  });

  it('uses snake_case identifiers only', () => {
    for (const id of CHECK_IDS) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });
});
