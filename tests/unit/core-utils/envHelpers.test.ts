/**
 * Unit tests for env parsing helpers — src/core/utils.ts
 */

import { describe, expect, test } from 'bun:test';
import { asBool, asNumber, splitCsv } from '../../../src/core/utils';

describe('env helpers', () => {
  test('splitCsv trims and drops empty values', () => {
    expect(splitCsv('alpha, beta, ,gamma')).toEqual(['alpha', 'beta', 'gamma']);
    expect(splitCsv('RED,BLUE', { lowerCase: true })).toEqual(['red', 'blue']);
  });

  test('asBool resolves common truthy and falsy values', () => {
    expect(asBool('true')).toBe(true);
    expect(asBool('1')).toBe(true);
    expect(asBool('yes')).toBe(true);
    expect(asBool('false')).toBe(false);
    expect(asBool('0')).toBe(false);
    expect(asBool('maybe', true)).toBe(true);
    expect(asBool('')).toBe(false);
  });

  test('asNumber returns fallback for invalid input', () => {
    expect(asNumber('123', 7)).toBe(123);
    expect(asNumber('0', 7)).toBe(0);
    expect(asNumber('abc', 7)).toBe(7);
    expect(asNumber('', 7)).toBe(7);
  });
});
