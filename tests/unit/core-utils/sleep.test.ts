/**
 * Unit tests for sleep() — src/core/utils.ts
 *
 * Run: bun test tests/unit/core-utils/sleep.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { sleep } from '../../../src/core/utils';

describe('sleep', () => {
  test('resolves after roughly the requested duration', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  test('resolves immediately for 0ms', async () => {
    const start = Date.now();
    await sleep(0);
    expect(Date.now() - start).toBeLessThan(50);
  });

  test('returns a promise that resolves to undefined', async () => {
    const result = await sleep(1);
    expect(result).toBeUndefined();
  });
});
