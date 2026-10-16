import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { createStableSymlink, findBestMountMatch, getDownloadsPath } from '../../../src/services/arrBridge';

describe('ARR bridge symlink paths', () => {
  const originalMountBase = config.mountBase;
  const originalArrDownloadsPath = config.arrDownloadsPath;

  afterEach(() => {
    config.mountBase = originalMountBase;
    config.arrDownloadsPath = originalArrDownloadsPath;
  });

  test('uses the configured staging path and keeps the default fallback', () => {
    const mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arr-path-'));
    config.mountBase = mountBase;
    config.arrDownloadsPath = '';
    expect(getDownloadsPath()).toBe(path.join(mountBase, 'downloads'));

    const customPath = path.join(mountBase, 'shared-downloads');
    config.arrDownloadsPath = customPath;
    expect(getDownloadsPath()).toBe(customPath);
  });

  test('keeps the source valid after *arr moves the link and removes staging', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arr-link-'));
    const sourcePath = path.join(root, 'mount', 'provider', 'episode.mkv');
    const stagingPath = path.join(root, 'downloads', 'sonarr', 'release', 'episode.mkv');
    const importedPath = path.join(root, 'library', 'Show', 'Season 01', 'Show - S01E01.mkv');

    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'media');
    await createStableSymlink(sourcePath, stagingPath);

    expect(fs.readlinkSync(stagingPath)).toBe(sourcePath);
    fs.mkdirSync(path.dirname(importedPath), { recursive: true });
    fs.renameSync(stagingPath, importedPath);
    fs.rmSync(path.dirname(path.dirname(path.dirname(stagingPath))), { recursive: true, force: true });

    expect(fs.readlinkSync(importedPath)).toBe(sourcePath);
    expect(fs.readFileSync(importedPath, 'utf8')).toBe('media');
  });

  test('prefers the exact season-pack directory over a matching episode file', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arr-pack-'));
    const mount = path.join(root, 'mount', 'alldebrid', '__all__');
    const pack = path.join(mount, 'Operazione.Speciale.Lioness.S03.ITA.ENG.2160p');
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(path.join(pack, 'Lioness.S03E01.mkv'), 'episode 1');
    fs.writeFileSync(path.join(pack, 'Lioness.S03E02.mkv'), 'episode 2');
    fs.writeFileSync(path.join(mount, 'Operazione.Speciale.Lioness.S03E01.mkv'), 'single episode');

    const match = await findBestMountMatch(mount, 'Operazione.Speciale.Lioness.S03.ITA.ENG.2160p');
    expect(match?.path).toBe(pack);
    expect(match?.files.map(file => file.name).sort()).toEqual(['Lioness.S03E01.mkv', 'Lioness.S03E02.mkv']);
  });

  test('prefers an exact single file over a merely similar directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arr-file-'));
    const mount = path.join(root, 'mount');
    const similar = path.join(mount, 'Movie.2026.Extras');
    fs.mkdirSync(similar, { recursive: true });
    fs.writeFileSync(path.join(similar, 'bonus.mkv'), 'bonus');
    fs.writeFileSync(path.join(mount, 'Movie.2026.mkv'), 'feature');
    const match = await findBestMountMatch(mount, 'Movie.2026.mkv');
    expect(match?.files.map(file => file.name)).toEqual(['Movie.2026.mkv']);
  });

  test('does not match an empty torrent name', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arr-empty-'));
    fs.writeFileSync(path.join(root, 'unrelated.mkv'), 'media');
    expect(await findBestMountMatch(root, '')).toBeNull();
  });
});
