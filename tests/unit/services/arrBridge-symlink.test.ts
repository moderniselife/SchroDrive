import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { createStableSymlink, getDownloadsPath } from '../../../src/services/arrBridge';

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
});
