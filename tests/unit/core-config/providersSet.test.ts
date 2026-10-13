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
import { CONFIG_SCHEMA } from '../../../src/core/configApi';
import { registry } from '../../../src/providers';

const originalProviders = [...config.providers];

afterEach(() => {
  config.providers = [...originalProviders];
});

describe('providersSet', () => {
  test('leaves MOUNT_OPTIONS empty so individual mount settings are effective', () => {
    expect(CONFIG_SCHEMA.MOUNT_OPTIONS.default).toBe('');
  });

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

  test('does not activate a configured provider omitted from PROVIDERS', () => {
    const id = `test-provider-${Date.now()}`;
    registry.register({
      id,
      displayName: 'Test Provider',
      isConfigured: () => true,
      isRateLimited: () => false,
      getWaitTime: () => 0,
    } as any);

    config.providers = ['alldebrid'];
    expect(registry.configured().some(provider => provider.id === id)).toBe(true);
    expect(registry.enabled().some(provider => provider.id === id)).toBe(false);
  });
});
