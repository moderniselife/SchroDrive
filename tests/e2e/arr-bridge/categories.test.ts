import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { closeDb } from '../../../src/core/db';
import { startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const PORT = 18286;
const BASE_URL = `http://localhost:${PORT}`;
const DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-categories-'));
const CATEGORY = 'radarr-4k-test';
const SAVE_PATH = '/downloads/radarr-4k-test';

beforeAll(async () => {
  closeDb();
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-category-mount-'));
  config.dbPath = path.join(DB_DIR, 'state.db');
  config.providers = [];
  await startArrBridge();
});

afterAll(async () => {
  await stopArrBridge();
  closeDb();
});

describe('Arr bridge qBittorrent categories', () => {
  test('persists categories created by Arr clients and exposes their save path', async () => {
    const create = await fetch(`${BASE_URL}/api/v2/torrents/createCategory`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ category: CATEGORY, savePath: SAVE_PATH }),
    });
    expect(create.status).toBe(200);

    const listed = await (await fetch(`${BASE_URL}/api/v2/torrents/categories`)).json();
    expect(listed[CATEGORY]).toEqual({ name: CATEGORY, savePath: SAVE_PATH });

    await stopArrBridge();
    await startArrBridge();

    const afterRestart = await (await fetch(`${BASE_URL}/api/v2/torrents/categories`)).json();
    expect(afterRestart[CATEGORY]).toEqual({ name: CATEGORY, savePath: SAVE_PATH });
  });

  test('updates an existing category through editCategory', async () => {
    const update = await fetch(`${BASE_URL}/api/v2/torrents/editCategory`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ category: CATEGORY, savePath: `${SAVE_PATH}/updated` }),
    });
    expect(update.status).toBe(200);
    const listed = await (await fetch(`${BASE_URL}/api/v2/torrents/categories`)).json();
    expect(listed[CATEGORY].savePath).toBe(`${SAVE_PATH}/updated`);
  });
});
