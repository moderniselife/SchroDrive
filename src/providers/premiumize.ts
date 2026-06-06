/**
 * SchroDrive — Premiumize Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Premiumize debrid
 * service. Wraps all Premiumize API interactions (transfer listing, magnet
 * addition, existing torrent checking, folder/file browsing) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * Uses direct Axios requests with IPv4 forcing for all API calls.
 * All requests are rate-limited via the shared {@link rateLimiter} singleton.
 *
 * @module providers/premiumize
 */

import axios from 'axios';
import http from 'http';
import https from 'https';
import { config, requireEnv } from '../core/config';
import { rateLimiter } from '../core/rateLimiter';
import { tokenRotator } from '../core/tokenRotator';
import type {
  DebridProvider,
  TorrentInfo,
  AddMagnetResult,
  VirtualDirectory,
  VirtualFile,
} from './index';

// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================

const PROVIDER_NAME = 'premiumize';

/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosIPv4 = axios.create({ httpAgent, httpsAgent });

// Cache keys for the shared rateLimiter cache
const TRANSFER_LIST_CACHE_KEY = 'premiumize_transfers';

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Builds the authorisation headers required for Premiumize API requests.
 * Uses Bearer token authentication.
 *
 * @returns A headers object containing the Bearer token.
 */
function premiumizeHeaders(overrideToken?: string): Record<string, string> {
  return { Authorization: `Bearer ${overrideToken || config.premiumizeApiKey}` };
}

/**
 * Returns the Premiumize API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl(): string {
  return (config.premiumizeApiBase || 'https://www.premiumize.me/api').replace(/\/$/, '');
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
 * Maps a Premiumize transfer status string to a normalised progress percentage.
 *
 * @param status - The raw status string from the Premiumize API.
 * @param rawProgress - The raw progress value (0–1 fractional) if available.
 * @returns A normalised progress percentage (0–100).
 */
function normaliseProgress(status: string, rawProgress?: number): number {
  const s = (status || '').toLowerCase();
  if (s === 'finished') return 100;
  if (s === 'seeding') return 100;
  if (typeof rawProgress === 'number') return Math.round(rawProgress * 100);
  return 0;
}

// ===========================================================================
// PremiumizeProvider
// ===========================================================================

/**
 * Debrid provider implementation for Premiumize.
 *
 * Wraps all Premiumize-specific API interactions behind the standard
 * {@link DebridProvider} interface, including transfer management,
 * WebDAV bridge support, and mount configuration.
 */
export class PremiumizeProvider implements DebridProvider {
  readonly id = 'premiumize' as const;
  readonly displayName = 'Premiumize';

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Checks whether Premiumize is configured with a valid API key.
   *
   * @returns `true` if the Premiumize API key is set in the configuration.
   */
  isConfigured(): boolean {
    return !!config.premiumizeApiKey;
  }

  /**
   * Checks whether Premiumize API requests are currently rate-limited.
   *
   * @returns `true` if the provider is in a backoff period.
   */
  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  /**
   * Returns the remaining wait time (in seconds) before Premiumize requests
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
   * Fetches the list of transfers from Premiumize. Returns cached data when
   * rate-limited or on error.
   *
   * Uses GET /transfer/list which returns `{ transfers: [...] }`.
   *
   * @returns An array of normalised torrent info objects.
   */
  async listTorrents(): Promise<TorrentInfo[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      const cached = rateLimiter.getCache<any[]>(TRANSFER_LIST_CACHE_KEY);
      if (cached) {
        console.warn(`[${new Date().toISOString()}][premiumize] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
        return this.normaliseTransfers(cached);
      }
      console.warn(`[${new Date().toISOString()}][premiumize] rate limited, no cache available (wait ${waitTime}s)`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/transfer/list`;

    try {
      const res = await axiosIPv4.get(url, {
        headers: premiumizeHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      // Premiumize wraps the list in { transfers: [...] }
      const list = Array.isArray(res?.data?.transfers) ? res.data.transfers : [];
      rateLimiter.setCache(TRANSFER_LIST_CACHE_KEY, list);
      return this.normaliseTransfers(list);
    } catch (err: any) {
      this.handleError(err, 'list transfers');

      const cached = rateLimiter.getCache<any[]>(TRANSFER_LIST_CACHE_KEY);
      if (cached) {
        console.log(`[${new Date().toISOString()}][premiumize] returning cached list on error (${cached.length} items)`);
        return this.normaliseTransfers(cached);
      }
      return [];
    }
  }

  /**
   * Adds a magnet link to Premiumize for downloading.
   *
   * Uses POST /transfer/create with form data `src=MAGNET`.
   *
   * @param magnet - The magnet URI to add.
   * @param _name - Optional name (Premiumize derives the name from the magnet).
   * @returns An object containing the transfer ID.
   * @throws {Error} If rate-limited or the request fails.
   */
  async addMagnet(magnet: string, _name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`Premiumize rate limited, retry in ${waitTime}s`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/transfer/create`;
    const teaser = magnet.slice(0, 80) + '...';
    console.log(`[${new Date().toISOString()}][premiumize] createTransfer`, { teaser });
    const started = Date.now();

    try {
      // Premiumize expects form-encoded data for transfer creation
      const formData = new URLSearchParams();
      formData.append('src', magnet);

      const res = await axiosIPv4.post(url, formData.toString(), {
        headers: {
          ...premiumizeHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][premiumize] createTransfer done`, { ms: Date.now() - started });

      const data = res?.data;
      const id = String(data?.id || '');
      return { id };
    } catch (err: any) {
      this.handleError(err, 'add magnet');
      throw err;
    }
  }

  /**
   * Checks whether a transfer with a matching title already exists in Premiumize.
   *
   * Fetches the current transfer list and performs a case-insensitive
   * bi-directional substring match (search ⊂ transfer name or
   * transfer name ⊂ search) to catch partial matches.
   *
   * @param title - The title to search for among existing transfers.
   * @returns `true` if a matching transfer already exists.
   */
  async checkExisting(title: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      console.warn(`[${new Date().toISOString()}][premiumize] rate limited, skipping check (wait ${waitTime}s)`);
      return false;
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/transfer/list`;
    console.log(`[${new Date().toISOString()}][premiumize] checking existing transfers`, { searchTitle: title });
    const started = Date.now();

    try {
      const res = await axiosIPv4.get(url, {
        headers: premiumizeHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const existingTransfers = Array.isArray(res?.data?.transfers) ? res.data.transfers : [];
      console.log(`[${new Date().toISOString()}][premiumize] existing transfers check`, {
        searchTitle: title,
        count: existingTransfers.length,
        ms: Date.now() - started,
      });

      // Bi-directional case-insensitive substring match
      const normalised = title.toLowerCase();
      const hasExisting = existingTransfers.some((transfer: any) => {
        const transferName = (transfer.name || '').toLowerCase();
        return transferName.includes(normalised) || normalised.includes(transferName);
      });

      if (hasExisting) {
        console.log(`[${new Date().toISOString()}][premiumize] found existing transfer`, {
          searchTitle: title,
          existingNames: existingTransfers.slice(0, 3).map((t: any) => t.name),
        });
      }

      return hasExisting;
    } catch (err: any) {
      this.handleError(err, 'check existing');
      return false;
    }
  }

  /**
   * Determines whether a Premiumize transfer is considered "dead"
   * (failed, errored, or otherwise unrecoverable).
   *
   * A transfer is NOT dead if its progress has reached 100%. Otherwise, it is
   * considered dead if its status contains "error" or "timeout".
   *
   * @param torrent - The normalised torrent info object.
   * @returns `true` if the transfer is dead/failed.
   */
  isTorrentDead(torrent: TorrentInfo): boolean {
    const status = String(torrent?.status || '').toLowerCase();
    // Completed transfers are never dead, regardless of status string
    if (typeof torrent?.progress === 'number' && torrent.progress >= 100) return false;
    if (status.includes('error')) return true;
    if (status.includes('timeout')) return true;
    return false;
  }

  /**
   * Deletes a transfer from Premiumize by its ID.
   *
   * Uses POST /transfer/delete with form data `id=ID`.
   *
   * @param torrentId - The Premiumize transfer ID to delete.
   * @throws {Error} If the deletion fails.
   */
  async deleteTorrent(torrentId: string): Promise<void> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      throw new Error(`Premiumize rate limited, cannot delete transfer ${torrentId}`);
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/transfer/delete`;

    try {
      const formData = new URLSearchParams();
      formData.append('id', torrentId);

      await axiosIPv4.post(url, formData.toString(), {
        headers: {
          ...premiumizeHeaders(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][premiumize] deleted transfer ${torrentId}`);
    } catch (err: any) {
      this.handleError(err, `delete transfer ${torrentId}`);
      throw err;
    }
  }

  /**
   * Returns the info hash for a transfer, used for repair (re-adding).
   *
   * Premiumize stores the original magnet/source in the transfer data.
   * We extract the info hash from the `src` field using a regex match
   * on the `btih:` URN. Falls back to the `hash` field if present.
   *
   * @param torrentId - The Premiumize transfer ID.
   * @returns The info hash string, or null if not available.
   */
  async getInfoHash(torrentId: string): Promise<string | null> {
    // Check cached transfer list first
    const cached = rateLimiter.getCache<any[]>(TRANSFER_LIST_CACHE_KEY);
    if (cached) {
      const transfer = cached.find((t: any) => String(t.id) === String(torrentId));
      if (transfer) {
        // Try hash field first, then extract from src magnet
        if (transfer.hash) return transfer.hash;
        const match = (transfer.src || '').match(/btih:([a-fA-F0-9]{32,})/i);
        if (match) return match[1];
      }
    }

    // Fall back to API call
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) return null;
    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/transfer/list`;

    try {
      const res = await axiosIPv4.get(url, {
        headers: premiumizeHeaders(),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const transfers = Array.isArray(res?.data?.transfers) ? res.data.transfers : [];
      const transfer = transfers.find((t: any) => String(t.id) === String(torrentId));
      if (!transfer) return null;

      if (transfer.hash) return transfer.hash;
      const match = (transfer.src || '').match(/btih:([a-fA-F0-9]{32,})/i);
      return match ? match[1] : null;
    } catch (err: any) {
      this.handleError(err, `get info hash ${torrentId}`);
      return null;
    }
  }

  /**
   * Attempts to repair a dead transfer by re-adding the same magnet.
   *
   * Flow:
   * 1. Fetch the info hash from the dead transfer
   * 2. Delete the broken transfer
   * 3. Re-add the same magnet to Premiumize
   * 4. If successful → repaired; if failed → needs replacement
   *
   * @param torrentId - The Premiumize transfer ID to repair.
   * @returns `true` if repair succeeded, `false` if the transfer should be replaced.
   */
  async repairTorrent(torrentId: string): Promise<boolean> {
    console.log(`[${new Date().toISOString()}][premiumize] attempting repair for transfer ${torrentId}`);

    // Step 1: Get the info hash before deletion
    const infoHash = await this.getInfoHash(torrentId);
    if (!infoHash) {
      console.warn(`[${new Date().toISOString()}][premiumize] repair failed — could not get info hash for ${torrentId}`);
      return false;
    }

    // Step 2: Delete the broken transfer
    try {
      await this.deleteTorrent(torrentId);
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][premiumize] repair delete failed for ${torrentId}`, { err: err?.message });
      return false;
    }

    // Step 3: Re-add the same magnet
    const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
    try {
      const result = await this.addMagnet(magnet);
      if (result.id) {
        console.log(`[${new Date().toISOString()}][premiumize] repair successful — re-added as ${result.id}`, { hash: infoHash });
        return true;
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][premiumize] repair re-add failed`, { hash: infoHash, err: err?.message });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // WebDAV Bridge Support
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete transfer list from Premiumize and converts finished
   * transfers into virtual directories. Only includes transfers with
   * status "finished".
   *
   * For each finished transfer, uses the folder/list endpoint to retrieve
   * the embedded file details, since Premiumize exposes files within the
   * transfer's folder structure.
   *
   * @returns Array of virtual directories representing completed Premiumize transfers.
   */
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][premiumize] rate limited, skipping directory fetch`);
      return [];
    }

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();

    try {
      const url = `${base}/transfer/list`;
      const res = await axiosIPv4.get(url, {
        headers: premiumizeHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const rawList = Array.isArray(res?.data?.transfers) ? res.data.transfers : [];

      // Only include transfers that have finished downloading
      const completed = rawList.filter((t: any) => {
        const status = (t.status || '').toLowerCase();
        return status === 'finished' || status === 'seeding';
      });

      console.log(`[${new Date().toISOString()}][premiumize] fetched ${completed.length} completed transfers out of ${rawList.length} total`);

      // Build virtual directories — attempt to fetch folder contents for each transfer
      const directories: VirtualDirectory[] = [];
      for (const t of completed) {
        const folderId = t.folder_id || t.file_id || t.id;
        let files: VirtualFile[] = [];

        if (folderId) {
          try {
            files = await this.fetchFolderFiles(String(folderId));
          } catch (err: any) {
            console.warn(`[${new Date().toISOString()}][premiumize] failed to fetch folder files for transfer ${t.id}`, {
              error: err?.message,
            });
          }
        }

        directories.push({
          id: String(t.id),
          name: sanitiseName(t.name || String(t.id)),
          originalName: t.name || String(t.id),
          files,
        });
      }

      return directories;
    } catch (err: any) {
      this.handleError(err, 'fetch directories');
      return [];
    }
  }

  /**
   * Resolves a direct download URL for a specific file within a Premiumize transfer.
   *
   * Uses GET /folder/list?id=FOLDER_ID to retrieve the file's `link` field,
   * which is the direct download URL.
   *
   * @param torrentId - The Premiumize transfer ID (used as folder ID).
   * @param fileId - The file ID within the transfer's folder.
   * @param _linkIndex - Unused for Premiumize (RD-specific parameter).
   * @returns The direct download URL, or `null` on failure.
   */
  async resolveDownloadUrl(torrentId: string, fileId: string, _linkIndex?: number): Promise<string | null> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][premiumize] rate limited, cannot resolve download URL for transfer ${torrentId}`);
      return null;
    }

    const downloadToken = tokenRotator.getDownloadToken(PROVIDER_NAME) || config.premiumizeApiKey;

    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();

    try {
      // First, try to get the transfer details to find the folder_id
      const transferUrl = `${base}/transfer/list`;
      const transferRes = await axiosIPv4.get(transferUrl, {
        headers: premiumizeHeaders(downloadToken),
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const transfers = Array.isArray(transferRes?.data?.transfers) ? transferRes.data.transfers : [];
      const transfer = transfers.find((t: any) => String(t.id) === torrentId);
      const folderId = transfer?.folder_id || transfer?.file_id || torrentId;

      // Fetch folder contents to find the file's direct link
      await rateLimiter.throttle(PROVIDER_NAME);
      const folderUrl = `${base}/folder/list`;
      const folderRes = await axiosIPv4.get(folderUrl, {
        headers: premiumizeHeaders(downloadToken),
        params: { id: folderId },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const content = Array.isArray(folderRes?.data?.content) ? folderRes.data.content : [];
      const file = content.find((f: any) => String(f.id) === fileId);

      if (file?.link) {
        return file.link;
      }

      // If file not found by ID, try matching by name in nested folders
      const allFiles = this.flattenFolderContent(content);
      const matchedFile = allFiles.find((f: any) => String(f.id) === fileId);

      if (matchedFile?.link) {
        return matchedFile.link;
      }

      console.error(`[${new Date().toISOString()}][premiumize] no download link found for transfer ${torrentId}, file ${fileId}`);
      return null;
    } catch (err: any) {
      this.handleError(err, `resolve download URL for transfer ${torrentId}, file ${fileId}`, downloadToken);
      const status = err?.response?.status;
      if ((status === 503 || status === 429) && downloadToken !== config.premiumizeApiKey) {
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
   * Checks whether native Premiumize WebDAV credentials are configured.
   *
   * @returns `true` if all three WebDAV settings (URL, username, password) are set.
   */
  hasDirectWebDAV(): boolean {
    return !!(config.premiumizeWebdavUrl && config.premiumizeWebdavUsername && config.premiumizeWebdavPassword);
  }

  /**
   * Checks whether the Premiumize API key is configured.
   *
   * @returns `true` if the API key is set.
   */
  hasApiKey(): boolean {
    return !!config.premiumizeApiKey;
  }

  /**
   * Returns the native Premiumize WebDAV connection details.
   *
   * @returns WebDAV config object, or `null` if not fully configured.
   */
  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    if (!this.hasDirectWebDAV()) return null;
    return {
      url: config.premiumizeWebdavUrl,
      username: config.premiumizeWebdavUsername,
      password: config.premiumizeWebdavPassword,
    };
  }

  /**
   * Returns the local port the WebDAV bridge listens on for Premiumize.
   *
   * @returns The configured bridge port (default: 9118).
   */
  getBridgePort(): number {
    return config.webdavBridgePortPM;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Fetches files from a Premiumize folder using the folder/list endpoint.
   *
   * @param folderId - The folder ID to list.
   * @returns Array of virtual files within the folder.
   */
  private async fetchFolderFiles(folderId: string): Promise<VirtualFile[]> {
    await rateLimiter.throttle(PROVIDER_NAME);

    const base = getBaseUrl();
    const url = `${base}/folder/list`;

    const res = await axiosIPv4.get(url, {
      headers: premiumizeHeaders(),
      params: { id: folderId },
      timeout: 20000,
    });
    rateLimiter.recordSuccess(PROVIDER_NAME);

    const content = Array.isArray(res?.data?.content) ? res.data.content : [];
    return this.flattenFolderContent(content).map((f: any) => ({
      id: String(f.id),
      name: sanitiseName(f.name || `file_${f.id}`),
      size: typeof f.size === 'number' ? f.size : 0,
    }));
  }

  /**
   * Recursively flattens folder content, extracting only file entries
   * (filtering out sub-folders). Premiumize folders can contain nested
   * folder structures.
   *
   * @param content - Array of content items from folder/list response.
   * @returns Flat array of file-type content items.
   */
  private flattenFolderContent(content: any[]): any[] {
    const files: any[] = [];
    for (const item of content) {
      if (item.type === 'folder' && Array.isArray(item.children)) {
        files.push(...this.flattenFolderContent(item.children));
      } else if (item.type === 'file' || item.link) {
        // Items with a direct link are downloadable files
        files.push(item);
      }
    }
    return files;
  }

  /**
   * Normalises raw Premiumize transfer API responses into the standard
   * {@link TorrentInfo} shape.
   *
   * @param rawTransfers - Array of raw transfer objects from the Premiumize API.
   * @returns Array of normalised torrent info objects.
   */
  private normaliseTransfers(rawTransfers: any[]): TorrentInfo[] {
    return rawTransfers.map((t) => ({
      id: String(t.id || ''),
      name: t.name || '',
      filename: t.name,
      status: t.status || '',
      progress: normaliseProgress(t.status, t.progress),
      bytes: typeof t.size === 'number' ? t.size : 0,
      files: [], // Premiumize does not embed files in transfer/list; fetched separately via folder/list
      addedAt: undefined,
      raw: t,
    }));
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
      const primaryToken = config.premiumizeApiKey;
      if (overrideToken && overrideToken !== primaryToken) {
        console.warn(
          `[${new Date().toISOString()}][premiumize] Rotated download token hit 429/rate-limit. Bypassing global rate limit.`
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

    console.error(`[${new Date().toISOString()}][premiumize] ${operation} failed`, {
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

import { registry } from './index';
registry.register(new PremiumizeProvider());
tokenRotator.registerProvider(PROVIDER_NAME, config.premiumizeApiKey, config.premiumizeDownloadTokens);
