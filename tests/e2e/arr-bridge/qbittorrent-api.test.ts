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
  // Isolate DB from other parallel test suites that share the same bun:sqlite singleton.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arrbridge-'));
  config.arrBridgePort = PORT;
  config.mountBase = tmpDir;
  config.dbPath = path.join(tmpDir, 'test.db');
  // Ensure any previously-opened DB (from another suite's beforeAll) is closed
  // so getDb() will re-initialise with the new path.
  try { (await import('../../../src/core/db')).closeDb(); } catch {}
  // Keep add tests provider-free: the bridge must parse the request without
  // submitting the fixture magnet to a real debrid account.
  config.providers = [];
  await startArrBridge();
});

afterAll(async () => {
  await stopArrBridge();
  try { (await import('../../../src/core/db')).closeDb(); } catch {}
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

  test('continues to accept urlencoded magnet adds', async () => {
    const magnet = 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111&dn=urlencoded-test';
    const body = new URLSearchParams({ urls: magnet, category: 'radarr' });
    const res = await fetch(`${BASE_URL}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    expect(res.status).toBe(200);
    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info`)).json();
    expect(torrents).toEqual(expect.arrayContaining([
      expect.objectContaining({ hash: '1111111111111111111111111111111111111111', category: 'radarr' }),
    ]));
  });

  test.each(['radarr', 'sonarr'])('accepts multipart %s magnet adds', async (category) => {
    const hash = category === 'radarr'
      ? '2222222222222222222222222222222222222222'
      : '3333333333333333333333333333333333333333';
    // Radarr/Sonarr make the request multipart when the magnet exceeds 1024 B.
    const magnet = `magnet:?xt=urn:btih:${hash}&dn=${'long-release-name-'.repeat(80)}`;
    const form = new FormData();
    form.append('urls', magnet);
    form.append('savepath', `/downloads/${category}`);
    form.append('category', category);
    form.append('tags', 'cinecircle-test');
    form.append('skip_checking', 'false');
    form.append('paused', 'false');
    form.append('sequentialDownload', 'false');
    form.append('firstLastPiecePrio', 'false');

    const res = await fetch(`${BASE_URL}/api/v2/torrents/add`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(200);
    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info`)).json();
    expect(torrents).toEqual(expect.arrayContaining([
      expect.objectContaining({ hash, category, tags: 'cinecircle-test' }),
    ]));
  });

  test('rejects an add request without urls', async () => {
    const form = new FormData();
    form.append('category', 'radarr');
    const res = await fetch(`${BASE_URL}/api/v2/torrents/add`, {
      method: 'POST',
      body: form,
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toBe('No URLs provided');
  });
});
