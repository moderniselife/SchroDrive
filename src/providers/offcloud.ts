/**
 * SchroDrive — Offcloud Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Offcloud
 * debrid service. Wraps the Offcloud Cloud API (download listing,
 * magnet addition, status checking, download URL resolution) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * Offcloud authenticates via `apikey: <KEY>` header on all requests.
 * Response format: Direct JSON (no wrapper).
 *
 * @module providers/offcloud
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

const PROVIDER_NAME = 'offcloud';



// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'offcloud_torrents';

// ===========================================================================
// Offcloud Status Mapping
// ===========================================================================

/**
 * Offcloud uses plain string statuses for download state.
 *
 * Known statuses:
 * - "downloading" — actively downloading
 * - "downloaded"  — fully downloaded and available
 * - "error"       — download failed
 * - "created"     — newly created, waiting to start
 */

/** Status strings that indicate an error / dead download. */
const ERROR_STATUSES = new Set(['error']);

/** Status strings indicating the download is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['downloaded']);

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the Offcloud API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl(): string {
  return (config.offcloudApiBase || 'https://offcloud.com/api').replace(/\/$/, '');
}

/**
 * Builds the authentication headers for Offcloud API requests.
 * Uses apikey header authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A headers object containing the apikey.
 */
function authHeaders(overrideToken?: string): Record<string, string> {
  return {
    apikey: overrideToken || config.offcloudApiKey,
  };
}



/**
 * Validates an Offcloud API response and throws on error.
 *
 * Offcloud returns direct JSON without a wrapper. Errors are typically
 * indicated by an `error` field in the response body or HTTP status codes.
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
    throw new Error(`Offcloud ${operation} failed: ${errMsg}`);
  }
  return body;
}

// ===========================================================================
// OffcloudProvider
// ===========================================================================

/**
 * Debrid provider implementation for Offcloud.
 *
 * Wraps all Offcloud-specific API interactions behind the standard
 * {@link DebridProvider} interface, including cloud download management,
 * WebDAV bridge support, and mount configuration.
 *
 * Offcloud uses a cloud download model where URLs/magnets are submitted
 * via `POST /cloud` and tracked via `GET /cloud/status?requestId=ID`.
 * Completed downloads provide direct download URLs.
 */
export class OffcloudProvider implements DebridProvider {
  readonly id = 'offcloud' as const;
  readonly displayName = 'Offcloud';

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Checks whether Offcloud is configured with a valid API key.
   *
   * @returns `true` if the Offcloud API key is set in the configuration.
   */
  isConfigured(): boolean {
    return !!config.offcloudApiKey;
  }

  /**
   * Checks whether Offcloud API requests are currently rate-limited.
   *
   * @returns `true` if the provider is in a backoff period.
   */
  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  /**
   * Returns the remaining wait time (in seconds) before Offcloud requests
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
   * Fetches the complete list of cloud downloads from Offcloud.
   * Returns cached data when rate-limited or on error.
   *
   * Uses `GET /cloud/history` which returns a direct JSON array
   * of download objects.
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
        console.warn(`[${new Date().toISOString()}][offcloud] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
        return this.normaliseTorrents(cached);
      }
      console.warn(`[${new Date().toISOString()}][offcloud] rate limited, no cache available (wait ${waitTime}s)`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud/history`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'list cloud downloads');
      const torrents = Array.isArray(data) ? data : [];

      rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, torrents);
      console.log(`[${new Date().toISOString()}][offcloud] fetched ${torrents.length} cloud download items`);
      return this.normaliseTorrents(torrents);
    } catch (err: any) {
      this.handleError(err, 'list torrents');

      const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
      if (cached) {
        console.log(`[${new Date().toISOString()}][offcloud] returning cached list on error (${cached.length} items)`);
        return this.normaliseTorrents(cached);
      }
      return [];
    }
  }

  /**
   * Adds a magnet link to Offcloud for cloud downloading.
   *
   * Uses `POST /cloud` with JSON body `{ url: "magnet:?..." }`.
   *
   * @param magnet - The magnet URI to add.
   * @param _name - Unused (Offcloud derives the name from the magnet).
   * @returns An object containing the cloud download `id` (requestId).
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addMagnet(magnet: string, _name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`Offcloud rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud`;
      const res = await axiosIPv4.post(url, { url: magnet }, {
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'add magnet');
      const id = String(data?.requestId || data?.id || '');

      if (!id) {
        throw new Error('Offcloud cloud/add returned no ID');
      }

      console.log(`[${new Date().toISOString()}][offcloud] added magnet as cloud download ${id}`);
      return { id };
    } catch (err: any) {
      this.handleError(err, 'add magnet');
      throw err;
    }
  }

  /**
   * Uploads a .torrent file buffer to Offcloud.
   *
   * Uses `POST /cloud` with multipart form data.
   * The file is sent as a `file` field in the form.
   *
   * @param fileBuffer - The raw .torrent file contents.
   * @param name - Optional human-readable name for logging.
   * @returns An object containing the cloud download `id` (requestId).
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addTorrentFile(fileBuffer: Buffer, name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`Offcloud rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud`;
      console.log(`[${new Date().toISOString()}][offcloud] Uploading .torrent file${name ? `: ${name}` : ''}`);

      const formData = new FormData();
      formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');

      const res = await axiosIPv4.post(url, formData, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'upload torrent file');
      const id = String(data?.requestId || data?.id || '');

      if (!id) {
        throw new Error('Offcloud cloud/add (file) returned no ID');
      }

      return { id };
    } catch (err: any) {
      this.handleError(err, 'add torrent file');
      throw err;
    }
  }

  /**
   * Checks whether a torrent with a matching title already exists in Offcloud.
   *
   * Fetches the current download list and performs a case-insensitive
   * bi-directional substring match.
   *
   * @param title - The title to search for among existing cloud downloads.
   * @returns `true` if a matching download already exists.
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
      console.warn(`[${new Date().toISOString()}][offcloud] check existing failed`, { error: err?.message });
      return false;
    }
  }

  /**
   * Determines whether an Offcloud download is considered "dead" (failed or errored).
   *
   * A download is NOT dead if its progress has reached 100%. Otherwise, it is
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
   * Deletes a cloud download from Offcloud by its request ID.
   *
   * Uses `POST /cloud/delete` with JSON body `{ requestId: "ID" }`.
   *
   * @param torrentId - The Offcloud request ID to delete.
   * @throws {Error} If the deletion fails.
   */
  async deleteTorrent(torrentId: string): Promise<void> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      throw new Error(`Offcloud rate limited, cannot delete download ${torrentId}`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud/delete`;
      await axiosIPv4.post(url, { requestId: torrentId }, {
        headers: {
          ...authHeaders(),
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][offcloud] deleted cloud download ${torrentId}`);
    } catch (err: any) {
      this.handleError(err, `delete download ${torrentId}`);
      throw err;
    }
  }

  /**
   * Returns the info hash for a cloud download, used for repair (re-adding).
   *
   * @param torrentId - The Offcloud request ID.
   * @returns The info hash string, or null if not available.
   */
  async getInfoHash(torrentId: string): Promise<string | null> {
    // Check cached download list first
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      const torrent = cached.find((t: any) => String(t.requestId || t.id) === String(torrentId));
      if (torrent?.hashString) return torrent.hashString;
      if (torrent?.hash) return torrent.hash;
    }

    // Fall back to API call
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) return null;
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud/history`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'get download info');
      const torrents = Array.isArray(data) ? data : [];
      const torrent = torrents.find((t: any) => String(t.requestId || t.id) === String(torrentId));
      const hash = torrent?.hashString || torrent?.hash;
      return typeof hash === 'string' && hash.length >= 32 ? hash : null;
    } catch (err: any) {
      this.handleError(err, `get info hash ${torrentId}`);
      return null;
    }
  }

  /**
   * Attempts to repair a dead download by re-adding the same magnet.
   *
   * @param torrentId - The Offcloud request ID to repair.
   * @returns `true` if repair succeeded, `false` if the download should be replaced.
   */
  async repairTorrent(torrentId: string): Promise<boolean> {
    console.log(`[${new Date().toISOString()}][offcloud] attempting repair for download ${torrentId}`);

    const infoHash = await this.getInfoHash(torrentId);
    if (!infoHash) {
      console.warn(`[${new Date().toISOString()}][offcloud] repair failed — could not get info hash for ${torrentId}`);
      return false;
    }

    try {
      await this.deleteTorrent(torrentId);
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][offcloud] repair delete failed for ${torrentId}`, { err: err?.message });
      return false;
    }

    const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
    try {
      const result = await this.addMagnet(magnet);
      if (result.id) {
        console.log(`[${new Date().toISOString()}][offcloud] repair successful — re-added as ${result.id}`, { hash: infoHash });
        return true;
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][offcloud] repair re-add failed`, { hash: infoHash, err: err?.message });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // WebDAV Bridge Support
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete download list from Offcloud and converts completed
   * downloads into virtual directories.
   *
   * Completed Offcloud downloads have a `url` field or `files` array
   * containing direct download links.
   *
   * @returns Array of virtual directories representing completed cloud downloads.
   */
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][offcloud] rate limited, skipping directory fetch`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud/history`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'fetch directories');
      const downloads: any[] = Array.isArray(data) ? data : [];

      // Only include completed downloads
      const completed = downloads.filter((t) => {
        const s = String(t.status || '').toLowerCase();
        return COMPLETED_STATUSES.has(s);
      });

      console.log(`[${new Date().toISOString()}][offcloud] fetched ${completed.length} completed downloads out of ${downloads.length} total`);

      return completed.map((t) => {
        const rawFiles: any[] = Array.isArray(t.files) ? t.files : [];
        let files: VirtualFile[];

        if (rawFiles.length > 0) {
          // Multi-file download — use the files array
          files = rawFiles.map((f: any, idx: number) => ({
            id: String(f.id ?? idx),
            name: sanitiseName(f.name || f.fileName || `file_${idx}`),
            size: typeof f.size === 'number' ? f.size : 0,
          }));
        } else if (t.url) {
          // Single-file download — create a synthetic file entry
          const fileName = t.fileName || t.name || String(t.requestId || t.id);
          files = [{
            id: '0',
            name: sanitiseName(fileName),
            size: typeof t.size === 'number' ? t.size : 0,
          }];
        } else {
          files = [];
        }

        return {
          id: String(t.requestId || t.id),
          name: sanitiseName(t.fileName || t.name || String(t.requestId || t.id)),
          originalName: t.fileName || t.name || String(t.requestId || t.id),
          files,
        };
      });
    } catch (err: any) {
      this.handleError(err, 'fetch directories');
      return [];
    }
  }

  /**
   * Resolves a direct download URL for an Offcloud file.
   *
   * For completed downloads, checks the status endpoint for the download URL
   * or files array containing direct links.
   *
   * @param torrentId - The Offcloud request ID.
   * @param fileId - The file ID or index within the download.
   * @param _linkIndex - Unused for Offcloud.
   * @returns The direct download URL, or `null` on failure.
   */
  async resolveDownloadUrl(torrentId: string, fileId: string, _linkIndex?: number): Promise<string | null> {
    const downloadToken = tokenRotator.getDownloadToken(PROVIDER_NAME) || config.offcloudApiKey;
    const isRotated = downloadToken !== config.offcloudApiKey;

    if (rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
      console.warn(`[${new Date().toISOString()}][offcloud] rate limited, cannot resolve download URL for download ${torrentId}`);
      return null;
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/cloud/status`;
      const res = await axiosIPv4.get(url, {
        headers: authHeaders(downloadToken),
        params: { requestId: torrentId },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'resolve download URL');

      // Check for files array first
      const rawFiles: any[] = Array.isArray(data?.files) ? data.files : [];
      if (rawFiles.length > 0) {
        // Try matching by file ID first, then by index
        let file = rawFiles.find((f: any) => String(f.id) === String(fileId));
        if (!file) {
          const fileIndex = parseInt(fileId, 10);
          if (!isNaN(fileIndex) && fileIndex >= 0 && fileIndex < rawFiles.length) {
            file = rawFiles[fileIndex];
          }
        }

        if (file) {
          const downloadUrl = file.url || file.downloadUrl || file.link;
          if (downloadUrl) return downloadUrl;
        }
      }

      // Fall back to single-file download URL
      if (data?.url) {
        return data.url;
      }

      console.warn(`[${new Date().toISOString()}][offcloud] no download URL found for download ${torrentId}, file ${fileId}`);
      return null;
    } catch (err: any) {
      this.handleError(err, `resolve download URL for download ${torrentId}, file ${fileId}`, downloadToken);
      const status = err?.response?.status;
      if ((status === 503 || status === 429) && downloadToken !== config.offcloudApiKey) {
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
   * Checks whether native Offcloud WebDAV credentials are configured.
   *
   * @returns `true` if all three WebDAV settings (URL, username, password) are set.
   */
  hasDirectWebDAV(): boolean {
    return !!(config.offcloudWebdavUrl && config.offcloudWebdavUsername && config.offcloudWebdavPassword);
  }

  /**
   * Checks whether the Offcloud API key is configured.
   *
   * @returns `true` if the API key is set.
   */
  hasApiKey(): boolean {
    return !!config.offcloudApiKey;
  }

  /**
   * Returns the native Offcloud WebDAV connection details.
   *
   * @returns WebDAV config object, or `null` if not fully configured.
   */
  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    if (!this.hasDirectWebDAV()) return null;
    return {
      url: config.offcloudWebdavUrl,
      username: config.offcloudWebdavUsername,
      password: config.offcloudWebdavPassword,
    };
  }

  /**
   * Returns the local port the WebDAV bridge listens on for Offcloud.
   *
   * @returns The configured bridge port (default from config).
   */
  getBridgePort(): number {
    return config.webdavBridgePortOC;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Normalises raw Offcloud API responses into the standard
   * {@link TorrentInfo} shape.
   *
   * @param rawTorrents - Array of raw download objects from the Offcloud API.
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
        name: f.name || f.fileName || '',
        path: f.name || f.fileName || '',
        size: typeof f.size === 'number' ? f.size : 0,
        selected: true,
      }));

      return {
        id: String(t.requestId || t.id || ''),
        name: t.fileName || t.name || '',
        filename: t.fileName || t.name,
        status: statusString,
        progress,
        bytes: typeof t.size === 'number' ? t.size : 0,
        files,
        addedAt: t.createdOn ? new Date(t.createdOn) : (t.created ? new Date(t.created) : undefined),
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
      if (overrideToken && overrideToken !== config.offcloudApiKey) {
        console.warn(`[${new Date().toISOString()}][offcloud] download token rate limited during ${operation}`, { status });
        return;
      }
      let backoffMs: number | undefined;
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
      }
      rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
      console.warn(`[${new Date().toISOString()}][offcloud] rate limited during ${operation}`, { status, backoffMs });
    } else {
      console.error(`[${new Date().toISOString()}][offcloud] ${operation} error: ${errorMsg}`, { status });
    }
  }
}

// ===========================================================================
// Self-Registration
// ===========================================================================

registry.register(new OffcloudProvider());

// Register with token rotator for download token cycling
tokenRotator.registerProvider(PROVIDER_NAME, config.offcloudApiKey, config.offcloudDownloadTokens);
