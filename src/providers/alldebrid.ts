/**
 * SchroDrive — AllDebrid Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the AllDebrid
 * debrid service. Wraps the AllDebrid v4 API (magnet listing, upload,
 * file selection, link unlocking) and adds WebDAV bridge support methods
 * (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * AllDebrid authenticates via `apikey` and `agent` query parameters on every request.
 * Rate limits: 12 req/s, 600 req/min.
 *
 * @module providers/alldebrid
 */

import axios from 'axios';
import https from 'https';
import http from 'http';
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

// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================

const PROVIDER_NAME = 'alldebrid';

/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosIPv4 = axios.create({ httpAgent, httpsAgent });

// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'alldebrid_torrents';

// ===========================================================================
// AllDebrid Status Code Mapping
// ===========================================================================

/**
 * Maps AllDebrid magnet status codes to human-readable strings.
 *
 * - 0: Processing — queued for processing
 * - 1: Uploading — uploading the magnet to AllDebrid
 * - 2: Downloading — actively downloading from peers
 * - 3: Compressing — compressing downloaded files
 * - 4: Finished — fully downloaded and available
 * - 5: Upload error — failed during upload
 * - 6: Download error — failed during download
 * - 7: Internal error — AllDebrid internal failure
 */
const STATUS_MAP: Record<number, string> = {
  0: 'processing',
  1: 'uploading',
  2: 'downloading',
  3: 'compressing',
  4: 'finished',
  5: 'upload_error',
  6: 'download_error',
  7: 'internal_error',
};

/** Status codes that indicate an error / dead torrent. */
const ERROR_STATUS_CODES = new Set([5, 6, 7]);

/** Status code that indicates a fully completed torrent. */
const FINISHED_STATUS_CODE = 4;

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the AllDebrid API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl(): string {
  return (config.alldebridApiBase || 'https://api.alldebrid.com/v4').replace(/\/$/, '');
}

/**
 * Builds the common query parameters required for AllDebrid API requests
 * (authentication via `apikey` + `agent`).
 *
 * @returns An object containing the `apikey` and `agent` parameters.
 */
function authParams(overrideApiKey?: string): Record<string, string> {
  return {
    apikey: overrideApiKey || config.alldebridApiKey,
    agent: config.alldebridAgent || 'schrodrive',
  };
}

/**
 * Constructs a URL with AllDebrid auth query parameters appended.
 *
 * @param path - The API path (e.g. `/v4/magnet/status`).
 * @param extra - Additional query parameters to include.
 * @param overrideApiKey - Optional API key override for token rotation.
 * @returns The fully-qualified URL string.
 */
function buildUrl(path: string, extra: Record<string, string> = {}, overrideApiKey?: string): string {
  const base = getBaseUrl();
  const url = new URL(path.startsWith('http') ? path : `${base}${path}`);
  const params = { ...authParams(overrideApiKey), ...extra };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Sanitises a string for use as a filesystem path component.
 * Removes or replaces characters that are problematic on common filesystems
 * (Windows NTFS, macOS HFS+, Linux ext4).
 *
 * @param name - The raw name to sanitise.
 * @returns A filesystem-safe string.
 */
function sanitiseName(name: string): string {
  return name
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    || 'unnamed';
}

/**
 * Extracts the response data from an AllDebrid API response.
 *
 * AllDebrid wraps all responses in `{ status: "success"|"error", data: {...} }`.
 * This helper extracts the `data` property and throws on error responses.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The unwrapped data object.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res: any, operation: string): any {
  const body = res?.data;
  if (body?.status === 'error') {
    const errMsg = body?.error?.message || body?.error?.code || 'Unknown AllDebrid error';
    throw new Error(`AllDebrid ${operation} failed: ${errMsg}`);
  }
  return body?.data ?? body;
}

// ===========================================================================
// AllDebridProvider
// ===========================================================================

/**
 * Debrid provider implementation for AllDebrid.
 *
 * Wraps all AllDebrid-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent management,
 * WebDAV bridge support, and mount configuration.
 *
 * AllDebrid embeds file details directly in the magnet status response
 * (similar to TorBox), so no additional `fetchTorrentFiles()` call is
 * needed — files are populated inline during `fetchDirectories()`.
 */
export class AllDebridProvider implements DebridProvider {
  readonly id = 'alldebrid' as const;
  readonly displayName = 'AllDebrid';

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Checks whether AllDebrid is configured with a valid API key.
   *
   * @returns `true` if the AllDebrid API key is set in the configuration.
   */
  isConfigured(): boolean {
    return !!config.alldebridApiKey;
  }

  /**
   * Checks whether AllDebrid API requests are currently rate-limited.
   *
   * @returns `true` if the provider is in a backoff period.
   */
  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  /**
   * Returns the remaining wait time (in seconds) before AllDebrid requests
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
   * Fetches the complete list of magnets from AllDebrid.
   * Returns cached data when rate-limited or on error.
   *
   * AllDebrid returns all magnets in a single request via
   * `GET /v4/magnet/status` (no pagination needed).
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
        console.warn(`[${new Date().toISOString()}][ad] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
        return this.normaliseTorrents(cached);
      }
      console.warn(`[${new Date().toISOString()}][ad] rate limited, no cache available (wait ${waitTime}s)`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = buildUrl('/magnet/status');
      const res = await axiosIPv4.get(url, { timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'list magnets');
      const magnets = Array.isArray(data?.magnets) ? data.magnets : [];

      rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, magnets);
      console.log(`[${new Date().toISOString()}][ad] fetched ${magnets.length} magnets`);
      return this.normaliseTorrents(magnets);
    } catch (err: any) {
      this.handleError(err, 'list torrents');

      const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
      if (cached) {
        console.log(`[${new Date().toISOString()}][ad] returning cached list on error (${cached.length} items)`);
        return this.normaliseTorrents(cached);
      }
      return [];
    }
  }

  /**
   * Adds a magnet link to AllDebrid for downloading, then automatically
   * selects all files within the created magnet.
   *
   * Uses `POST /v4/magnet/upload` with `magnets[]=MAGNET`, followed by
   * `POST /v4/magnet/selectFiles` with `id=ID&files[]=all`.
   *
   * Throws if rate-limited or if the API request fails.
   *
   * @param magnet - The magnet URI to add.
   * @param _name - Unused (AllDebrid doesn't support naming magnets). Kept for interface compatibility.
   * @returns An object containing the magnet `id` from the AllDebrid response.
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addMagnet(magnet: string, _name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`AllDebrid rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      // Step 1: Upload the magnet
      const uploadUrl = buildUrl('/magnet/upload');
      const params = new URLSearchParams();
      params.set('magnets[]', magnet);

      const uploadRes = await axiosIPv4.post(uploadUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const uploadData = unwrapResponse(uploadRes, 'upload magnet');
      // AllDebrid returns { magnets: [{ id, name, ... }] }
      const magnetEntries = Array.isArray(uploadData?.magnets) ? uploadData.magnets : [];
      const firstMagnet = magnetEntries[0];
      const id = String(firstMagnet?.id || '');

      if (!id) {
        throw new Error('AllDebrid upload returned no magnet ID');
      }

      // Step 2: Select all files
      await this.selectAllFiles(id);

      return { id };
    } catch (err: any) {
      this.handleError(err, 'add magnet');
      throw err;
    }
  }

  /**
   * Selects all files within an AllDebrid magnet for download.
   *
   * Called internally after adding a magnet to ensure all files in the
   * torrent are queued for retrieval by the debrid service.
   *
   * Uses `POST /v4/magnet/selectFiles` with `id=ID&files[]=all`.
   *
   * @param id - The AllDebrid magnet ID to select files for.
   */
  private async selectAllFiles(id: string): Promise<void> {
    if (!id) return;

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      console.warn(`[${new Date().toISOString()}][ad] rate limited, skipping select files (wait ${waitTime}s)`);
      return;
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = buildUrl('/magnet/selectFiles');
      const params = new URLSearchParams();
      params.set('id', id);
      params.set('files[]', 'all');

      await axiosIPv4.post(url, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
    } catch (err: any) {
      this.handleError(err, `select all files for magnet ${id}`);
    }
  }

  /**
   * Checks whether a magnet with a matching title already exists in AllDebrid.
   *
   * Fetches the current magnet list and performs a case-insensitive
   * bi-directional substring match (search ⊂ magnet name or
   * magnet name ⊂ search) to catch partial matches.
   *
   * @param title - The title to search for among existing magnets.
   * @returns `true` if a matching magnet already exists.
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
      console.warn(`[${new Date().toISOString()}][ad] check existing failed`, { error: err?.message });
      return false;
    }
  }

  /**
   * Determines whether an AllDebrid magnet is considered "dead" (failed or errored).
   *
   * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
   * considered dead if its status maps to an error status code (5, 6, or 7)
   * or contains "error" in the status string.
   *
   * @param torrent - The normalised torrent info object.
   * @returns `true` if the torrent is dead/failed.
   */
  isTorrentDead(torrent: TorrentInfo): boolean {
    const s = String(torrent?.status || '').toLowerCase();
    // Completed torrents are never dead, regardless of status string
    if (typeof torrent?.progress === 'number' && torrent.progress >= 100) return false;
    if (s.includes('error') || s.includes('dead')) return true;
    return false;
  }

  /**
   * Deletes a magnet from AllDebrid by its ID.
   *
   * Uses the `GET /v4/magnet/delete?id=ID` endpoint. Rate-limit aware.
   *
   * @param torrentId - The AllDebrid magnet ID to delete.
   * @throws {Error} If the deletion fails.
   */
  async deleteTorrent(torrentId: string): Promise<void> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      throw new Error(`AllDebrid rate limited, cannot delete torrent ${torrentId}`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = buildUrl('/magnet/delete', { id: torrentId });
      await axiosIPv4.get(url, { timeout: 20000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][ad] deleted magnet ${torrentId}`);
    } catch (err: any) {
      this.handleError(err, `delete torrent ${torrentId}`);
      throw err;
    }
  }

  /**
   * Returns the info hash for a magnet, used for repair (re-adding).
   *
   * Fetches the magnet info from AllDebrid and returns the hash field.
   * AllDebrid exposes the hash via `GET /v4/magnet/status?id=ID`.
   *
   * @param torrentId - The AllDebrid magnet ID.
   * @returns The info hash string, or null if not available.
   */
  async getInfoHash(torrentId: string): Promise<string | null> {
    // Check cached torrent list first (avoid unnecessary API call)
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      const magnet = cached.find((m: any) => String(m.id) === String(torrentId));
      if (magnet?.hash) return magnet.hash;
    }

    // Fall back to API call for specific magnet
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) return null;
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = buildUrl('/magnet/status', { id: torrentId });
      const res = await axiosIPv4.get(url, { timeout: 20000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'get magnet info');
      // Single magnet query returns { magnets: { ... } } (object, not array)
      const magnet = Array.isArray(data?.magnets) ? data.magnets[0] : data?.magnets;
      const hash = magnet?.hash;
      return typeof hash === 'string' && hash.length >= 32 ? hash : null;
    } catch (err: any) {
      this.handleError(err, `get info hash ${torrentId}`);
      return null;
    }
  }

  /**
   * Attempts to repair a dead magnet by re-adding the same magnet.
   *
   * Flow:
   * 1. Fetch the info hash from the dead magnet
   * 2. Delete the broken magnet
   * 3. Re-add the same magnet to AllDebrid
   * 4. If successful → repaired; if failed → needs replacement
   *
   * @param torrentId - The AllDebrid magnet ID to repair.
   * @returns `true` if repair succeeded, `false` if the magnet should be replaced.
   */
  async repairTorrent(torrentId: string): Promise<boolean> {
    console.log(`[${new Date().toISOString()}][ad] attempting repair for magnet ${torrentId}`);

    // Step 1: Get the info hash before deletion
    const infoHash = await this.getInfoHash(torrentId);
    if (!infoHash) {
      console.warn(`[${new Date().toISOString()}][ad] repair failed — could not get info hash for ${torrentId}`);
      return false;
    }

    // Step 2: Delete the broken magnet
    try {
      await this.deleteTorrent(torrentId);
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][ad] repair delete failed for ${torrentId}`, { err: err?.message });
      return false;
    }

    // Step 3: Re-add the same magnet
    const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
    try {
      const result = await this.addMagnet(magnet);
      if (result.id) {
        console.log(`[${new Date().toISOString()}][ad] repair successful — re-added as ${result.id}`, { hash: infoHash });
        return true;
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][ad] repair re-add failed`, { hash: infoHash, err: err?.message });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // WebDAV Bridge Support
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete magnet list from AllDebrid and converts it into
   * virtual directories. Only includes fully downloaded magnets
   * (statusCode === 4 / "finished").
   *
   * AllDebrid embeds file details directly in the magnet status response
   * (similar to TorBox), so files are populated inline — no separate
   * `fetchTorrentFiles()` call is needed.
   *
   * @returns Array of virtual directories representing completed AllDebrid magnets.
   */
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][ad] rate limited, skipping directory fetch`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = buildUrl('/magnet/status');
      const res = await axiosIPv4.get(url, { timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'fetch directories');
      const magnets: any[] = Array.isArray(data?.magnets) ? data.magnets : [];

      // Only include fully downloaded magnets (statusCode 4 = finished)
      const completed = magnets.filter((m) => {
        const statusCode = typeof m.statusCode === 'number' ? m.statusCode : -1;
        return statusCode === FINISHED_STATUS_CODE;
      });

      console.log(`[${new Date().toISOString()}][ad] fetched ${completed.length} completed magnets out of ${magnets.length} total`);

      return completed.map((m) => {
        // AllDebrid files use: n (name), s (size), l (link)
        const rawLinks: any[] = Array.isArray(m.links) ? m.links : [];
        const files: VirtualFile[] = rawLinks.map((link: any, idx: number) => ({
          id: String(idx),
          name: sanitiseName(link.filename || link.n || `file_${idx}`),
          size: typeof link.size === 'number' ? link.size : (typeof link.s === 'number' ? link.s : 0),
        }));

        return {
          id: String(m.id),
          name: sanitiseName(m.filename || m.name || String(m.id)),
          originalName: m.filename || m.name || String(m.id),
          files,
        };
      });
    } catch (err: any) {
      this.handleError(err, 'fetch directories');
      return [];
    }
  }

  /**
   * Resolves a direct download URL for an AllDebrid file by unlocking the
   * corresponding link via `POST /v4/link/unlock`.
   *
   * AllDebrid embeds download links in the magnet status response. We fetch
   * the magnet info, extract the link at the given file index, then unlock it
   * to obtain the final direct download URL.
   *
   * @param torrentId - The AllDebrid magnet ID.
   * @param fileId - The file index within the magnet's links array.
   * @param _linkIndex - Unused for AllDebrid (we use fileId as the index).
   * @returns The direct download URL, or `null` on failure.
   */
  async resolveDownloadUrl(torrentId: string, fileId: string, _linkIndex?: number): Promise<string | null> {
    const downloadToken = tokenRotator.getDownloadToken(PROVIDER_NAME) || config.alldebridApiKey;
    const isRotated = downloadToken !== config.alldebridApiKey;

    if (rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
      console.warn(`[${new Date().toISOString()}][ad] rate limited, cannot resolve download URL for magnet ${torrentId}`);
      return null;
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      // Fetch the magnet info to retrieve the file link
      const infoUrl = buildUrl('/magnet/status', { id: torrentId }, downloadToken);
      const infoRes = await axiosIPv4.get(infoUrl, { timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const infoData = unwrapResponse(infoRes, 'magnet info');
      // When querying a single magnet, AllDebrid returns { magnets: { ... } } (object, not array)
      const magnet = Array.isArray(infoData?.magnets) ? infoData.magnets[0] : infoData?.magnets;
      const rawLinks: any[] = Array.isArray(magnet?.links) ? magnet.links : [];

      const fileIndex = parseInt(fileId, 10);
      if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= rawLinks.length) {
        throw new UnplayableTorrentError(`File index ${fileId} out of range (${rawLinks.length} links) for magnet ${torrentId}`);
      }

      const fileLink = rawLinks[fileIndex]?.link || rawLinks[fileIndex]?.l;
      if (!fileLink) {
        console.error(`[${new Date().toISOString()}][ad] no link found at index ${fileId} for magnet ${torrentId}`);
        return null;
      }

      // Unlock the link to get the direct download URL
      await rateLimiter.throttle(PROVIDER_NAME);
      const unlockUrl = buildUrl('/link/unlock', {}, downloadToken);
      const params = new URLSearchParams();
      params.set('link', fileLink);

      const unlockRes = await axiosIPv4.post(unlockUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const unlockData = unwrapResponse(unlockRes, 'unlock link');
      const downloadUrl = unlockData?.link;

      if (!downloadUrl) {
        console.error(`[${new Date().toISOString()}][ad] unlock returned no download URL for magnet ${torrentId}, file ${fileId}`);
        return null;
      }

      return downloadUrl;
    } catch (err: any) {
      this.handleError(err, `resolve download URL for magnet ${torrentId}, file ${fileId}`, downloadToken);
      const status = err?.response?.status;
      if ((status === 503 || status === 429) && downloadToken !== config.alldebridApiKey) {
        const duration = status === 429 ? 60 * 60 * 1000 : undefined; // 1 hour for 429
        tokenRotator.markTokenLimited(PROVIDER_NAME, downloadToken, `${status} ${err?.response?.statusText || 'limit'}`, duration);
      }
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Mount Configuration
  // -------------------------------------------------------------------------

  /**
   * Checks whether native AllDebrid WebDAV credentials are configured.
   *
   * @returns `true` if all three WebDAV settings (URL, username, password) are set.
   */
  hasDirectWebDAV(): boolean {
    return !!(config.alldebridWebdavUrl && config.alldebridWebdavUsername && config.alldebridWebdavPassword);
  }

  /**
   * Checks whether the AllDebrid API key is configured.
   *
   * @returns `true` if the API key is set.
   */
  hasApiKey(): boolean {
    return !!config.alldebridApiKey;
  }

  /**
   * Returns the native AllDebrid WebDAV connection details.
   *
   * @returns WebDAV config object, or `null` if not fully configured.
   */
  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    if (!this.hasDirectWebDAV()) return null;
    return {
      url: config.alldebridWebdavUrl,
      username: config.alldebridWebdavUsername,
      password: config.alldebridWebdavPassword,
    };
  }

  /**
   * Returns the local port the WebDAV bridge listens on for AllDebrid.
   *
   * @returns The configured bridge port (default: 9117).
   */
  getBridgePort(): number {
    return config.webdavBridgePortAD;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Normalises raw AllDebrid magnet API responses into the standard {@link TorrentInfo} shape.
   *
   * AllDebrid uses `statusCode` for numeric state and embeds files/links directly
   * in the magnet response.
   *
   * @param rawMagnets - Array of raw magnet objects from the AllDebrid API.
   * @returns Array of normalised torrent info objects.
   */
  private normaliseTorrents(rawMagnets: any[]): TorrentInfo[] {
    return rawMagnets.map((m) => {
      const statusCode = typeof m.statusCode === 'number' ? m.statusCode : -1;
      const statusString = STATUS_MAP[statusCode] || m.status || '';
      const progress = statusCode === FINISHED_STATUS_CODE
        ? 100
        : (typeof m.downloadSpeed === 'number' && typeof m.size === 'number' && m.size > 0
          ? Math.round(((m.downloaded || 0) / m.size) * 100)
          : 0);

      // AllDebrid's links array serves as both files and download links
      const rawLinks: any[] = Array.isArray(m.links) ? m.links : [];
      const files: TorrentFile[] = rawLinks.map((link: any, idx: number) => ({
        id: String(idx),
        name: link.filename || link.n || '',
        path: link.filename || link.n || '',
        size: typeof link.size === 'number' ? link.size : (typeof link.s === 'number' ? link.s : 0),
        selected: true, // AllDebrid selects all files after selectFiles call
      }));

      return {
        id: String(m.id || ''),
        name: m.filename || m.name || '',
        filename: m.filename || m.name,
        status: statusString,
        progress,
        bytes: typeof m.size === 'number' ? m.size : 0,
        files,
        addedAt: m.uploadDate ? new Date(m.uploadDate * 1000) : undefined,
        raw: m,
      };
    });
  }

  /**
   * Centralised error handling for API requests.
   * Logs the error and records rate limits where applicable.
   *
   * @param err - The error object.
   * @param operation - A human-readable description of the failed operation.
   */
  private handleError(err: any, operation: string, overrideToken?: string): void {
    const errorMsg = err?.message || String(err);
    const responseHeaders = err?.response?.headers;
    const isNetworkError =
      err?.code === 'ECONNREFUSED' ||
      err?.code === 'ENOTFOUND' ||
      err?.code === 'ETIMEDOUT' ||
      err?.code === 'ECONNRESET' ||
      errorMsg.includes('timeout') ||
      errorMsg.includes('network');

    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      // If we used a rotated download token, do NOT globally rate-limit the provider
      const primaryToken = config.alldebridApiKey;
      if (overrideToken && overrideToken !== primaryToken) {
        console.warn(
          `[${new Date().toISOString()}][ad] Rotated download token hit 429/rate-limit. Bypassing global rate limit.`
        );
      } else {
        let backoffMs: number | undefined;
        if (responseHeaders) {
          const retryAfter = responseHeaders['retry-after'] || responseHeaders['Retry-After'];
          if (retryAfter) {
            const seconds = parseInt(String(retryAfter), 10);
            if (Number.isFinite(seconds) && seconds > 0) backoffMs = seconds * 1000;
          }
        }
        rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg, backoffMs);
      }
    }

    console.error(`[${new Date().toISOString()}][ad] ${operation} failed`, {
      error: errorMsg,
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      isNetworkError,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
  }
}

// ===========================================================================
// Self-Registration
// ===========================================================================

import { registry } from './registry';
registry.register(new AllDebridProvider());
tokenRotator.registerProvider(PROVIDER_NAME, config.alldebridApiKey, config.alldebridDownloadTokens);
