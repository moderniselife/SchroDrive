import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { closeDb } from '../../../src/core/db';
import { startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const PORT = 18285;
const BASE_URL = `http://localhost:${PORT}`;
const HASH = '4444444444444444444444444444444444444444';
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-restart-'));

beforeAll(async () => {
  closeDb();
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-restart-mount-'));
  config.providers = [];
  config.dbPath = path.join(DB_DIR, 'state.db');
  await startArrBridge();
});

afterAll(async () => {
  await fetch(`${BASE_URL}/api/v2/torrents/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ hashes: HASH, deleteFiles: 'false' }),
  });
  await stopArrBridge();
  closeDb();
});

describe('Arr bridge restart recovery', () => {
  test('restores a tracked torrent from SQLite after a bridge restart', async () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=restart-recovery-test`;
    const response = await fetch(`${BASE_URL}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ urls: magnet, category: 'sonarr', savepath: '/downloads' }),
    });
    expect(response.status).toBe(200);

    await stopArrBridge();
    await startArrBridge();

    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info?hashes=${HASH}`)).json();
    expect(torrents).toEqual([expect.objectContaining({ hash: HASH, category: 'sonarr', name: 'restart-recovery-test' })]);
  });

  test('does not restore a torrent removed through the qBittorrent API', async () => {
    const response = await fetch(`${BASE_URL}/api/v2/torrents/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ hashes: HASH, deleteFiles: 'false' }),
    });
    expect(response.status).toBe(200);

    await stopArrBridge();
    await startArrBridge();

    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info?hashes=${HASH}`)).json();
    expect(torrents).toEqual([]);
  });
});
