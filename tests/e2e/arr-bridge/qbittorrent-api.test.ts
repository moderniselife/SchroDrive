/**
 * E2E tests for the *arr bridge (fake qBittorrent Web API).
 *
 * Boots the real Express app from src/services/arrBridge.ts on a scratch
 * port/mount and drives it over HTTP the same way Radarr/Sonarr would.
 *
 * Run: bun test tests/e2e/arr-bridge/qbittorrent-api.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const PORT = 18283;
const BASE_URL = `http://localhost:${PORT}`;

beforeAll(async () => {
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arrbridge-'));
  await startArrBridge();
});

afterAll(async () => {
  await stopArrBridge();
});

describe('*arr bridge qBittorrent-compatible API', () => {
  test('reports a webapi version on GET /api/v2/app/webapiVersion', async () => {
    const res = await fetch(`${BASE_URL}/api/v2/app/webapiVersion`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test('reports build info on GET /api/v2/app/buildInfo', async () => {
    const res = await fetch(`${BASE_URL}/api/v2/app/buildInfo`);
    expect(res.status).toBe(200);
  });

  test('lists torrents (empty) on GET /api/v2/torrents/info', async () => {
    const res = await fetch(`${BASE_URL}/api/v2/torrents/info`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('exposes a /health endpoint with tracked-torrent counters', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', service: 'arr-bridge' });
  });
});
