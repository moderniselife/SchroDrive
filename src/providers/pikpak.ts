/**
 * SchroDrive — PikPak Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the PikPak
 * cloud storage and debrid service. Wraps the PikPak Drive API
 * (offline task listing, magnet addition, file retrieval, download
 * URL resolution) and adds WebDAV bridge support methods.
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * PikPak uses username/password login → JWT authentication:
 * 1. `POST https://user.mypikpak.com/v1/auth/signin` with `{ username, password }`
 *    returns `{ access_token }`.
 * 2. All subsequent requests use `Authorization: Bearer <access_token>`.
 * 3. On 401 responses, the provider re-authenticates and retries.
 *
 * Response format: `{ tasks: [...] }` for task listing endpoints.
 *
 * PikPak uses offline tasks (type=offline) for torrent downloads.
 * Completed tasks create files/folders in the drive, accessible via
 * `GET /drive/v1/files?parent_id=ID` and downloadable via
 * `GET /drive/v1/files/{id}?usage=DOWNLOAD` which returns `{ web_content_link }`.
 *
 * @module providers/pikpak
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

const PROVIDER_NAME = 'pikpak';



/** PikPak authentication base URL (separate from the API base). */
const AUTH_BASE_URL = 'https://user.mypikpak.com';

// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'pikpak_torrents';

// ===========================================================================
// PikPak Status Mapping
// ===========================================================================

/**
 * PikPak uses phase-type string statuses for offline task state.
 *
 * Known statuses:
 * - "PHASE_TYPE_RUNNING"  — actively downloading
 * - "PHASE_TYPE_COMPLETE" — fully downloaded and available
 * - "PHASE_TYPE_ERROR"    — download failed
 * - "PHASE_TYPE_PENDING"  — waiting in queue
 */

/** Status strings (lowercased) that indicate an error / dead task. */
const ERROR_STATUSES = new Set(['phase_type_error']);

/** Status strings (lowercased) indicating the task is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['phase_type_complete']);

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Returns the PikPak API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl(): string {
  return (config.pikpakApiBase || 'https://api-drive.mypikpak.com').replace(/\/$/, '');
}



/**
 * Validates a PikPak API response and throws on error.
 *
 * PikPak returns JSON with an optional `error` field on failure.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The response data.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res: any, operation: string): any {
  const body = res?.data;
  if (body?.error) {
    const errMsg = body?.error_description || body?.error?.message || (typeof body.error === 'string' ? body.error : JSON.stringify(body.error));
    throw new Error(`PikPak ${operation} failed: ${errMsg}`);
  }
  return body;
}

// ===========================================================================
// PikPakProvider
// ===========================================================================

/**
 * Debrid provider implementation for PikPak.
 *
 * Wraps all PikPak-specific API interactions behind the standard
 * {@link DebridProvider} interface, including offline task management,
 * WebDAV bridge support, and mount configuration.
 *
 * PikPak uses a username/password login flow that produces a JWT
 * (`access_token`). The token is stored as a private field and refreshed
 * lazily on the first API call or on 401 responses.
 *
 * Offline tasks are managed via `/drive/v1/tasks` and completed tasks
 * create files in the drive accessible via `/drive/v1/files`.
 */
export class PikPakProvider implements DebridProvider {
  readonly id = 'pikpak' as const;
  readonly displayName = 'PikPak';

  /** JWT access token obtained via username/password login. */
  private accessToken: string | null = null;

  /** Flag to prevent concurrent login attempts. */
  private loginInProgress: Promise<void> | null = null;

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Checks whether PikPak is configured with valid credentials.
   *
   * @returns `true` if both PikPak username and password are set in the configuration.
   */
  isConfigured(): boolean {
    return !!(config.pikpakUsername && config.pikpakPassword);
  }

  /**
   * Checks whether PikPak API requests are currently rate-limited.
   *
   * @returns `true` if the provider is in a backoff period.
   */
  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  /**
   * Returns the remaining wait time (in seconds) before PikPak requests
   * can resume after a rate limit.
   *
   * @returns Remaining wait time in seconds, or 0 if not rate-limited.
   */
  getWaitTime(): number {
    return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
  }

  // -------------------------------------------------------------------------
  // Authentication
  // -------------------------------------------------------------------------

  /**
   * Authenticates with PikPak using username/password credentials.
   *
   * Sends `POST /v1/auth/signin` to the PikPak user API with
   * `{ username, password }` and stores the returned `access_token`.
   *
   * This method is called lazily on the first API request and on
   * 401 responses to re-authenticate.
   *
   * @throws {Error} If authentication fails.
   */
  private async login(): Promise<void> {
    // Prevent concurrent login attempts
    if (this.loginInProgress) {
      await this.loginInProgress;
      return;
    }

    this.loginInProgress = (async () => {
      try {
        console.log(`[${new Date().toISOString()}][pikpak] authenticating with username/password`);

        const url = `${AUTH_BASE_URL}/v1/auth/signin`;
        const res = await axiosIPv4.post(url, {
          username: config.pikpakUsername,
          password: config.pikpakPassword,
        }, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000,
        });

        const data = res?.data;
        if (!data?.access_token) {
          throw new Error('PikPak login returned no access_token');
        }

        this.accessToken = data.access_token;
        console.log(`[${new Date().toISOString()}][pikpak] authentication successful`);
      } finally {
        this.loginInProgress = null;
      }
    })();

    await this.loginInProgress;
  }

  /**
   * Ensures we have a valid access token, logging in if necessary.
   *
   * @throws {Error} If login fails.
   */
  private async ensureAuthenticated(): Promise<void> {
    if (!this.accessToken) {
      await this.login();
    }
  }

  /**
   * Builds the authorisation headers for PikPak API requests.
   * Uses Bearer token authentication with the stored JWT.
   *
   * @param overrideToken - Optional token override for download rotation.
   * @returns A headers object containing the Bearer token.
   */
  private authHeaders(overrideToken?: string): Record<string, string> {
    return {
      Authorization: `Bearer ${overrideToken || this.accessToken || ''}`,
    };
  }

  // -------------------------------------------------------------------------
  // Torrent Operations
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete list of offline tasks from PikPak.
   * Returns cached data when rate-limited or on error.
   *
   * Uses `GET /drive/v1/tasks?type=offline` which returns
   * `{ tasks: [...] }`.
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
        console.warn(`[${new Date().toISOString()}][pikpak] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
        return this.normaliseTorrents(cached);
      }
      console.warn(`[${new Date().toISOString()}][pikpak] rate limited, no cache available (wait ${waitTime}s)`);
      return [];
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      const res = await axiosIPv4.get(url, {
        headers: this.authHeaders(),
        params: { type: 'offline' },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'list tasks');
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

      rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, tasks);
      console.log(`[${new Date().toISOString()}][pikpak] fetched ${tasks.length} offline task items`);
      return this.normaliseTorrents(tasks);
    } catch (err: any) {
      // Re-authenticate on 401 and retry once
      if (err?.response?.status === 401 && this.accessToken) {
        console.warn(`[${new Date().toISOString()}][pikpak] 401 received, re-authenticating`);
        this.accessToken = null;
        try {
          await this.ensureAuthenticated();
          await rateLimiter.throttle(PROVIDER_NAME);

          const url = `${getBaseUrl()}/drive/v1/tasks`;
          const res = await axiosIPv4.get(url, {
            headers: this.authHeaders(),
            params: { type: 'offline' },
            timeout: 30000,
          });
          rateLimiter.recordSuccess(PROVIDER_NAME);

          const data = unwrapResponse(res, 'list tasks (retry)');
          const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

          rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, tasks);
          console.log(`[${new Date().toISOString()}][pikpak] fetched ${tasks.length} offline task items (after re-auth)`);
          return this.normaliseTorrents(tasks);
        } catch (retryErr: any) {
          this.handleError(retryErr, 'list tasks (retry)');
        }
      } else {
        this.handleError(err, 'list tasks');
      }

      const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
      if (cached) {
        console.log(`[${new Date().toISOString()}][pikpak] returning cached list on error (${cached.length} items)`);
        return this.normaliseTorrents(cached);
      }
      return [];
    }
  }

  /**
   * Adds a magnet link to PikPak as an offline download task.
   *
   * Uses `POST /drive/v1/tasks` with JSON body:
   * `{ type: "offline", params: { url: "magnet:?..." }, folder_id: "" }`.
   *
   * @param magnet - The magnet URI to add.
   * @param _name - Unused (PikPak derives the name from the magnet).
   * @returns An object containing the task `id`.
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addMagnet(magnet: string, _name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`PikPak rate limited, retry in ${waitTime}s`);
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      const res = await axiosIPv4.post(url, {
        type: 'offline',
        params: { url: magnet },
        folder_id: '',
      }, {
        headers: {
          ...this.authHeaders(),
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'add magnet');
      const task = data?.task;
      const id = String(task?.id || data?.id || '');

      if (!id) {
        throw new Error('PikPak tasks/add returned no ID');
      }

      console.log(`[${new Date().toISOString()}][pikpak] added magnet as offline task ${id}`);
      return { id };
    } catch (err: any) {
      // Re-authenticate on 401 and retry once
      if (err?.response?.status === 401 && this.accessToken) {
        console.warn(`[${new Date().toISOString()}][pikpak] 401 on add magnet, re-authenticating`);
        this.accessToken = null;
        try {
          await this.ensureAuthenticated();
          await rateLimiter.throttle(PROVIDER_NAME);

          const url = `${getBaseUrl()}/drive/v1/tasks`;
          const res = await axiosIPv4.post(url, {
            type: 'offline',
            params: { url: magnet },
            folder_id: '',
          }, {
            headers: {
              ...this.authHeaders(),
              'Content-Type': 'application/json',
            },
            timeout: 30000,
          });
          rateLimiter.recordSuccess(PROVIDER_NAME);

          const data = unwrapResponse(res, 'add magnet (retry)');
          const task = data?.task;
          const id = String(task?.id || data?.id || '');

          if (!id) {
            throw new Error('PikPak tasks/add returned no ID (retry)');
          }

          console.log(`[${new Date().toISOString()}][pikpak] added magnet as offline task ${id} (after re-auth)`);
          return { id };
        } catch (retryErr: any) {
          this.handleError(retryErr, 'add magnet (retry)');
          throw retryErr;
        }
      }
      this.handleError(err, 'add magnet');
      throw err;
    }
  }

  /**
   * Uploads a .torrent file buffer to PikPak.
   *
   * PikPak supports torrent file upload via `POST /drive/v1/tasks`
   * with multipart form data containing the torrent file.
   *
   * @param fileBuffer - The raw .torrent file contents.
   * @param name - Optional human-readable name for logging.
   * @returns An object containing the task `id`.
   * @throws {Error} If the provider is rate-limited or the request fails.
   */
  async addTorrentFile(fileBuffer: Buffer, name?: string): Promise<AddMagnetResult> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
      throw new Error(`PikPak rate limited, retry in ${waitTime}s`);
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      console.log(`[${new Date().toISOString()}][pikpak] Uploading .torrent file${name ? `: ${name}` : ''}`);

      const formData = new FormData();
      formData.append('type', 'offline');
      formData.append('folder_id', '');
      formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');

      const res = await axiosIPv4.post(url, formData, {
        headers: this.authHeaders(),
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'upload torrent file');
      const task = data?.task;
      const id = String(task?.id || data?.id || '');

      if (!id) {
        throw new Error('PikPak tasks/add (file) returned no ID');
      }

      return { id };
    } catch (err: any) {
      this.handleError(err, 'add torrent file');
      throw err;
    }
  }

  /**
   * Checks whether a task with a matching title already exists in PikPak.
   *
   * Fetches the current task list and performs a case-insensitive
   * bi-directional substring match.
   *
   * @param title - The title to search for among existing offline tasks.
   * @returns `true` if a matching task already exists.
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
      console.warn(`[${new Date().toISOString()}][pikpak] check existing failed`, { error: err?.message });
      return false;
    }
  }

  /**
   * Determines whether a PikPak task is considered "dead" (failed or errored).
   *
   * A task is NOT dead if its progress has reached 100%. Otherwise, it is
   * considered dead if its status is "PHASE_TYPE_ERROR" or contains "error".
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
   * Deletes an offline task from PikPak by its ID.
   *
   * Uses `DELETE /drive/v1/tasks?task_ids=ID`.
   *
   * @param torrentId - The PikPak task ID to delete.
   * @throws {Error} If the deletion fails.
   */
  async deleteTorrent(torrentId: string): Promise<void> {
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      throw new Error(`PikPak rate limited, cannot delete task ${torrentId}`);
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      await axiosIPv4.delete(url, {
        headers: this.authHeaders(),
        params: { task_ids: torrentId },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      console.log(`[${new Date().toISOString()}][pikpak] deleted offline task ${torrentId}`);
    } catch (err: any) {
      this.handleError(err, `delete task ${torrentId}`);
      throw err;
    }
  }

  /**
   * Returns the info hash for a task, used for repair (re-adding).
   *
   * @param torrentId - The PikPak task ID.
   * @returns The info hash string, or null if not available.
   */
  async getInfoHash(torrentId: string): Promise<string | null> {
    // Check cached task list first
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      const task = cached.find((t: any) => String(t.id) === String(torrentId));
      if (task?.hash) return task.hash;
      if (task?.hashString) return task.hashString;
      // PikPak may store the hash in params.url as a magnet link
      if (task?.params?.url && typeof task.params.url === 'string') {
        const match = task.params.url.match(/btih:([a-fA-F0-9]{32,})/i);
        if (match) return match[1];
      }
    }

    // Fall back to API call
    if (rateLimiter.isRateLimited(PROVIDER_NAME)) return null;
    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      const res = await axiosIPv4.get(url, {
        headers: this.authHeaders(),
        params: { type: 'offline' },
        timeout: 20000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'get task info');
      const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
      const task = tasks.find((t: any) => String(t.id) === String(torrentId));
      const hash = task?.hash || task?.hashString;
      if (typeof hash === 'string' && hash.length >= 32) return hash;

      // Try extracting from params.url magnet link
      if (task?.params?.url && typeof task.params.url === 'string') {
        const match = task.params.url.match(/btih:([a-fA-F0-9]{32,})/i);
        if (match) return match[1];
      }
      return null;
    } catch (err: any) {
      this.handleError(err, `get info hash ${torrentId}`);
      return null;
    }
  }

  /**
   * Attempts to repair a dead task by re-adding the same magnet.
   *
   * @param torrentId - The PikPak task ID to repair.
   * @returns `true` if repair succeeded, `false` if the task should be replaced.
   */
  async repairTorrent(torrentId: string): Promise<boolean> {
    console.log(`[${new Date().toISOString()}][pikpak] attempting repair for task ${torrentId}`);

    const infoHash = await this.getInfoHash(torrentId);
    if (!infoHash) {
      console.warn(`[${new Date().toISOString()}][pikpak] repair failed — could not get info hash for ${torrentId}`);
      return false;
    }

    try {
      await this.deleteTorrent(torrentId);
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][pikpak] repair delete failed for ${torrentId}`, { err: err?.message });
      return false;
    }

    const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
    try {
      const result = await this.addMagnet(magnet);
      if (result.id) {
        console.log(`[${new Date().toISOString()}][pikpak] repair successful — re-added as ${result.id}`, { hash: infoHash });
        return true;
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][pikpak] repair re-add failed`, { hash: infoHash, err: err?.message });
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // WebDAV Bridge Support
  // -------------------------------------------------------------------------

  /**
   * Fetches the complete task list from PikPak and converts completed
   * tasks into virtual directories.
   *
   * For completed tasks, fetches files from the task's output folder
   * via `GET /drive/v1/files?parent_id=ID` to populate the virtual file list.
   *
   * @returns Array of virtual directories representing completed offline tasks.
   */
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    if (!this.isConfigured()) return [];

    if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
      console.warn(`[${new Date().toISOString()}][pikpak] rate limited, skipping directory fetch`);
      return [];
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/tasks`;
      const res = await axiosIPv4.get(url, {
        headers: this.authHeaders(),
        params: { type: 'offline' },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'fetch directories');
      const tasks: any[] = Array.isArray(data?.tasks) ? data.tasks : [];

      // Only include completed tasks
      const completed = tasks.filter((t) => {
        const s = String(t.phase || t.status || '').toLowerCase();
        return COMPLETED_STATUSES.has(s);
      });

      console.log(`[${new Date().toISOString()}][pikpak] fetched ${completed.length} completed tasks out of ${tasks.length} total`);

      const directories: VirtualDirectory[] = [];

      for (const t of completed) {
        try {
          const fileId = t.file_id || t.fileId;
          if (!fileId) {
            console.warn(`[${new Date().toISOString()}][pikpak] task ${t.id} has no file_id, skipping file fetch`);
            directories.push({
              id: String(t.id),
              name: sanitiseName(t.name || String(t.id)),
              originalName: t.name || String(t.id),
              files: [],
            });
            continue;
          }

          const files = await this.fetchDriveFiles(String(fileId));
          directories.push({
            id: String(t.id),
            name: sanitiseName(t.name || String(t.id)),
            originalName: t.name || String(t.id),
            files,
          });
        } catch (fileErr: any) {
          console.warn(`[${new Date().toISOString()}][pikpak] failed to fetch files for task ${t.id}`, { error: fileErr?.message });
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
   * Resolves a direct download URL for a PikPak file.
   *
   * Uses `GET /drive/v1/files/{id}?usage=DOWNLOAD` which returns
   * `{ web_content_link }` or a similar download URL field.
   *
   * @param torrentId - The PikPak task ID (used for logging context).
   * @param fileId - The PikPak file ID to download.
   * @param _linkIndex - Unused for PikPak.
   * @returns The direct download URL, or `null` on failure.
   */
  async resolveDownloadUrl(torrentId: string, fileId: string, _linkIndex?: number): Promise<string | null> {
    const downloadToken = tokenRotator.getDownloadToken(PROVIDER_NAME);
    // For PikPak, the download token is not a Bearer token — we use the stored accessToken
    const isRotated = false;

    if (rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
      console.warn(`[${new Date().toISOString()}][pikpak] rate limited, cannot resolve download URL for task ${torrentId}`);
      return null;
    }

    await this.ensureAuthenticated();
    await rateLimiter.throttle(PROVIDER_NAME);

    try {
      const url = `${getBaseUrl()}/drive/v1/files/${encodeURIComponent(fileId)}`;
      const res = await axiosIPv4.get(url, {
        headers: this.authHeaders(),
        params: { usage: 'DOWNLOAD' },
        timeout: 30000,
      });
      rateLimiter.recordSuccess(PROVIDER_NAME);

      const data = unwrapResponse(res, 'resolve download URL');
      const downloadUrl = data?.web_content_link || data?.download_url || data?.url || data?.links?.application_octet_stream?.url;

      if (!downloadUrl) {
        console.warn(`[${new Date().toISOString()}][pikpak] no download URL found for file ${fileId} in task ${torrentId}`);
        return null;
      }

      return downloadUrl;
    } catch (err: any) {
      // Re-authenticate on 401 and retry once
      if (err?.response?.status === 401 && this.accessToken) {
        console.warn(`[${new Date().toISOString()}][pikpak] 401 on resolve download, re-authenticating`);
        this.accessToken = null;
        try {
          await this.ensureAuthenticated();
          await rateLimiter.throttle(PROVIDER_NAME);

          const url = `${getBaseUrl()}/drive/v1/files/${encodeURIComponent(fileId)}`;
          const res = await axiosIPv4.get(url, {
            headers: this.authHeaders(),
            params: { usage: 'DOWNLOAD' },
            timeout: 30000,
          });
          rateLimiter.recordSuccess(PROVIDER_NAME);

          const data = unwrapResponse(res, 'resolve download URL (retry)');
          return data?.web_content_link || data?.download_url || data?.url || data?.links?.application_octet_stream?.url || null;
        } catch (retryErr: any) {
          this.handleError(retryErr, `resolve download URL for task ${torrentId}, file ${fileId} (retry)`);
          return null;
        }
      }

      this.handleError(err, `resolve download URL for task ${torrentId}, file ${fileId}`);
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Mount Configuration
  // -------------------------------------------------------------------------

  /**
   * Checks whether native PikPak WebDAV credentials are configured.
   *
   * @returns `true` if all three WebDAV settings (URL, username, password) are set.
   */
  hasDirectWebDAV(): boolean {
    return !!(config.pikpakWebdavUrl && config.pikpakWebdavUsername && config.pikpakWebdavPassword);
  }

  /**
   * Checks whether the PikPak credentials are configured.
   *
   * @returns `true` if the username and password are set.
   */
  hasApiKey(): boolean {
    return !!(config.pikpakUsername && config.pikpakPassword);
  }

  /**
   * Returns the native PikPak WebDAV connection details.
   *
   * @returns WebDAV config object, or `null` if not fully configured.
   */
  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    if (!this.hasDirectWebDAV()) return null;
    return {
      url: config.pikpakWebdavUrl,
      username: config.pikpakWebdavUsername,
      password: config.pikpakWebdavPassword,
    };
  }

  /**
   * Returns the local port the WebDAV bridge listens on for PikPak.
   *
   * @returns The configured bridge port (default from config).
   */
  getBridgePort(): number {
    return config.webdavBridgePortPIKPAK;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Fetches the file list for a given PikPak drive folder/file.
   *
   * Uses `GET /drive/v1/files?parent_id=ID` to retrieve child files.
   * If the parent_id refers to a single file, wraps it as an array.
   *
   * @param parentId - The PikPak folder/file ID to list.
   * @returns Array of virtual files.
   */
  private async fetchDriveFiles(parentId: string): Promise<VirtualFile[]> {
    await rateLimiter.throttle(PROVIDER_NAME);

    const url = `${getBaseUrl()}/drive/v1/files`;
    const res = await axiosIPv4.get(url, {
      headers: this.authHeaders(),
      params: { parent_id: parentId },
      timeout: 20000,
    });
    rateLimiter.recordSuccess(PROVIDER_NAME);

    const data = unwrapResponse(res, `fetch files for parent ${parentId}`);
    const rawFiles: any[] = Array.isArray(data?.files) ? data.files : [];

    // Filter to only regular files (not folders)
    const fileItems = rawFiles.filter((f: any) => f.kind !== 'drive#folder');

    return fileItems.map((f: any, idx: number) => ({
      id: String(f.id ?? idx),
      name: sanitiseName(f.name || `file_${idx}`),
      size: typeof f.size === 'number' ? f.size : (typeof f.size === 'string' ? parseInt(f.size, 10) || 0 : 0),
    }));
  }

  /**
   * Normalises raw PikPak API responses into the standard
   * {@link TorrentInfo} shape.
   *
   * @param rawTasks - Array of raw task objects from the PikPak API.
   * @returns Array of normalised torrent info objects.
   */
  private normaliseTorrents(rawTasks: any[]): TorrentInfo[] {
    return rawTasks.map((t) => {
      const phaseString = String(t.phase || t.status || '').toLowerCase();
      const progress = COMPLETED_STATUSES.has(phaseString)
        ? 100
        : (typeof t.progress === 'number' ? t.progress : 0);

      // PikPak tasks don't embed files directly — they reference drive files
      const files: TorrentFile[] = [];

      return {
        id: String(t.id || ''),
        name: t.name || '',
        filename: t.name || t.file_name,
        status: phaseString,
        progress,
        bytes: typeof t.file_size === 'number' ? t.file_size : (typeof t.file_size === 'string' ? parseInt(t.file_size, 10) || 0 : 0),
        files,
        addedAt: t.created_time ? new Date(t.created_time) : undefined,
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
      if (overrideToken && overrideToken !== this.accessToken) {
        console.warn(`[${new Date().toISOString()}][pikpak] download token rate limited during ${operation}`, { status });
        return;
      }
      let backoffMs: number | undefined;
      if (retryAfter) {
        const parsed = parseInt(retryAfter, 10);
        backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
      }
      rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
      console.warn(`[${new Date().toISOString()}][pikpak] rate limited during ${operation}`, { status, backoffMs });
    } else {
      console.error(`[${new Date().toISOString()}][pikpak] ${operation} error: ${errorMsg}`, { status });
    }
  }
}

// ===========================================================================
// Self-Registration
// ===========================================================================

registry.register(new PikPakProvider());

// Register with token rotator for download token cycling
tokenRotator.registerProvider(PROVIDER_NAME, config.pikpakUsername, config.pikpakDownloadTokens);
