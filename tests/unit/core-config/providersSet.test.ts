/**
 * Unit tests for providersSet() — src/core/config.ts
 *
 * `config` is a module-level singleton, so these tests mutate
 * `config.providers` directly rather than relying on env vars (which are
 * only read once, at first import, for the whole test process).
 *
 * Run: bun test tests/unit/core-config/providersSet.test.ts
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { config, providersSet } from '../../../src/core/config';

const originalProviders = [...config.providers];

afterEach(() => {
  config.providers = [...originalProviders];
});

describe('providersSet', () => {
  test('lowercases provider names', () => {
    config.providers = ['PikPak', 'RealDebrid'];
    expect(providersSet()).toEqual(new Set(['pikpak', 'realdebrid']));
  });

  test('returns an empty set when no providers are configured', () => {
    config.providers = [];
    expect(providersSet().size).toBe(0);
  });

  test('de-duplicates repeated provider names', () => {
    config.providers = ['torbox', 'torbox', 'TORBOX'];
    expect(providersSet()).toEqual(new Set(['torbox']));
  });
});
