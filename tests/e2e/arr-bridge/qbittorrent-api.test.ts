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
import { scanDirRecursive, startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const PORT = 18283;
const BASE_URL = `http://localhost:${PORT}`;

beforeAll(async () => {
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arrbridge-'));
  // Keep add tests provider-free: the bridge must parse the request without
  // submitting the fixture magnet to a real debrid account.
  config.providers = [];
  await startArrBridge();
});

afterAll(async () => {
  await stopArrBridge();
});

describe('*arr bridge qBittorrent-compatible API', () => {
  test('preserves relative paths while scanning multi-file content', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-multifile-'));
    fs.mkdirSync(path.join(root, 'Season 01'), { recursive: true });
    fs.mkdirSync(path.join(root, 'Extras'), { recursive: true });
    fs.writeFileSync(path.join(root, 'Season 01', 'Episode.mkv'), 'episode');
    fs.writeFileSync(path.join(root, 'Extras', 'Episode.mkv'), 'extra');
    const files = await scanDirRecursive(root);
    expect(files.map((file) => file.name).sort()).toEqual(['Extras/Episode.mkv', 'Season 01/Episode.mkv']);
  });

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
    form.append('tags', 'provider-reconciliation-test');
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
      expect.objectContaining({ hash, category, tags: 'provider-reconciliation-test' }),
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

  test('updates local save path through qBittorrent setLocation', async () => {
    const res = await fetch(`${BASE_URL}/api/v2/torrents/setLocation`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: '1111111111111111111111111111111111111111', location: '/test-staging/radarr' }),
    });
    expect(res.status).toBe(200);
    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info?hashes=1111111111111111111111111111111111111111`)).json();
    expect(torrents[0]).toMatchObject({ save_path: '/test-staging/radarr', content_path: '/test-staging/radarr' });
  });
});
