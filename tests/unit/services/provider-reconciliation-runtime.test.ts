import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../../../src/core/config';
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
  test('is disabled by default and does not construct a provider worker', () => {
    config.providerReconciliationEnabled = false;
    expect(startProviderReconciliation()).toBeUndefined();
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
