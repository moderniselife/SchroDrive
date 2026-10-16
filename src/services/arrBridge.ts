/**
 * SchroDrive — *arr Bridge (Fake qBittorrent API)
 *
 * Implements a subset of the qBittorrent Web API v2 so that Radarr/Sonarr
 * can use SchroDrive as a "download client". When Radarr/Sonarr send a
 * magnet link, we submit it to the configured debrid providers and create
 * symlinks when the files appear on the rclone FUSE mount.
 *
 * This replaces the need for external bridge tools like Decypharr or
 * RDT-Client — everything stays in the SchroDrive container.
 *
 * qBittorrent API v2 docs: https://github.com/qbittorrent/qBittorrent/wiki/WebUI-API-(qBittorrent-4.1)
 *
 * @module services/arrBridge
 */

import { findProviderTorrent, shouldPollTorrent } from './arrBridgeStatus';
import express, { type Request, type Response } from 'express';
import Busboy from 'busboy';
import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../core/config';
import { getDb } from '../core/db';
import { registry } from '../providers';
import type { AddMagnetResult } from '../providers';
import { sanitiseName, base32ToHex } from '../core/utils';

// ===========================================================================
// Constants
// ===========================================================================

const LOG_PREFIX = '[arr-bridge]';
const FAKE_QBIT_VERSION = '4.6.7';
const FAKE_WEBAPI_VERSION = '2.9.3';

/** How often to poll debrid providers for torrent status (ms). */
const STATUS_POLL_INTERVAL_MS = 15_000;

/** How often to scan mount paths for completed files (ms). */
const MOUNT_SCAN_INTERVAL_MS = 10_000;

// ===========================================================================
// Types
// ===========================================================================

/** qBittorrent-compatible torrent states. */
type QBitState =
  | 'downloading'
  | 'stalledDL'
  | 'uploading'     // completed + seeding (our "done" state)
  | 'stalledUP'     // completed + paused seeding
  | 'pausedUP'      // completed + fully paused
  | 'error'
  | 'missingFiles'
  | 'queuedDL';

/** Internal tracked torrent. */
interface TrackedTorrent {
  /** Uppercase info hash. */
  hash: string;
  /** Human-readable name (from *arr or extracted from magnet). */
  name: string;
  /** Original magnet URI. */
  magnet: string;
  /** Current qBit-compatible state. */
  state: QBitState;
  /** Download progress 0.0 – 1.0. */
  progress: number;
  /** Total size in bytes (populated once debrid reports it). */
  size: number;
  /** Unix timestamp when added (seconds). */
  addedOn: number;
  /** Unix timestamp when completed (seconds), or -1. */
  completionOn: number;
  /** Category assigned by *arr (e.g. "radarr", "sonarr"). */
  category: string;
  /** Tags assigned by *arr. */
  tags: string;
  /** Configured save path (where symlinks go). */
  savePath: string;
  /** Full path to the content (file or directory). */
  contentPath: string;
  /** Per-provider add results. */
  providerResults: Array<{ provider: string; id: string; success: boolean }>;
  /** Resolved mount path (once files are found). */
  mountPath?: string;
  /** Created symlink path. */
  symlinkPath?: string;
  /** Files discovered on mount. */
  files: Array<{ name: string; size: number; path: string }>;
  /** Number of status poll attempts. */
  pollAttempts: number;
  /** Whether we've already scanned for mount files. */
  mountScanned: boolean;
}

// ===========================================================================
// State
// ===========================================================================

/** All tracked torrents, keyed by uppercase info hash. */
const tracked = new Map<string, TrackedTorrent>();
let trackedStateLoaded = false;

function persistTrackedTorrent(torrent: TrackedTorrent): void {
  try {
    getDb().prepare(`INSERT INTO arr_tracked_torrents (hash, state_json, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(hash) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
      .run(torrent.hash, JSON.stringify(torrent), Date.now());
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Could not persist tracked torrent ${torrent.hash.slice(0, 8)}: ${err?.message || String(err)}`);
  }
}

function removePersistedTorrent(hash: string): void {
  try { getDb().prepare('DELETE FROM arr_tracked_torrents WHERE hash = ?').run(hash); }
  catch (err: any) { console.warn(`${LOG_PREFIX} Could not remove persisted torrent: ${err?.message || String(err)}`); }
}

function loadTrackedTorrents(): void {
  if (trackedStateLoaded) return;
  trackedStateLoaded = true;
  try {
    const rows = getDb().prepare('SELECT state_json FROM arr_tracked_torrents').all() as Array<{ state_json: string }>;
    for (const row of rows) {
      try {
        const torrent = JSON.parse(row.state_json) as TrackedTorrent;
        if (torrent?.hash && torrent?.magnet && torrent?.name) tracked.set(torrent.hash.toUpperCase(), torrent);
      } catch { /* Ignore one malformed record and restore the rest. */ }
    }
    if (rows.length) console.log(`${LOG_PREFIX} Restored ${tracked.size} tracked torrent(s) from SQLite`);
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Could not restore tracked torrents: ${err?.message || String(err)}`);
  }
}

function stateFingerprint(torrent: TrackedTorrent): string {
  return `${torrent.state}|${torrent.progress}|${torrent.size}|${torrent.completionOn}|${torrent.mountScanned}|${torrent.contentPath}|${torrent.name}|${torrent.pollAttempts}`;
}

/** Express server instance (last started, for backwards compat). */
let server: http.Server | null = null;
/** All active servers keyed by port — supports parallel test runs that share module state. */
const servers = new Map<number, http.Server>();

/** Status polling interval handle. */
let statusPoller: ReturnType<typeof setInterval> | null = null;

/** Mount scanning interval handle. */
let mountScanner: ReturnType<typeof setInterval> | null = null;

// ===========================================================================
// Helpers
// ===========================================================================

/** Extracts the info hash from a magnet URI. */
function extractInfoHash(magnet: string): string | null {
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (!match) return null;
  const raw = match[1];
  // Convert base32 to hex if needed — magnet spec allows 32-char base32
  if (raw.length === 32) {
    const hex = base32ToHex(raw);
    return hex ?? raw.toUpperCase();
  }
  return raw.toUpperCase();
}

/** Extracts the display name from a magnet URI. */
function extractMagnetName(magnet: string): string {
  const match = magnet.match(/[?&]dn=([^&]+)/i);
  if (match) {
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch {
      return match[1];
    }
  }
  const hash = extractInfoHash(magnet);
  return hash ? `torrent-${hash.slice(0, 8)}` : 'unknown-torrent';
}

/** Returns the base download path for symlinks. */
export function getDownloadsPath(): string {
  return config.arrDownloadsPath || path.join(config.mountBase, 'downloads');
}

/**
 * Removes an Arr bridge staging directory without following its symlinks.
 *
 * Staging entries are disposable local links: the provider mount is the
 * source of truth and the organised library has its own links. Keep this
 * operation constrained to the configured downloads root so an Arr request
 * can never remove a provider or organised-library path by mistake.
 */
export async function cleanupStagingPath(stagingPath: string): Promise<boolean> {
  const downloadsRoot = path.resolve(getDownloadsPath());
  const candidate = path.resolve(stagingPath);
  const relative = path.relative(downloadsRoot, candidate);

  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    console.warn(`${LOG_PREFIX} Refusing to clean staging path outside downloads root`, {
      stagingPath: candidate,
      downloadsRoot,
    });
    return false;
  }

  try {
    await fsp.rm(candidate, { recursive: true, force: true });
    return true;
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Failed to clean staging path`, {
      stagingPath: candidate,
      err: err?.message || String(err),
    });
    return false;
  }
}

/** Ensures the downloads staging directory exists. */
async function ensureDownloadsDir(): Promise<void> {
  const dir = getDownloadsPath();
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch {
    // Already exists
  }
}

/**
 * Create a symlink whose target remains valid if *arr moves the link out of
 * the staging directory. The target is deliberately absolute: the existing
 * bridge contract requires SchroDrive and *arr to expose the shared mount at
 * the same path inside their containers.
 */
export async function createStableSymlink(sourcePath: string, symlinkPath: string): Promise<void> {
  await fsp.mkdir(path.dirname(symlinkPath), { recursive: true });
  try { await fsp.unlink(symlinkPath); } catch { /* doesn't exist */ }
  await fsp.symlink(path.resolve(sourcePath), symlinkPath);
}

// ===========================================================================
// Debrid Status Polling
// ===========================================================================

/**
 * Polls debrid providers for status of all tracked torrents that are
 * still downloading. Updates progress and state accordingly.
 */
export async function pollDebridStatus(): Promise<void> {
  const pending = [...tracked.values()].filter(
    shouldPollTorrent,
  );

  if (pending.length === 0) return;

  // Provider listings are discovery signals; absence is not proof of failure.
  const providers = registry.ordered();
  const allTorrents: Array<{ provider: string; id: string; status: string; progress: number; bytes: number; name: string }> = [];

  for (const p of providers) {
    try {
      const torrents = await p.listTorrents();
      for (const t of torrents) {
        allTorrents.push({
          id: String(t.id),
          provider: p.id,
          status: t.status,
          progress: t.progress,
          bytes: t.bytes,
          name: t.name,
        });
      }
    } catch (err: any) {
      // Non-fatal — provider might be temporarily unavailable
    }
  }

  for (const torrent of pending) {
    const before = stateFingerprint(torrent);

    // Try to find this torrent across providers
    const info = findProviderTorrent(torrent, allTorrents);
    if (info) {
      torrent.pollAttempts = 0;
      torrent.progress = info.progress / 100; // Normalise to 0.0–1.0
      torrent.size = info.bytes || torrent.size;
      torrent.name = info.name || torrent.name;

      // Map debrid status to qBit state
      const s = info.status.toLowerCase();
      if (s === 'downloaded' || s === 'seeding' || s === 'finished' ||
          s === 'cached' || s === 'completed' || info.progress >= 100) {
        torrent.progress = 1.0;
        // Don't set to uploading yet — wait for mount scan to find files
        if (!torrent.mountScanned) {
          torrent.state = 'stalledDL'; // Signal: ready but waiting for mount
        }
      } else if (s === 'error' || s === 'dead' || s === 'failed') {
        torrent.state = 'error';
      } else if (s === 'queued' || s === 'waiting') {
        torrent.state = 'queuedDL';
      } else {
        torrent.state = 'downloading';
      }
    }
    if (before !== stateFingerprint(torrent)) persistTrackedTorrent(torrent);
  }
}

// ===========================================================================
// Mount Scanning + Symlink Creation
// ===========================================================================

/**
 * Scans rclone mount paths for files belonging to tracked torrents
 * that are ready (progress = 1.0) but haven't been symlinked yet.
 */
export async function scanMountsForCompleted(): Promise<void> {
  const ready = [...tracked.values()].filter(
    (t) => t.progress >= 1.0 && !t.mountScanned && t.state !== 'error',
  );

  if (ready.length === 0) return;

  await ensureDownloadsDir();

  for (const torrent of ready) {
    try {
      // Search across all provider mount dirs for matching torrent folder
      const providers = config.providers;
      let foundPath: string | null = null;
      let foundFiles: Array<{ name: string; size: number; path: string }> = [];

      for (const providerId of providers) {
        const providerRoot = path.join(config.mountBase, providerId);
        const allDir = path.join(providerRoot, '__all__');

        // Check __all__ directory first (Zurg-style layout)
        const searchDirs = [allDir, providerRoot];

        for (const searchDir of searchDirs) {
          try {
            const match = await findBestMountMatch(searchDir, torrent.name);
            if (match) {
              foundPath = match.path;
              foundFiles = match.files;
            }
            if (foundPath) break;
          } catch {
            // Directory doesn't exist or isn't accessible — skip
          }
        }
        if (foundPath) break;
      }

      if (foundPath && foundFiles.length > 0) {
        // Create symlinks in the downloads staging directory
        const torrentDir = path.join(getDownloadsPath(), torrent.category || '', sanitiseName(torrent.name));
        await fsp.mkdir(torrentDir, { recursive: true });

        for (const file of foundFiles) {
            const symlinkPath = path.join(torrentDir, file.name);
          try {
            await createStableSymlink(file.path, symlinkPath);
          } catch (err: any) {
            console.error(`${LOG_PREFIX} Failed to create symlink for ${file.name}: ${err?.message}`);
          }
        }

        torrent.mountPath = foundPath;
        torrent.symlinkPath = torrentDir;
        torrent.files = foundFiles;
        torrent.mountScanned = true;
        torrent.state = 'pausedUP'; // Completed — *arr will import from here
        torrent.completionOn = Math.floor(Date.now() / 1000);
        torrent.savePath = path.join(getDownloadsPath(), torrent.category || '');
        torrent.contentPath = torrentDir;
        torrent.size = foundFiles.reduce((sum, f) => sum + f.size, 0);
        persistTrackedTorrent(torrent);

        console.log(`${LOG_PREFIX} ✅ Torrent "${torrent.name}" completed — ${foundFiles.length} file(s) symlinked to ${torrentDir}`);
      }
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Mount scan error for "${torrent.name}": ${err?.message}`);
    }
  }
}

type MountMatch = {
  path: string;
  files: Array<{ name: string; size: number; path: string }>;
  score: number;
};

function normaliseMountName(value: string): string {
  return value
    .replace(/[.](mkv|mp4|avi|mov|wmv|m4v|ts|m2ts|webm)$/i, '')
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resolve a completed torrent to its best mount entry. */
export async function findBestMountMatch(searchDir: string, torrentName: string): Promise<MountMatch | null> {
  const entries = await fsp.readdir(searchDir, { withFileTypes: true });
  const target = normaliseMountName(torrentName);
  if (!target) return null;
  const targetPrefix = target.slice(0, 20);
  const directories: MountMatch[] = [];
  const files: MountMatch[] = [];

  for (const entry of entries) {
    const fullPath = path.join(searchDir, entry.name);
    const candidate = normaliseMountName(entry.name);
    const exact = candidate === target;
    const prefix = candidate.startsWith(targetPrefix) || target.startsWith(candidate.slice(0, 20));
    if (!exact && !prefix && !candidate.includes(target) && !target.includes(candidate)) continue;

    if (entry.isDirectory()) {
      const discovered = await scanDirRecursive(fullPath);
      if (!discovered.length) continue;
      directories.push({ path: fullPath, files: discovered, score: (exact ? 100000 : 1000) + discovered.length });
    } else if (entry.isFile() && isVideoFile(entry.name)) {
      const stat = await fsp.stat(fullPath);
      files.push({ path: searchDir, files: [{ name: entry.name, size: stat.size, path: fullPath }], score: exact ? 100000 : 1 });
    }
  }

  return [...directories, ...files].sort((a, b) => b.score - a.score)[0] || null;
}

/** Recursively scans a directory for video files. */
export async function scanDirRecursive(
  dir: string,
  rootDir = dir,
): Promise<Array<{ name: string; size: number; path: string }>> {
  const results: Array<{ name: string; size: number; path: string }> = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await scanDirRecursive(full, rootDir));
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        const stat = await fsp.stat(full);
        results.push({ name: path.relative(rootDir, full), size: stat.size, path: full });
      }
    }
  } catch {
    // Permission denied or mount not ready
  }
  return results;
}

/** Checks if a filename is a video file. */
function isVideoFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ['.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v', '.webm'].includes(ext);
}

/** Checks if a filename is any media file (*arr cares about). */
function isMediaFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return [
    '.mkv', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.ts', '.m4v', '.webm',
    '.srt', '.ass', '.sub', '.idx', '.ssa', '.vtt',
    '.nfo', '.jpg', '.jpeg', '.png',
  ].includes(ext);
}



// ===========================================================================
// qBittorrent API v2 — Route Handlers
// ===========================================================================

/** POST /api/v2/auth/login */
function handleLogin(_req: Request, res: Response): void {
  // Always accept — no real auth needed (internal network)
  res.setHeader('Set-Cookie', 'SID=schrodrive; Path=/');
  res.send('Ok.');
}

/**
 * Parse qBittorrent's multipart form requests without buffering file uploads.
 *
 * Radarr and Sonarr switch from urlencoded data to multipart when the magnet
 * URI is larger than their form-data threshold.  The qBittorrent endpoint is
 * field-oriented for the URL path, so PR0 only collects fields and drains any
 * file stream; it deliberately does not claim to support `.torrent` uploads.
 */
function parseMultipartForm(req: Request, res: Response, next: (err?: unknown) => void): void {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: req.headers,
      limits: {
        fields: 64,
        fieldSize: 5 * 1024 * 1024,
        files: 1,
        fileSize: 10 * 1024 * 1024,
        parts: 128,
      },
    });
  } catch (err) {
    next(err);
    return;
  }

  const body: Record<string, string | string[]> = {};
  const addField = (name: string, value: string): void => {
    const previous = body[name];
    if (previous === undefined) body[name] = value;
    else if (Array.isArray(previous)) previous.push(value);
    else body[name] = [previous, value];
  };

  let completed = false;
  const done = (err?: unknown): void => {
    if (completed) return;
    completed = true;
    if (err) return next(err);
    req.body = body;
    next();
  };

  parser.on('field', (name, value) => addField(name, value));
  // Drain unexpected file parts so the request can complete without creating
  // temporary files. Binary `.torrent` upload remains intentionally unsupported.
  parser.on('file', (_name, file) => file.resume());
  // Busboy can emit limit events instead of error for exceeded limits — ensure we still continue.
  parser.on('fieldsLimit', () => console.warn(`${LOG_PREFIX} multipart fields limit exceeded`));
  parser.on('filesLimit', () => console.warn(`${LOG_PREFIX} multipart files limit exceeded`));
  parser.on('partsLimit', () => console.warn(`${LOG_PREFIX} multipart parts limit exceeded`));
  parser.once('error', done);
  parser.once('close', () => done());
  parser.once('finish', () => done());

  req.pipe(parser);
}

/** GET /api/v2/auth/logout */
function handleLogout(_req: Request, res: Response): void {
  res.send('Ok.');
}

/** GET /api/v2/app/version */
function handleAppVersion(_req: Request, res: Response): void {
  res.send(FAKE_QBIT_VERSION);
}

/** GET /api/v2/app/webapiVersion */
function handleWebApiVersion(_req: Request, res: Response): void {
  res.send(FAKE_WEBAPI_VERSION);
}

/** GET /api/v2/app/preferences */
function handlePreferences(_req: Request, res: Response): void {
  res.json({
    save_path: getDownloadsPath(),
    temp_path_enabled: false,
    temp_path: '',
    max_active_downloads: 100,
    max_active_torrents: 100,
    max_active_uploads: 100,
    queueing_enabled: false,
    locale: 'en',
  });
}

/** GET /api/v2/app/buildInfo */
function handleBuildInfo(_req: Request, res: Response): void {
  res.json({
    qt: '6.7.0',
    libtorrent: '2.0.10.0',
    boost: '1.85.0',
    openssl: '3.3.0',
    bitness: 64,
  });
}

/** POST /api/v2/torrents/add — The main endpoint *arr uses to add magnets. */
async function handleAddTorrent(req: Request, res: Response): Promise<void> {
  try {
    const urls = req.body?.urls as string | undefined;
    const category = req.body?.category as string || '';
    const tags = req.body?.tags as string || '';
    const savePath = req.body?.savepath as string || getDownloadsPath();

    if (!urls) {
      res.status(400).send('No URLs provided');
      return;
    }

    // Split by newline — Radarr sends one magnet per request usually
    const magnets = urls.split('\n').map((s: string) => s.trim()).filter(Boolean);

    for (const magnet of magnets) {
      const hash = extractInfoHash(magnet);
      if (!hash) {
        console.warn(`${LOG_PREFIX} Could not extract info hash from magnet — skipping`);
        continue;
      }

      // Skip if already tracked
      if (tracked.has(hash)) {
        console.log(`${LOG_PREFIX} Torrent ${hash.slice(0, 8)}... already tracked — skipping`);
        continue;
      }

      const name = extractMagnetName(magnet);
      console.log(`${LOG_PREFIX} Adding torrent: "${name}" (${hash.slice(0, 8)}...) [category: ${category}]`);

      // Create tracking entry
      const torrent: TrackedTorrent = {
        hash,
        name,
        magnet,
        state: 'downloading',
        progress: 0,
        size: 0,
        addedOn: Math.floor(Date.now() / 1000),
        completionOn: -1,
        category,
        tags,
        savePath: path.join(savePath, category),
        contentPath: '',
        providerResults: [],
        files: [],
        pollAttempts: 0,
        mountScanned: false,
      };

      tracked.set(hash, torrent);
      persistTrackedTorrent(torrent);

      // Submit to debrid providers in background (don't block the response)
      const addStrategy = config.addStrategy || 'all';
      registry.addMagnetWithStrategy(magnet, name, addStrategy)
        .then(({ results }) => {
          torrent.providerResults = results.map((r) => ({
            provider: r.provider,
            id: r.result?.id || '',
            success: r.success,
          }));

          const successCount = results.filter((r) => r.success).length;
          if (successCount === 0) {
            torrent.state = 'error';
            console.error(`${LOG_PREFIX} ❌ All providers failed for "${name}"`);
          } else {
            console.log(`${LOG_PREFIX} ✅ Submitted "${name}" to ${successCount} provider(s)`);
          }
          persistTrackedTorrent(torrent);
        })
        .catch((err: any) => {
          torrent.state = 'error';
          persistTrackedTorrent(torrent);
          console.error(`${LOG_PREFIX} ❌ Failed to submit "${name}": ${err?.message}`);
        });
    }

    res.send('Ok.');
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Add torrent error: ${err?.message}`);
    res.status(500).send('Internal server error');
  }
}

/** GET /api/v2/torrents/info — Returns the list of all tracked torrents. */
function handleTorrentInfo(req: Request, res: Response): void {
  const filter = req.query.filter as string | undefined;
  const category = req.query.category as string | undefined;
  const hashes = req.query.hashes as string | undefined;

  let torrents = [...tracked.values()];

  // Filter by category
  if (category) {
    torrents = torrents.filter((t) => t.category === category);
  }

  // Filter by specific hashes
  if (hashes) {
    const hashSet = new Set(hashes.split('|').map((h) => h.toUpperCase()));
    torrents = torrents.filter((t) => hashSet.has(t.hash));
  }

  // Filter by state
  if (filter) {
    switch (filter) {
      case 'downloading':
        torrents = torrents.filter((t) => ['downloading', 'stalledDL', 'queuedDL'].includes(t.state));
        break;
      case 'completed':
        torrents = torrents.filter((t) => ['uploading', 'stalledUP', 'pausedUP'].includes(t.state));
        break;
      case 'active':
        torrents = torrents.filter((t) => ['downloading', 'uploading'].includes(t.state));
        break;
    }
  }

  // Map to qBittorrent API format
  const response = torrents.map((t) => ({
    added_on: t.addedOn,
    amount_left: Math.round(t.size * (1 - t.progress)),
    auto_tmm: false,
    availability: t.progress,
    category: t.category,
    completed: Math.round(t.size * t.progress),
    completion_on: t.completionOn,
    content_path: t.contentPath || t.savePath,
    dl_limit: -1,
    dlspeed: t.state === 'downloading' ? 10_000_000 : 0, // Fake 10MB/s
    download_path: '',
    downloaded: Math.round(t.size * t.progress),
    downloaded_session: Math.round(t.size * t.progress),
    eta: t.state === 'downloading' ? 300 : 0,
    f_l_piece_prio: false,
    force_start: false,
    hash: t.hash.toLowerCase(),
    infohash_v1: t.hash.toLowerCase(),
    infohash_v2: '',
    last_activity: Math.floor(Date.now() / 1000),
    magnet_uri: t.magnet,
    max_ratio: -1,
    max_seeding_time: -1,
    name: t.name,
    num_complete: 100,
    num_incomplete: 0,
    num_leechs: 0,
    num_seeds: 100,
    priority: 0,
    progress: t.progress,
    ratio: 0,
    ratio_limit: -1,
    save_path: t.savePath,
    seeding_time: 0,
    seeding_time_limit: -1,
    seen_complete: t.completionOn,
    seq_dl: false,
    size: t.size,
    state: t.state,
    super_seeding: false,
    tags: t.tags,
    time_active: Math.floor(Date.now() / 1000) - t.addedOn,
    total_size: t.size,
    tracker: '',
    trackers_count: 0,
    up_limit: -1,
    uploaded: 0,
    uploaded_session: 0,
    upspeed: 0,
  }));

  res.json(response);
}

/** GET /api/v2/torrents/properties — Detailed info for a single torrent. */
function handleTorrentProperties(req: Request, res: Response): void {
  const hash = (req.query.hash as string || '').toUpperCase();
  const torrent = tracked.get(hash);

  if (!torrent) {
    res.status(404).send('Not found');
    return;
  }

  res.json({
    save_path: torrent.savePath,
    creation_date: torrent.addedOn,
    piece_size: 4194304,
    comment: `SchroDrive *arr bridge — providers: ${torrent.providerResults.map((r) => r.provider).join(', ')}`,
    total_wasted: 0,
    total_uploaded: 0,
    total_uploaded_session: 0,
    total_downloaded: Math.round(torrent.size * torrent.progress),
    total_downloaded_session: Math.round(torrent.size * torrent.progress),
    up_limit: -1,
    dl_limit: -1,
    time_elapsed: Math.floor(Date.now() / 1000) - torrent.addedOn,
    seeding_time: 0,
    nb_connections: 0,
    nb_connections_limit: 100,
    share_ratio: 0,
    addition_date: torrent.addedOn,
    completion_date: torrent.completionOn,
    created_by: 'SchroDrive',
    dl_speed_avg: 0,
    dl_speed: torrent.state === 'downloading' ? 10_000_000 : 0,
    eta: torrent.state === 'downloading' ? 300 : 0,
    last_seen: Math.floor(Date.now() / 1000),
    peers: 0,
    peers_total: 0,
    pieces_have: torrent.progress >= 1 ? 100 : Math.round(torrent.progress * 100),
    pieces_num: 100,
    reannounce: 0,
    seeds: 100,
    seeds_total: 100,
    total_size: torrent.size,
    up_speed: 0,
    up_speed_avg: 0,
  });
}

/** GET /api/v2/torrents/files — Files within a torrent. */
function handleTorrentFiles(req: Request, res: Response): void {
  const hash = (req.query.hash as string || '').toUpperCase();
  const torrent = tracked.get(hash);

  if (!torrent) {
    res.status(404).send('Not found');
    return;
  }

  const files = torrent.files.map((f, i) => ({
    index: i,
    name: f.name,
    size: f.size,
    progress: torrent.progress,
    priority: 1,
    is_seed: torrent.progress >= 1,
    piece_range: [0, 100],
    availability: torrent.progress,
  }));

  res.json(files);
}

/** POST /api/v2/torrents/delete — Remove tracked torrent. */
function handleDeleteTorrent(req: Request, res: Response): void {
  const hashes = (req.body?.hashes as string || '').toUpperCase();
  const deleteFiles = req.body?.deleteFiles === 'true' || req.body?.deleteFiles === true;

  const hashList = hashes.split('|').filter(Boolean);

  for (const hash of hashList) {
    const torrent = tracked.get(hash);
    if (torrent) {
      console.log(`${LOG_PREFIX} Removing tracked torrent: "${torrent.name}" (deleteFiles: ${deleteFiles})`);

      // Arr removes the completed download after importing it. The bridge
      // staging directory is disposable regardless of deleteFiles: it only
      // contains local symlinks, while the provider mount and organised view
      // remain untouched. deleteFiles controls Arr's client semantics, not
      // whether the bridge leaks staging links forever.
      if (torrent.symlinkPath) {
        void cleanupStagingPath(torrent.symlinkPath);
      }

      tracked.delete(hash);
      removePersistedTorrent(hash);
    }
  }

  res.send('Ok.');
}

/** POST /api/v2/torrents/pause — Pause torrent (no-op for debrid). */
function handlePause(_req: Request, res: Response): void {
  res.send('Ok.');
}

/** POST /api/v2/torrents/resume — Resume torrent (no-op for debrid). */
function handleResume(_req: Request, res: Response): void {
  res.send('Ok.');
}

/** POST /api/v2/torrents/setCategory — Update torrent category. */
function handleSetCategory(req: Request, res: Response): void {
  const hashes = (req.body?.hashes as string || '').toUpperCase();
  const category = req.body?.category as string || '';

  for (const hash of hashes.split('|').filter(Boolean)) {
    const torrent = tracked.get(hash);
    if (torrent) {
      torrent.category = category;
      torrent.savePath = path.join(getDownloadsPath(), category);
      persistTrackedTorrent(torrent);
    }
  }

  res.send('Ok.');
}

/** GET /api/v2/torrents/categories — Return known categories. */
function handleCategories(_req: Request, res: Response): void {
  const cats: Record<string, { name: string; savePath: string }> = {};

  // qBittorrent categories survive restarts. Restore categories created by
  // Radarr/Sonarr before adding categories inferred from tracked torrents.
  try {
    const rows = getDb().prepare('SELECT name, save_path FROM arr_categories').all() as Array<{ name: string; save_path: string }>;
    for (const row of rows) {
      if (row.name) cats[row.name] = { name: row.name, savePath: row.save_path };
    }
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Could not restore qBittorrent categories: ${err?.message || String(err)}`);
  }

  // Collect categories from tracked torrents
  for (const t of tracked.values()) {
    if (t.category && !cats[t.category]) {
      cats[t.category] = {
        name: t.category,
        savePath: path.join(getDownloadsPath(), t.category),
      };
    }
  }

  // Always include radarr and sonarr
  if (!cats['radarr']) {
    cats['radarr'] = { name: 'radarr', savePath: path.join(getDownloadsPath(), 'radarr') };
  }
  if (!cats['sonarr']) {
    cats['sonarr'] = { name: 'sonarr', savePath: path.join(getDownloadsPath(), 'sonarr') };
  }

  res.json(cats);
}

/** POST /api/v2/torrents/createCategory — Create a category. */
function handleCreateCategory(req: Request, res: Response): void {
  const name = String(req.body?.category || req.body?.name || '').trim();
  if (!name) {
    res.status(400).send('Missing category');
    return;
  }
  const savePath = String(req.body?.savePath || req.body?.save_path || path.join(getDownloadsPath(), name));
  try {
    getDb().prepare(`INSERT INTO arr_categories (name, save_path, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET save_path=excluded.save_path, updated_at=excluded.updated_at`)
      .run(name, savePath, Date.now());
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Could not persist qBittorrent category ${name}: ${err?.message || String(err)}`);
    res.status(500).send('Could not persist category');
    return;
  }
  res.send('Ok.');
}

/** POST /api/v2/torrents/editCategory — Edit a category. */
function handleEditCategory(req: Request, res: Response): void {
  const name = String(req.body?.category || req.body?.name || '').trim();
  if (!name) {
    res.status(400).send('Missing category');
    return;
  }
  const savePath = String(req.body?.savePath || req.body?.save_path || path.join(getDownloadsPath(), name));
  try {
    getDb().prepare(`INSERT INTO arr_categories (name, save_path, updated_at)
      VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET save_path=excluded.save_path, updated_at=excluded.updated_at`)
      .run(name, savePath, Date.now());
  } catch (err: any) {
    console.warn(`${LOG_PREFIX} Could not persist qBittorrent category ${name}: ${err?.message || String(err)}`);
    res.status(500).send('Could not persist category');
    return;
  }
  res.send('Ok.');
}

/** GET /api/v2/transfer/info — Transfer speed info. */
function handleTransferInfo(_req: Request, res: Response): void {
  const downloading = [...tracked.values()].filter((t) => t.state === 'downloading');
  res.json({
    dl_info_speed: downloading.length * 10_000_000, // Fake 10MB/s per active
    dl_info_data: 0,
    up_info_speed: 0,
    up_info_data: 0,
    dl_rate_limit: 0,
    up_rate_limit: 0,
    dht_nodes: 0,
    connection_status: 'connected',
  });
}

/** GET /api/v2/sync/maindata — Sync endpoint (used by some *arr versions). */
function handleSyncMaindata(req: Request, res: Response): void {
  const rid = Number(req.query.rid || 0);
  
  const torrents: Record<string, any> = {};
  for (const t of tracked.values()) {
    torrents[t.hash.toLowerCase()] = {
      added_on: t.addedOn,
      category: t.category,
      completion_on: t.completionOn,
      content_path: t.contentPath || t.savePath,
      hash: t.hash.toLowerCase(),
      name: t.name,
      progress: t.progress,
      save_path: t.savePath,
      size: t.size,
      state: t.state,
      tags: t.tags,
    };
  }

  res.json({
    rid: rid + 1,
    full_update: true,
    torrents,
    categories: {},
    server_state: {
      dl_info_speed: 0,
      up_info_speed: 0,
      connection_status: 'connected',
    },
  });
}

// ===========================================================================
// Public API
// ===========================================================================

/** Clears all tracked torrents — used by tests to ensure isolation between runs. */
export function clearTrackedForTests(): void {
  tracked.clear();
}

/**
 * Starts the *arr bridge (fake qBittorrent API) server.
 */
export async function startArrBridge(): Promise<void> {
  const port = config.arrBridgePort || 8282;

  // If a bridge is already listening on this port, reuse it (idempotent for shared-state parallel tests).
  if (servers.has(port)) {
    console.log(`${LOG_PREFIX} *arr bridge already listening on port ${port} — reusing`);
    return;
  }

  console.log(`${LOG_PREFIX} Starting *arr bridge (fake qBittorrent v${FAKE_QBIT_VERSION}) on port ${port}...`);

  await ensureDownloadsDir();
  loadTrackedTorrents();

  const app = express();

  // Parse URL-encoded bodies (qBit API uses form data)
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  // --- Auth ---
  app.post('/api/v2/auth/login', handleLogin);
  app.get('/api/v2/auth/logout', handleLogout);

  // --- App ---
  app.get('/api/v2/app/version', handleAppVersion);
  app.get('/api/v2/app/webapiVersion', handleWebApiVersion);
  app.get('/api/v2/app/preferences', handlePreferences);
  app.get('/api/v2/app/buildInfo', handleBuildInfo);

  // --- Torrents ---
  app.post('/api/v2/torrents/add', parseMultipartForm, handleAddTorrent);
  app.get('/api/v2/torrents/info', handleTorrentInfo);
  app.get('/api/v2/torrents/properties', handleTorrentProperties);
  app.get('/api/v2/torrents/files', handleTorrentFiles);
  app.post('/api/v2/torrents/delete', handleDeleteTorrent);
  app.post('/api/v2/torrents/pause', handlePause);
  app.post('/api/v2/torrents/resume', handleResume);
  app.post('/api/v2/torrents/setCategory', handleSetCategory);
  app.get('/api/v2/torrents/categories', handleCategories);
  app.post('/api/v2/torrents/createCategory', handleCreateCategory);
  app.post('/api/v2/torrents/editCategory', handleEditCategory);

  // --- Transfer ---
  app.get('/api/v2/transfer/info', handleTransferInfo);

  // --- Sync ---
  app.get('/api/v2/sync/maindata', handleSyncMaindata);

  // --- Health ---
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'arr-bridge',
      tracked: tracked.size,
      downloading: [...tracked.values()].filter((t) => t.state === 'downloading').length,
      completed: [...tracked.values()].filter((t) => ['uploading', 'stalledUP', 'pausedUP'].includes(t.state)).length,
    });
  });

  // --- Catch-all for unimplemented endpoints ---
  app.all('/api/v2/{*splat}', (req, res) => {
    console.log(`${LOG_PREFIX} Unimplemented endpoint: ${req.method} ${req.path}`);
    res.json({});
  });

  // Start polling services once (shared across concurrent test bridges)
  if (!statusPoller) {
    statusPoller = setInterval(() => {
      pollDebridStatus().catch((err) => {
        console.error(`${LOG_PREFIX} Status poll error: ${err?.message}`);
      });
    }, STATUS_POLL_INTERVAL_MS);
  }

  if (!mountScanner) {
    mountScanner = setInterval(() => {
      scanMountsForCompleted().catch((err) => {
        console.error(`${LOG_PREFIX} Mount scan error: ${err?.message}`);
      });
    }, MOUNT_SCAN_INTERVAL_MS);
  }

  return new Promise((resolve, reject) => {
    const s = app.listen(port, () => {
      console.log(`${LOG_PREFIX} ✅ *arr bridge listening on port ${port} (add as qBittorrent in Radarr/Sonarr)`);
      console.log(`${LOG_PREFIX}    Host: schrodrive (or container IP)`);
      console.log(`${LOG_PREFIX}    Port: ${port}`);
      console.log(`${LOG_PREFIX}    No username/password required`);
      resolve();
    });

    s.on('error', (err: any) => {
      console.error(`${LOG_PREFIX} Failed to start: ${err?.message}`);
      reject(err);
    });
    server = s;
    servers.set(port, s);

    // Ensure pollers are started only once (first bridge)
    if (servers.size === 1) {
      // already started above; if this is first port, pollers are active
    }
  });
}

/**
 * Stops the *arr bridge server(s) gracefully.
 * When config.arrBridgePort points to a known server, closes just that one;
 * otherwise closes all active servers. Pollers are stopped only when the last
 * server is gone so parallel test suites don't kill each other's timers mid-run.
 */
export async function stopArrBridge(): Promise<void> {
  // Clear in-memory tracking so a subsequent test run starts empty.
  tracked.clear();
  trackedStateLoaded = false;

  const currentPort = config.arrBridgePort;
  const targets: Array<[number, http.Server]> = [];

  if (servers.has(currentPort)) {
    const s = servers.get(currentPort)!;
    targets.push([currentPort, s]);
  } else if (servers.size > 0 && !server) {
    // No current port mapping but servers map has entries (legacy)
    for (const entry of servers.entries()) targets.push(entry);
  } else if (server) {
    // Fallback to legacy singleton
    // Try to find its port in the map, otherwise close it directly
    let found = false;
    for (const [p, s] of servers.entries()) {
      if (s === server) { targets.push([p, s]); found = true; break; }
    }
    if (!found) targets.push([currentPort || 0, server]);
  }

  // Remove from map and clear legacy ref
  for (const [p] of targets) servers.delete(p);
  if (targets.some(([, s]) => s === server)) server = null;
  if (servers.size === 0) server = null;

  // Only stop pollers when last server is gone
  if (servers.size === 0) {
    if (statusPoller) { clearInterval(statusPoller); statusPoller = null; }
    if (mountScanner) { clearInterval(mountScanner); mountScanner = null; }
  }

  if (targets.length === 0) return;

  await Promise.all(targets.map(([port, s]) => new Promise<void>((resolve) => {
    s.close(() => {
      console.log(`${LOG_PREFIX} *arr bridge stopped (port ${port})`);
      resolve();
    });
    setTimeout(() => {
      try { (s as any).closeAllConnections?.(); } catch {}
    }, 500).unref?.();
    // Safety: resolve even if close never fires (e.g. already closed)
    setTimeout(() => resolve(), 1500).unref?.();
  })));
}
