import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { closeDb } from '../../../src/core/db';
import { startArrBridge, stopArrBridge, resetArrBridgeStateForTests } from '../../../src/services/arrBridge';

const PORT = 18285;
const BASE_URL = `http://localhost:${PORT}`;
const HASH = '4444444444444444444444444444444444444444';

beforeAll(async () => {
  closeDb();
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-restart-'));
  config.providers = [];
  config.dbPath = path.join(config.mountBase, 'state.db');
  await startArrBridge();
});

afterAll(async () => {
  await fetch(`${BASE_URL}/api/v2/torrents/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ hashes: HASH, deleteFiles: 'false' }),
  });
  await stopArrBridge();
  resetArrBridgeStateForTests();
});

describe('Arr bridge restart recovery', () => {
  test('restores a tracked torrent from SQLite after process state reset', async () => {
    const magnet = `magnet:?xt=urn:btih:${HASH}&dn=restart-recovery-test`;
    const response = await fetch(`${BASE_URL}/api/v2/torrents/add`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ urls: magnet, category: 'sonarr', savepath: '/downloads' }),
    });
    expect(response.status).toBe(200);

    resetArrBridgeStateForTests();
    await stopArrBridge();
    await startArrBridge();

    const torrents = await (await fetch(`${BASE_URL}/api/v2/torrents/info?hashes=${HASH}`)).json();
    expect(torrents).toEqual([expect.objectContaining({ hash: HASH, category: 'sonarr', name: 'restart-recovery-test' })]);
  });
});
