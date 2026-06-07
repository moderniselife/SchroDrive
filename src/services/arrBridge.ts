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

import express, { type Request, type Response } from 'express';
import http from 'http';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { config } from '../core/config';
import { registry } from '../providers';
import type { AddMagnetResult } from '../providers';

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

/** Express server instance. */
let server: http.Server | null = null;

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
  // Convert base32 to hex if needed
  if (raw.length === 32) {
    try {
      const buf = Buffer.from(raw, 'base64');
      return buf.toString('hex').toUpperCase();
    } catch {
      return raw.toUpperCase();
    }
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
function getDownloadsPath(): string {
  return path.join(config.mountBase, 'downloads');
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

// ===========================================================================
// Debrid Status Polling
// ===========================================================================

/**
 * Polls debrid providers for status of all tracked torrents that are
 * still downloading. Updates progress and state accordingly.
 */
async function pollDebridStatus(): Promise<void> {
  const pending = [...tracked.values()].filter(
    (t) => t.state === 'downloading' || t.state === 'stalledDL' || t.state === 'queuedDL',
  );

  if (pending.length === 0) return;

  // Fetch torrent lists from all configured providers (cached, cheap)
  const providers = registry.ordered();
  const allTorrents = new Map<string, { provider: string; status: string; progress: number; bytes: number; name: string }>();

  for (const p of providers) {
    try {
      const torrents = await p.listTorrents();
      for (const t of torrents) {
        // Try to match by info hash or name
        const key = t.name?.toUpperCase() || t.id;
        allTorrents.set(key, {
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
    torrent.pollAttempts++;

    // Try to find this torrent across providers
    let found = false;
    for (const [, info] of allTorrents) {
      // Match by name (fuzzy — torrent names might differ slightly)
      if (info.name && torrent.name &&
          (info.name.toLowerCase().includes(torrent.name.toLowerCase().slice(0, 30)) ||
           torrent.name.toLowerCase().includes(info.name.toLowerCase().slice(0, 30)))) {
        found = true;
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
        break;
      }
    }

    // If torrent has been pending for ages with no match, mark as error
    if (!found && torrent.pollAttempts > 60) { // ~15 minutes
      console.warn(`${LOG_PREFIX} Torrent "${torrent.name}" not found on any provider after ${torrent.pollAttempts} polls — marking as error`);
      torrent.state = 'error';
    }
  }
}

// ===========================================================================
// Mount Scanning + Symlink Creation
// ===========================================================================

/**
 * Scans rclone mount paths for files belonging to tracked torrents
 * that are ready (progress = 1.0) but haven't been symlinked yet.
 */
async function scanMountsForCompleted(): Promise<void> {
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
            const entries = await fsp.readdir(searchDir);
            // Look for a directory matching the torrent name
            for (const entry of entries) {
              const entryLower = entry.toLowerCase();
              const nameLower = torrent.name.toLowerCase();

              // Fuzzy match: entry contains significant portion of torrent name or vice versa
              if (entryLower.includes(nameLower.slice(0, 20)) ||
                  nameLower.includes(entryLower.slice(0, 20)) ||
                  entryLower.replace(/[.\-_]/g, ' ') === nameLower.replace(/[.\-_]/g, ' ')) {
                const fullPath = path.join(searchDir, entry);
                const stat = await fsp.stat(fullPath);

                if (stat.isDirectory()) {
                  // Scan files inside the torrent directory
                  const files = await scanDirRecursive(fullPath);
                  if (files.length > 0) {
                    foundPath = fullPath;
                    foundFiles = files;
                    break;
                  }
                } else if (stat.isFile() && isVideoFile(entry)) {
                  // Single file torrent
                  foundPath = searchDir;
                  foundFiles = [{ name: entry, size: stat.size, path: fullPath }];
                  break;
                }
              }
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
            // Create relative symlink
            const relativePath = path.relative(path.dirname(symlinkPath), file.path);
            // Remove existing symlink if it exists
            try { await fsp.unlink(symlinkPath); } catch { /* doesn't exist */ }
            await fsp.symlink(relativePath, symlinkPath);
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

        console.log(`${LOG_PREFIX} ✅ Torrent "${torrent.name}" completed — ${foundFiles.length} file(s) symlinked to ${torrentDir}`);
      }
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Mount scan error for "${torrent.name}": ${err?.message}`);
    }
  }
}

/** Recursively scans a directory for video files. */
async function scanDirRecursive(dir: string): Promise<Array<{ name: string; size: number; path: string }>> {
  const results: Array<{ name: string; size: number; path: string }> = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await scanDirRecursive(full));
      } else if (entry.isFile() && isMediaFile(entry.name)) {
        const stat = await fsp.stat(full);
        results.push({ name: entry.name, size: stat.size, path: full });
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

/** Sanitises a torrent name for use as a directory name. */
function sanitiseName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
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
        })
        .catch((err: any) => {
          torrent.state = 'error';
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

      // Clean up symlinks if requested
      if (deleteFiles && torrent.symlinkPath) {
        fsp.rm(torrent.symlinkPath, { recursive: true, force: true }).catch(() => {});
      }

      tracked.delete(hash);
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
    }
  }

  res.send('Ok.');
}

/** GET /api/v2/torrents/categories — Return known categories. */
function handleCategories(_req: Request, res: Response): void {
  const cats: Record<string, { name: string; savePath: string }> = {};

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
function handleCreateCategory(_req: Request, res: Response): void {
  // No-op — we auto-create categories
  res.send('Ok.');
}

/** POST /api/v2/torrents/editCategory — Edit a category. */
function handleEditCategory(_req: Request, res: Response): void {
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

/**
 * Starts the *arr bridge (fake qBittorrent API) server.
 */
export async function startArrBridge(): Promise<void> {
  const port = config.arrBridgePort || 8282;

  console.log(`${LOG_PREFIX} Starting *arr bridge (fake qBittorrent v${FAKE_QBIT_VERSION}) on port ${port}...`);

  await ensureDownloadsDir();

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
  app.post('/api/v2/torrents/add', handleAddTorrent);
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
  app.all('/api/v2/*', (req, res) => {
    console.log(`${LOG_PREFIX} Unimplemented endpoint: ${req.method} ${req.path}`);
    res.json({});
  });

  // Start polling services
  statusPoller = setInterval(() => {
    pollDebridStatus().catch((err) => {
      console.error(`${LOG_PREFIX} Status poll error: ${err?.message}`);
    });
  }, STATUS_POLL_INTERVAL_MS);

  mountScanner = setInterval(() => {
    scanMountsForCompleted().catch((err) => {
      console.error(`${LOG_PREFIX} Mount scan error: ${err?.message}`);
    });
  }, MOUNT_SCAN_INTERVAL_MS);

  return new Promise((resolve, reject) => {
    server = app.listen(port, () => {
      console.log(`${LOG_PREFIX} ✅ *arr bridge listening on port ${port} (add as qBittorrent in Radarr/Sonarr)`);
      console.log(`${LOG_PREFIX}    Host: schrodrive (or container IP)`);
      console.log(`${LOG_PREFIX}    Port: ${port}`);
      console.log(`${LOG_PREFIX}    No username/password required`);
      resolve();
    });

    server.on('error', (err: any) => {
      console.error(`${LOG_PREFIX} Failed to start: ${err?.message}`);
      reject(err);
    });
  });
}

/**
 * Stops the *arr bridge server gracefully.
 */
export async function stopArrBridge(): Promise<void> {
  if (statusPoller) {
    clearInterval(statusPoller);
    statusPoller = null;
  }
  if (mountScanner) {
    clearInterval(mountScanner);
    mountScanner = null;
  }
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      console.log(`${LOG_PREFIX} *arr bridge stopped`);
      server = null;
      resolve();
    });
  });
}
