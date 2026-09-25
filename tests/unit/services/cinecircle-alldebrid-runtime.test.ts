import { afterEach, describe, expect, test } from 'bun:test';
import { config } from '../../../src/core/config';
import { cineCircleReconciliationRoutes, startCineCircleAllDebridReconciliation } from '../../../src/services/cinecircleAlldebridRuntime';

const original = {
  enabled: config.cineCircleAlldebridReconciliationEnabled,
  radarrUrl: config.cineCircleRadarrUrl,
  radarrKey: config.cineCircleRadarrApiKey,
  sonarrUrl: config.cineCircleSonarrUrl,
  sonarrKey: config.cineCircleSonarrApiKey,
};

afterEach(() => {
  config.cineCircleAlldebridReconciliationEnabled = original.enabled;
  config.cineCircleRadarrUrl = original.radarrUrl;
  config.cineCircleRadarrApiKey = original.radarrKey;
  config.cineCircleSonarrUrl = original.sonarrUrl;
  config.cineCircleSonarrApiKey = original.sonarrKey;
});

describe('CineCircle AllDebrid runtime wiring', () => {
  test('is disabled by default and does not construct a provider worker', () => {
    config.cineCircleAlldebridReconciliationEnabled = false;
    expect(startCineCircleAllDebridReconciliation()).toBeUndefined();
  });

  test('requires explicit complete Arr routes when enabled', () => {
    config.cineCircleAlldebridReconciliationEnabled = true;
    config.cineCircleRadarrUrl = 'http://radarr.test';
    config.cineCircleRadarrApiKey = 'radarr-fixture-key';
    config.cineCircleSonarrUrl = '';
    config.cineCircleSonarrApiKey = '';
    expect(startCineCircleAllDebridReconciliation()).toBeUndefined();
  });

  test('keeps explicit Movies/Radarr and Shows/Sonarr routing', () => {
    config.cineCircleRadarrUrl = 'http://radarr.test/';
    config.cineCircleRadarrApiKey = 'radarr-fixture-key';
    config.cineCircleSonarrUrl = 'http://sonarr.test/';
    config.cineCircleSonarrApiKey = 'sonarr-fixture-key';
    expect(cineCircleReconciliationRoutes()).toEqual({
      movies: { kind: 'radarr', baseUrl: 'http://radarr.test/', apiKey: 'radarr-fixture-key' },
      shows: { kind: 'sonarr', baseUrl: 'http://sonarr.test/', apiKey: 'sonarr-fixture-key' },
    });
  });
});
