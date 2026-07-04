/**
 * SchroDrive — Seedr Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Seedr
 * cloud torrent service. Wraps the Seedr REST API (torrent listing,
 * magnet addition, file retrieval, download URL resolution) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * Seedr authenticates via `Authorization: Bearer <TOKEN>` header.
 * Response format: Direct JSON — `{ torrents: [...] }` for listing endpoints.
 *
 * Seedr uses a folder-based model: completed torrents create folders, files
 * are listed via `GET /folder/{folder_id}`, and individual file downloads
 * are initiated via `GET /file/{file_id}` which returns `{ url }`.
 *
 * @module providers/seedr
 */

import { axiosIPv4 } from '../core/httpClient';
import { sanitiseName } from '../core/utils';
import { config } from '../core/config';
import { rateLimiter } from '../core/rateLimiter';
import { tokenRotator } from '../core/tokenRotator';
import { UnplayableTorrentError } from '../core/errors';
import type {
  DebridProvider,
  TorrentInfo,
  TorrentFile,
  AddMagnetResult,
  VirtualDirectory,
  VirtualFile,
} from './index';
import { registry } from './registry';

// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================

const PROVIDER_NAME = 'seedr';



// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'seedr_torrents';

// ===========================================================================
// Seedr Status Mapping
// ===========================================================================

/**
 * Seedr uses plain string statuses for torrent state.
 *
 * Known statuses:
 * - "downloading" — actively downloading from peers
 * - "finished"    — fully downloaded and available
 * - "paused"      — download paused
 * - "error"       — download failed
 */

/** Status strings that indicate an error / dead torrent. */
const ERROR_STATUSES = new Set(['error']);

/** Status strings indicating the torrent is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['finished']);

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the Seedr API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl(): string {
  return (config.seedrApiBase || 'https://www.seedr.cc/rest').replace(/\/$/, '');
}

/**
 * Builds the authorisation headers for Seedr API requests.
 * Uses Bearer token authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A headers object containing the Bearer token.
 */
function authHeaders(overrideToken?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${overrideToken || config.seedrApiKey}`,
  };
}



/**
 * Validates a Seedr API response and throws on error.
 *
 * Seedr returns direct JSON without a standard wrapper. Errors may include
 * an `error` field or non-2xx HTTP status codes.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The response data.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res: any, operation: string): any {
  const body = res?.data;
  if (body?.error) {
    const errMsg = typeof body.error === 'string' ? body.error : (body.error?.message || JSON.stringify(body.error));
    throw new Error(`Seedr ${operation} failed: ${errMsg}`);
  }
  return body;
}

// ===========================================================================
// SeedrProvider
// ===========================================================================

/**
 * Debrid provider implementation for Seedr.
 *
 * Wraps all Seedr-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent management,
 * WebDAV bridge support, and mount configuration.
 *
 * Seedr uses a folder-based model: completed torrents create folders
 * accessible via `GET /folder/{folder_id}`, individual files are
 * downloaded via `GET /file/{file_id}` which returns a `{ url }` payload.
 */
export class SeedrProvider implements DebridProvider {
  readonly id = 'seedr' as const;
  readonly displayName = 'Seedr';

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Checks whether Seedr is configured with a valid API token.
   *
   * @returns `true` if the Seedr API key (token) is set in the configuration.
   */
  isConfigured(): boolean {
    return !!config.seedrApiKey;
  }

  /**
   * Checks whether Seedr API requests are currently rate-limited.
   *
   * @returns `true` if the provider is in a backoff period.
   */
  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  /**
   * Returns the remaining wait time (in seconds) before Seedr requests
   * can resume after a rate limit.
   *
   * @returns Remaining wait time in seconds, or 0 if not rate-limited.
   */
  getWaitTime(): number {
    return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
  }

  // -------------------------------------------------------------------------
  // Torrent Operations
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete list of torrents from Seedr.
   * Returns cached data when rate-limited or on error.
   *
   * Uses `GET /torrents` which returns `{ torrents: [...] }`.
   *
   * @returns An array of normalised torrent info objects.
   */
  async listTorrents(): Promise<TorrentInfo[]> {
    if (!this.isConfigured()) return [];

    // Return cached data if rate-limited
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
      if (cached) {
        console.warn(`[${new Date().toISOString()}][seedr] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
        return this.normaliseTorrents(cached);
      }
      console.warn(`[${new Date().toISOString()}][seedr] rate limited, no cache available (wait ${waitTime}s)`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'list torrents');
      const torrents = Array.isArray(data?.torrents) ? data.torrents : (Array.isArray(data) ? data : []);

      rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, torrents);
      console.log(`[${new Date().toISOString()}][seedr] fetched ${torrents.length} torrent items`);
      return this.normaliseTorrents(torrents);
    } catch (err: any) {
      this.handleError(err, 'list torrents');

      const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
      if (cached) {
        console.log(`[${new Date().toISOString()}][seedr] returning cached list on error (${cached.length} items)`);
        return this.normaliseTorrents(cached);
      }
      return [];
    }
  }

  /**
   * Adds a magnet link to Seedr for downloading.
   *
   * Uses `POST /torrents` with form data `magnet=MAGNET_URI`.
   *
   * @param magnet - The magnet URI to add.
   * @param _name - Unused (Seedr derives the name from the magnet).
   * @returns An object containing the torrent `id`.
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addMagnet(magnet: string, _name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`Seedr rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents`;
      const params = new URLSearchParams();
      params.set('magnet', magnet);

      const res = await axiosIPv4.post(url, params, {
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'add magnet');
      const id = String(data?.id || data?.torrent_id || '');

      if (!id) {
        throw new Error('Seedr torrents/add returned no ID');
      }

      console.log(`[${new Date().toISOString()}][seedr] added magnet as torrent ${id}`);
      return { id };
    } catch (err: any) {
      this.handleError(err, 'add magnet');
      throw err;
    }
  }

  /**
   * Uploads a .torrent file buffer to Seedr.
   *
   * Uses `POST /torrents` with multipart form data.
   * The file is sent as a `file` field in the form.
   *
   * @param fileBuffer - The raw .torrent file contents.
   * @param name - Optional human-readable name for logging.
   * @returns An object containing the torrent `id`.
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addTorrentFile(fileBuffer: Buffer, name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`Seedr rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents`;
      console.log(`[${new Date().toISOString()}][seedr] Uploading .torrent file${name ? `: ${name}` : ''}`);

      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');

      const res = await axiosIPv4.post(url, formData, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'upload torrent file');
      const id = String(data?.id || data?.torrent_id || '');

      if (!id) {
        throw new Error('Seedr torrents/add (file) returned no ID');
      }

      return { id };
    } catch (err: any) {
      this.handleError(err, 'add torrent file');
      throw err;
    }
  }

  /**
   * Checks whether a torrent with a matching title already exists in Seedr.
   *
   * Fetches the current torrent list and performs a case-insensitive
   * bi-directional substring match.
   *
   * @param title - The title to search for among existing torrent items.
   * @returns `true` if a matching torrent already exists.
   */
  async checkExisting(title: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    try {
      const torrents = await this.listTorrents();
      const normalised = title.toLowerCase();

      return torrents.some((t) => {
        const torrentName = (t.name || '').toLowerCase();
        return torrentName.includes(normalised) || normalised.includes(torrentName);
      });
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][seedr] check existing failed`, { error: err?.message });
      return false;
    }
  }

  /**
   * Determines whether a Seedr torrent is considered "dead" (failed or errored).
   *
   * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
   * considered dead if its status is "error" or contains "error"/"dead"/"deleted".
   *
   * @param torrent - The normalised torrent info object.
   * @returns `true` if the torrent is dead/failed.
   */
  isTorrentDead(torrent: TorrentInfo): boolean {
    const s = String(torrent?.status || '').toLowerCase();
    if (typeof torrent?.progress === 'number' && torrent.progress >= 100) return false;
    if (s.includes('error') || s.includes('dead') || s.includes('deleted')) return true;
    return false;
  }

  /**
   * Deletes a torrent from Seedr by its ID.
   *
   * Uses `DELETE /torrents/{id}`.
   *
   * @param torrentId - The Seedr torrent ID to delete.
   * @throws {Error} If the deletion fails.
   */
  async deleteTorrent(torrentId: string): Promise<void> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      throw new Error(`Seedr rate limited, cannot delete torrent ${torrentId}`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents/${encodeURIComponent(torrentId)}`;
      await axiosIPv4.delete(url, {
        headers: authHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][seedr] deleted torrent ${torrentId}`);
    } catch (err: any) {
      this.handleError(err, `delete torrent ${torrentId}`);
      throw err;
    }
  }

  /**
   * Returns the info hash for a torrent, used for repair (re-adding).
   *
   * @param torrentId - The Seedr torrent ID.
   * @returns The info hash string, or null if not available.
   */
  async getInfoHash(torrentId: string): Promise<string | null> {
    // Check cached torrent list first
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      const torrent = cached.find((t: any) => String(t.id) === String(torrentId));
      if (torrent?.hashString) return torrent.hashString;
      if (torrent?.hash) return torrent.hash;
    }

    // Fall back to API call
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) return null;
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'get torrent info');
      const torrents = Array.isArray(data?.torrents) ? data.torrents : (Array.isArray(data) ? data : []);
      const torrent = torrents.find((t: any) => String(t.id) === String(torrentId));
      const hash = torrent?.hashString || torrent?.hash;
      return typeof hash === 'string' && hash.length >= 32 ? hash : null;
    } catch (err: any) {
      this.handleError(err, `get info hash ${torrentId}`);
      return null;
    }
  }

  /**
   * Attempts to repair a dead torrent by re-adding the same magnet.
   *
   * @param torrentId - The Seedr torrent ID to repair.
   * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
   */
  async repairTorrent(torrentId: string): Promise<boolean> {
    console.log(`[${new Date().toISOString()}][seedr] attempting repair for torrent ${torrentId}`);

    const infoHash = await this.getInfoHash(torrentId);
    if (!infoHash) {
      console.warn(`[${new Date().toISOString()}][seedr] repair failed — could not get info hash for ${torrentId}`);
      return false;
    }

    try {
      await this.deleteTorrent(torrentId);
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][seedr] repair delete failed for ${torrentId}`, { err: err?.message });
      return false;
    }

    const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
    try {
      const result = await this.addMagnet(magnet);
      if (result.id) {
        console.log(`[${new Date().toISOString()}][seedr] repair successful — re-added as ${result.id}`, { hash: infoHash });
        return true;
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][seedr] repair re-add failed`, { hash: infoHash, err: err?.message });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // WebDAV Bridge Support
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete torrent list from Seedr and converts completed
   * torrents into virtual directories.
   *
   * For completed torrents, fetches files from the torrent's folder
   * via `GET /folder/{folder_id}` to populate the virtual file list.
   *
   * @returns Array of virtual directories representing completed torrent items.
   */
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][seedr] rate limited, skipping directory fetch`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/torrents`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'fetch directories');
      const torrents: any[] = Array.isArray(data?.torrents) ? data.torrents : (Array.isArray(data) ? data : []);

      // Only include completed torrents
      const completed = torrents.filter((t) => {
        const s = String(t.status || '').toLowerCase();
        return COMPLETED_STATUSES.has(s);
      });

      console.log(`[${new Date().toISOString()}][seedr] fetched ${completed.length} completed torrents out of ${torrents.length} total`);

      const directories: VirtualDirectory[] = [];

      for (const t of completed) {
        try {
          const folderId = t.folder_id || t.folderId || t.id;
          const files = await this.fetchFolderFiles(String(folderId));
          directories.push({
            id: String(t.id),
            name: sanitiseName(t.name || String(t.id)),
            originalName: t.name || String(t.id),
            files,
          });
        } catch (fileErr: any) {
          console.warn(`[${new Date().toISOString()}][seedr] failed to fetch files for torrent ${t.id}`, { error: fileErr?.message });
          directories.push({
            id: String(t.id),
            name: sanitiseName(t.name || String(t.id)),
            originalName: t.name || String(t.id),
            files: [],
          });
        }
      }

      return directories;
    } catch (err: any) {
      this.handleError(err, 'fetch directories');
      return [];
    }
  }

  /**
   * Resolves a direct download URL for a Seedr file.
   *
   * Uses `GET /file/{file_id}` which returns `{ url }` containing
   * the direct download link.
   *
   * @param torrentId - The Seedr torrent ID (used for logging context).
   * @param fileId - The Seedr file ID to download.
   * @param _linkIndex - Unused for Seedr.
   * @returns The direct download URL, or `null` on failure.
   */
  async resolveDownloadUrl(torrentId: string, fileId: string, _linkIndex?: number): Promise<string | null> {
    const downloadToken = tokenRotator.getDownloadToken(PROVIDER_NAME) || config.seedrApiKey;
    const isRotated = downloadToken !== config.seedrApiKey;

    if (rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
      console.warn(`[${new Date().toISOString()}][seedr] rate limited, cannot resolve download URL for torrent ${torrentId}`);
      return null;
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/file/${encodeURIComponent(fileId)}`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(downloadToken),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'resolve download URL');
      const downloadUrl = data?.url || data?.downloadUrl || data?.link;

      if (!downloadUrl) {
        console.warn(`[${new Date().toISOString()}][seedr] no download URL found for file ${fileId} in torrent ${torrentId}`);
        return null;
      }

      return downloadUrl;
    } catch (err: any) {
      this.handleError(err, `resolve download URL for torrent ${torrentId}, file ${fileId}`, downloadToken);
      const status = err?.response?.status;
      if ((status === 503 || status === 429) && downloadToken !== config.seedrApiKey) {
        const duration = status === 429 ? 60 * 60 * 1000 : undefined;
        tokenRotator.markTokenLimited(PROVIDER_NAME, downloadToken, `${status} ${err?.response?.statusText || 'limit'}`, duration);
      }
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Mount Configuration
  // -------------------------------------------------------------------------

  /**
   * Checks whether native Seedr WebDAV credentials are configured.
   *
   * @returns `true` if all three WebDAV settings (URL, username, password) are set.
   */
  hasDirectWebDAV(): boolean {
    return !!(config.seedrWebdavUrl && config.seedrWebdavUsername && config.seedrWebdavPassword);
  }

  /**
   * Checks whether the Seedr API token is configured.
   *
   * @returns `true` if the API token is set.
   */
  hasApiKey(): boolean {
    return !!config.seedrApiKey;
  }

  /**
   * Returns the native Seedr WebDAV connection details.
   *
   * @returns WebDAV config object, or `null` if not fully configured.
   */
  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    if (!this.hasDirectWebDAV()) return null;
    return {
      url: config.seedrWebdavUrl,
      username: config.seedrWebdavUsername,
      password: config.seedrWebdavPassword,
    };
  }

  /**
   * Returns the local port the WebDAV bridge listens on for Seedr.
   *
   * @returns The configured bridge port (default from config).
   */
  getBridgePort(): number {
    return config.webdavBridgePortSEEDR;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Fetches the file list for a given Seedr folder.
   *
   * Uses `GET /folder/{folder_id}` to retrieve child files.
   *
   * @param folderId - The Seedr folder ID to list.
   * @returns Array of virtual files in the folder.
   */
  private async fetchFolderFiles(folderId: string): Promise<VirtualFile[]> {
    await rateLimiter.throttle(PROVIDER_NAME);

    const url = `${getBaseUrl()}/folder/${encodeURIComponent(folderId)}`;
    const res = await axiosIPv4.get(url, {
      headers: authHeaders(),
      timeout: 20000,
    });
    rateLimiter.recordSuccess(PROVIDER_NAME);

    const data = unwrapResponse(res, `fetch files for folder ${folderId}`);
    const rawFiles: any[] = Array.isArray(data?.files) ? data.files : (Array.isArray(data) ? data : []);

    return rawFiles.map((f: any, idx: number) => ({
      id: String(f.id ?? idx),
      name: sanitiseName(f.name || `file_${idx}`),
      size: typeof f.size === 'number' ? f.size : 0,
    }));
  }

  /**
   * Normalises raw Seedr API responses into the standard
   * {@link TorrentInfo} shape.
   *
   * @param rawTorrents - Array of raw torrent objects from the Seedr API.
   * @returns Array of normalised torrent info objects.
   */
  private normaliseTorrents(rawTorrents: any[]): TorrentInfo[] {
    return rawTorrents.map((t) => {
      const statusString = String(t.status || '').toLowerCase();
      const progress = COMPLETED_STATUSES.has(statusString)
        ? 100
        : (typeof t.progress === 'number' ? t.progress : (typeof t.percent === 'number' ? t.percent : 0));

      const rawFiles: any[] = Array.isArray(t.files) ? t.files : [];
      const files: TorrentFile[] = rawFiles.map((f: any, idx: number) => ({
        id: String(f.id ?? idx),
        name: f.name || '',
        path: f.name || '',
        size: typeof f.size === 'number' ? f.size : 0,
        selected: true,
      }));

      return {
        id: String(t.id || ''),
        name: t.name || '',
        filename: t.name,
        status: statusString,
        progress,
        bytes: typeof t.size === 'number' ? t.size : 0,
        files,
        addedAt: t.created ? new Date(typeof t.created === 'number' ? t.created * 1000 : t.created) : undefined,
        raw: t,
      };
    });
  }

  /**
   * Centralised error handling for API requests.
   * Logs the error and records rate limits where applicable.
   *
   * @param err - The error object.
   * @param operation - A human-readable description of the failed operation.
   * @param overrideToken - Optional override token for download rotation.
   */
  private handleError(err: any, operation: string, overrideToken?: string): void {
    const errorMsg = err?.message || String(err);
    const status = err?.response?.status;
    const retryAfter = err?.response?.headers?.['retry-after'];

    if (status === 429 || status === 503 || rateLimiter.isRateLimitError(err)) {
      if (overrideToken && overrideToken !== config.seedrApiKey) {
        console.warn(`[${new Date().toISOString()}][seedr] download token rate limited during ${operation}`, { status });
        return;
      }
      let backoffMs: number | undefined;
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
      }
      rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
      console.warn(`[${new Date().toISOString()}][seedr] rate limited during ${operation}`, { status, backoffMs });
    } else {
      console.error(`[${new Date().toISOString()}][seedr] ${operation} error: ${errorMsg}`, { status });
    }
  }
}

// ===========================================================================
// Self-Registration
// ===========================================================================

registry.register(new SeedrProvider());

// Register with token rotator for download token cycling
tokenRotator.registerProvider(PROVIDER_NAME, config.seedrApiKey, config.seedrDownloadTokens);
