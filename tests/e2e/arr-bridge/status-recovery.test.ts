import { afterAll, beforeAll, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { closeDb, getDb } from '../../../src/core/db';
import { registry } from '../../../src/providers';
import { pollDebridStatus, scanMountsForCompleted, startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sam7-status-'));
const saved = { dbPath: config.dbPath, mountBase: config.mountBase, arrBridgePort: config.arrBridgePort, providers: config.providers, arrDownloadsPath: config.arrDownloadsPath };
const hash = '7777777777777777777777777777777777777777';
let unavailable = true;
let silentEmpty = false;
const listing = spyOn(registry, 'ordered');
const record = (mountScanned = false) => ({ hash, magnet: `magnet:?xt=urn:btih:${hash}`, name: 'Original release', state: mountScanned ? 'uploading' : 'error', progress: mountScanned ? 1 : 0, size: 0, addedOn: 1, completionOn: -1, category: 'radarr', tags: '', savePath: root, contentPath: root, providerResults: [{ provider: 'alldebrid', id: '123', success: true }], files: [], pollAttempts: 61, mountScanned });
function stored() { return JSON.parse((getDb().prepare('SELECT state_json FROM arr_tracked_torrents WHERE hash = ?').get(hash) as { state_json: string }).state_json); }
async function seed(value: ReturnType<typeof record>) {
  await stopArrBridge();
  getDb().prepare('INSERT OR REPLACE INTO arr_tracked_torrents(hash,state_json,updated_at) VALUES(?,?,?)').run(hash, JSON.stringify(value), Date.now());
  await startArrBridge();
}
beforeAll(async () => {
  closeDb();
  config.dbPath = path.join(root, 'state.db');
  config.mountBase = path.join(root, 'mount');
  config.arrDownloadsPath = path.join(root, 'custom-staging');
  config.arrBridgePort = 18287;
  config.providers = [];
  listing.mockReturnValue([{ id: 'alldebrid', async listTorrents() {
    if (unavailable) throw new Error('temporary outage');
    if (silentEmpty) return [];
    return [{ id: '123', name: 'Renamed.release.mkv', status: 'downloaded', progress: 100, bytes: 15450000000 }];
  } }] as any);
  await seed(record());
});
afterAll(async () => {
  await stopArrBridge(); closeDb(); listing.mockRestore(); Object.assign(config, saved);
  fs.rmSync(root, { recursive: true, force: true });
});
test('temporary provider outage leaves persisted error and missing count unchanged', async () => {
  await pollDebridStatus();
  expect(stored()).toEqual(record());
});
test('provider outage does not exhaust missing polls for an active download', async () => {
  await seed({ ...record(), state: 'downloading', pollAttempts: 60 });
  await pollDebridStatus();
  expect(stored()).toMatchObject({ state: 'downloading', pollAttempts: 60 });
  await seed(record());
});
test('an empty provider listing is not proof that a submitted torrent disappeared', async () => {
  unavailable = false;
  silentEmpty = true;
  await seed({ ...record(), state: 'downloading', pollAttempts: 60 });
  await pollDebridStatus();
  expect(stored()).toMatchObject({ state: 'downloading', pollAttempts: 60 });
  silentEmpty = false;
  await seed(record());
});
test('restored error recovers through provider ID despite rename and persists across restart', async () => {
  unavailable = false;
  await pollDebridStatus();
  expect(stored()).toMatchObject({ state: 'stalledDL', progress: 1, name: 'Renamed.release.mkv', pollAttempts: 0, mountScanned: false, category: 'radarr', size: 15450000000 });
  await stopArrBridge(); closeDb(); await startArrBridge();
  const result = await (await fetch(`http://localhost:18287/api/v2/torrents/info?hashes=${hash}`)).json();
  expect(result[0]).toMatchObject({ state: 'stalledDL', progress: 1, name: 'Renamed.release.mkv', category: 'radarr' });
});
test('completed mountScanned torrent is preserved in SQLite and API', async () => {
  await seed(record(true));
  await pollDebridStatus();
  expect(stored()).toEqual(record(true));
  const result = await (await fetch(`http://localhost:18287/api/v2/torrents/info?hashes=${hash}`)).json();
  expect(result[0]).toMatchObject({ state: 'uploading', progress: 1 });
});

test('recovered error completes mount discovery with absolute staging links and survives restart', async () => {
  unavailable = false;
  config.providers = ['alldebrid'];
  const source = path.join(config.mountBase, 'alldebrid', '__all__', 'Renamed.release.mkv');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'fixture video');
  await seed(record());
  await pollDebridStatus();
  await scanMountsForCompleted();
  const complete = stored();
  expect(complete).toMatchObject({ state: 'pausedUP', progress: 1, mountScanned: true, category: 'radarr', savePath: path.join(config.arrDownloadsPath, 'radarr') });
  const link = path.join(complete.contentPath, 'Renamed.release.mkv');
  expect(fs.readlinkSync(link)).toBe(source);
  expect(path.isAbsolute(fs.readlinkSync(link))).toBe(true);
  await stopArrBridge(); closeDb(); await startArrBridge();
  await pollDebridStatus();
  expect(stored()).toEqual(complete);
  const result = await (await fetch(`http://localhost:18287/api/v2/torrents/info?hashes=${hash}`)).json();
  expect(result[0]).toMatchObject({ state: 'pausedUP', progress: 1, content_path: complete.contentPath });
});

 test('identity-only recovery persists renamed release and reset counter', async () => {
  unavailable = false;
  await seed({ ...record(), state: 'stalledDL', progress: 1, size: 15450000000 });
  await pollDebridStatus();
  expect(stored()).toMatchObject({ name: 'Renamed.release.mkv', pollAttempts: 0, state: 'stalledDL' });
});
