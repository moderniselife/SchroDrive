import { afterEach, describe, expect, test } from 'bun:test';
import { config, isProviderReconciliationAutoEnabled } from '../../../src/core/config';
import { providerReconciliationRoutes, startProviderReconciliation } from '../../../src/services/providerReconciliationRuntime';

const original = {
  enabled: config.providerReconciliationEnabled,
  radarrUrl: config.providerReconciliationRadarrUrl,
  radarrKey: config.providerReconciliationRadarrApiKey,
  sonarrUrl: config.providerReconciliationSonarrUrl,
  sonarrKey: config.providerReconciliationSonarrApiKey,
};

afterEach(() => {
  config.providerReconciliationEnabled = original.enabled;
  config.providerReconciliationRadarrUrl = original.radarrUrl;
  config.providerReconciliationRadarrApiKey = original.radarrKey;
  config.providerReconciliationSonarrUrl = original.sonarrUrl;
  config.providerReconciliationSonarrApiKey = original.sonarrKey;
});

describe('provider reconciliation runtime wiring', () => {
  test('auto-enables when both Arr integrations are configured', () => {
    const env = {
      PROVIDER_RECONCILIATION_RADARR_URL: 'http://radarr.test',
      PROVIDER_RECONCILIATION_RADARR_API_KEY: 'radarr-fixture-key',
      PROVIDER_RECONCILIATION_SONARR_URL: 'http://sonarr.test',
      PROVIDER_RECONCILIATION_SONARR_API_KEY: 'sonarr-fixture-key',
    };
    expect(isProviderReconciliationAutoEnabled(env)).toBe(true);
  });

  test('remains disabled when the Arr configuration is incomplete', () => {
    expect(isProviderReconciliationAutoEnabled({
      PROVIDER_RECONCILIATION_RADARR_URL: 'http://radarr.test',
      PROVIDER_RECONCILIATION_RADARR_API_KEY: 'radarr-fixture-key',
    })).toBe(false);
  });

  test('allows an explicit false to disable automatic activation', () => {
    expect(isProviderReconciliationAutoEnabled({
      PROVIDER_RECONCILIATION_ENABLED: 'false',
      PROVIDER_RECONCILIATION_RADARR_URL: 'http://radarr.test',
      PROVIDER_RECONCILIATION_RADARR_API_KEY: 'radarr-fixture-key',
      PROVIDER_RECONCILIATION_SONARR_URL: 'http://sonarr.test',
      PROVIDER_RECONCILIATION_SONARR_API_KEY: 'sonarr-fixture-key',
    })).toBe(false);
  });

  test('allows an explicit true when automatic configuration is incomplete', () => {
    expect(isProviderReconciliationAutoEnabled({ PROVIDER_RECONCILIATION_ENABLED: 'true' })).toBe(true);
  });

  test('requires explicit complete Arr routes when enabled', () => {
    config.providerReconciliationEnabled = true;
    config.providerReconciliationRadarrUrl = 'http://radarr.test';
    config.providerReconciliationRadarrApiKey = 'radarr-fixture-key';
    config.providerReconciliationSonarrUrl = '';
    config.providerReconciliationSonarrApiKey = '';
    expect(startProviderReconciliation()).toBeUndefined();
  });

  test('keeps explicit Movies/Radarr and Shows/Sonarr routing for any provider', () => {
    config.providerReconciliationRadarrUrl = 'http://radarr.test/';
    config.providerReconciliationRadarrApiKey = 'radarr-fixture-key';
    config.providerReconciliationSonarrUrl = 'http://sonarr.test/';
    config.providerReconciliationSonarrApiKey = 'sonarr-fixture-key';
    expect(providerReconciliationRoutes('realdebrid')).toEqual({
      movies: { kind: 'radarr', baseUrl: 'http://radarr.test/', apiKey: 'radarr-fixture-key', sourcePathPrefix: '/mnt/schrodrive/realdebrid', importMode: 'Copy' },
      shows: { kind: 'sonarr', baseUrl: 'http://sonarr.test/', apiKey: 'sonarr-fixture-key', sourcePathPrefix: '/mnt/schrodrive/realdebrid', importMode: 'Copy' },
    });
  });
});
