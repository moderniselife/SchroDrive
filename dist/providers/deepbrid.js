"use strict";
/**
 * SchroDrive — Deepbrid Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Deepbrid
 * debrid service. Wraps the Deepbrid API (torrent listing, magnet
 * addition, file retrieval, download URL resolution) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * Deepbrid authenticates via query parameter `token=<KEY>` on all requests.
 * Response format: `{ status: "success", data: {...} }` or `{ status: "error", message: "..." }`.
 *
 * @module providers/deepbrid
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepbridProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const tokenRotator_1 = require("../core/tokenRotator");
const registry_1 = require("./registry");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'deepbrid';
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
const axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'deepbrid_torrents';
// ===========================================================================
// Deepbrid Status Mapping
// ===========================================================================
/**
 * Deepbrid uses plain string statuses for torrent state.
 *
 * Known statuses:
 * - "downloading" — actively downloading from peers
 * - "finished"    — fully downloaded and available
 * - "error"       — download failed
 * - "queued"      — waiting in the download queue
 */
/** Status strings that indicate an error / dead torrent. */
const ERROR_STATUSES = new Set(['error']);
/** Status strings indicating the torrent is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['finished']);
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Returns the Deepbrid API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.deepbridApiBase || 'https://www.deepbrid.com/api').replace(/\/$/, '');
}
/**
 * Builds the authentication query parameters for Deepbrid API requests.
 * Uses token-based query parameter authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A query params object containing the token.
 */
function authParams(overrideToken) {
    return {
        token: overrideToken || config_1.config.deepbridApiKey,
    };
}
/**
 * Sanitises a string for use as a filesystem path component.
 * Removes or replaces characters that are problematic on common filesystems
 * (Windows NTFS, macOS HFS+, Linux ext4).
 *
 * @param name - The raw name to sanitise.
 * @returns A filesystem-safe string.
 */
function sanitiseName(name) {
    return name
        .replace(/[\x00-\x1F\x7F]/g, '')
        .replace(/[<>:"/\\|?*]/g, '_')
        .replace(/_+/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/^[.\s]+|[.\s]+$/g, '')
        || 'unnamed';
}
/**
 * Extracts the response data from a Deepbrid API response.
 *
 * Deepbrid wraps responses in `{ status: "success"|"error", data: {...} }`.
 * This helper extracts the `data` property and throws on error responses.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The unwrapped data object.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res, operation) {
    const body = res?.data;
    if (body?.status === 'error') {
        const errMsg = body?.message || 'Unknown Deepbrid error';
        throw new Error(`Deepbrid ${operation} failed: ${errMsg}`);
    }
    return body?.data ?? body;
}
// ===========================================================================
// DeepbridProvider
// ===========================================================================
/**
 * Debrid provider implementation for Deepbrid.
 *
 * Wraps all Deepbrid-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent management,
 * WebDAV bridge support, and mount configuration.
 *
 * Deepbrid uses a straightforward REST model where torrents are added
 * and managed via the `/torrents/*` endpoint family. Completed torrents
 * provide direct download URLs in their file entries.
 */
class DeepbridProvider {
    constructor() {
        this.id = 'deepbrid';
        this.displayName = 'Deepbrid';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether Deepbrid is configured with a valid API key.
     *
     * @returns `true` if the Deepbrid API key is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.deepbridApiKey;
    }
    /**
     * Checks whether Deepbrid API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before Deepbrid requests
     * can resume after a rate limit.
     *
     * @returns Remaining wait time in seconds, or 0 if not rate-limited.
     */
    getWaitTime() {
        return rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    }
    // -------------------------------------------------------------------------
    // Torrent Operations
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete list of torrents from Deepbrid.
     * Returns cached data when rate-limited or on error.
     *
     * Uses `GET /torrents/list?token=K` which returns
     * `{ status: "success", data: [...] }`.
     *
     * @returns An array of normalised torrent info objects.
     */
    async listTorrents() {
        if (!this.isConfigured())
            return [];
        // Return cached data if rate-limited
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.warn(`[${new Date().toISOString()}][deepbrid] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][deepbrid] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/list`;
            const res = await axiosIPv4.get(url, {
                params: authParams(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'list torrents');
            const torrents = Array.isArray(data) ? data : [];
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, torrents);
            console.log(`[${new Date().toISOString()}][deepbrid] fetched ${torrents.length} torrent items`);
            return this.normaliseTorrents(torrents);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][deepbrid] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Adds a magnet link to Deepbrid for downloading.
     *
     * Uses `POST /torrents/add?token=K` with form data `magnet=MAGNET_URI`.
     *
     * @param magnet - The magnet URI to add.
     * @param _name - Unused (Deepbrid derives the name from the magnet).
     * @returns An object containing the torrent `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`Deepbrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/add`;
            const params = new URLSearchParams();
            params.set('magnet', magnet);
            const res = await axiosIPv4.post(url, params, {
                params: authParams(),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'add magnet');
            const id = String(data?.id || '');
            if (!id) {
                throw new Error('Deepbrid torrents/add returned no ID');
            }
            console.log(`[${new Date().toISOString()}][deepbrid] added magnet as torrent ${id}`);
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Uploads a .torrent file buffer to Deepbrid.
     *
     * Uses `POST /torrents/add?token=K` with multipart form data.
     * The file is sent as a `file` field in the form.
     *
     * @param fileBuffer - The raw .torrent file contents.
     * @param name - Optional human-readable name for logging.
     * @returns An object containing the torrent `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addTorrentFile(fileBuffer, name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`Deepbrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/add`;
            console.log(`[${new Date().toISOString()}][deepbrid] Uploading .torrent file${name ? `: ${name}` : ''}`);
            const formData = new FormData();
            formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');
            const res = await axiosIPv4.post(url, formData, {
                params: authParams(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'upload torrent file');
            const id = String(data?.id || '');
            if (!id) {
                throw new Error('Deepbrid torrents/add (file) returned no ID');
            }
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add torrent file');
            throw err;
        }
    }
    /**
     * Checks whether a torrent with a matching title already exists in Deepbrid.
     *
     * Fetches the current torrent list and performs a case-insensitive
     * bi-directional substring match.
     *
     * @param title - The title to search for among existing torrent items.
     * @returns `true` if a matching torrent already exists.
     */
    async checkExisting(title) {
        if (!this.isConfigured())
            return false;
        try {
            const torrents = await this.listTorrents();
            const normalised = title.toLowerCase();
            return torrents.some((t) => {
                const torrentName = (t.name || '').toLowerCase();
                return torrentName.includes(normalised) || normalised.includes(torrentName);
            });
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][deepbrid] check existing failed`, { error: err?.message });
            return false;
        }
    }
    /**
     * Determines whether a Deepbrid torrent is considered "dead" (failed or errored).
     *
     * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
     * considered dead if its status is "error" or contains "error"/"dead"/"deleted".
     *
     * @param torrent - The normalised torrent info object.
     * @returns `true` if the torrent is dead/failed.
     */
    isTorrentDead(torrent) {
        const s = String(torrent?.status || '').toLowerCase();
        if (typeof torrent?.progress === 'number' && torrent.progress >= 100)
            return false;
        if (s.includes('error') || s.includes('dead') || s.includes('deleted'))
            return true;
        return false;
    }
    /**
     * Deletes a torrent from Deepbrid by its ID.
     *
     * Uses `DELETE /torrents/delete?token=K&id=ID`.
     *
     * @param torrentId - The Deepbrid torrent ID to delete.
     * @throws {Error} If the deletion fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`Deepbrid rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/delete`;
            await axiosIPv4.delete(url, {
                params: {
                    ...authParams(),
                    id: torrentId,
                },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][deepbrid] deleted torrent ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete torrent ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a torrent, used for repair (re-adding).
     *
     * @param torrentId - The Deepbrid torrent ID.
     * @returns The info hash string, or null if not available.
     */
    async getInfoHash(torrentId) {
        // Check cached torrent list first
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            const torrent = cached.find((t) => String(t.id) === String(torrentId));
            if (torrent?.hashString)
                return torrent.hashString;
            if (torrent?.hash)
                return torrent.hash;
        }
        // Fall back to API call
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME))
            return null;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/list`;
            const res = await axiosIPv4.get(url, {
                params: authParams(),
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'get torrent info');
            const torrents = Array.isArray(data) ? data : [];
            const torrent = torrents.find((t) => String(t.id) === String(torrentId));
            const hash = torrent?.hashString || torrent?.hash;
            return typeof hash === 'string' && hash.length >= 32 ? hash : null;
        }
        catch (err) {
            this.handleError(err, `get info hash ${torrentId}`);
            return null;
        }
    }
    /**
     * Attempts to repair a dead torrent by re-adding the same magnet.
     *
     * @param torrentId - The Deepbrid torrent ID to repair.
     * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][deepbrid] attempting repair for torrent ${torrentId}`);
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][deepbrid] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][deepbrid] repair delete failed for ${torrentId}`, { err: err?.message });
            return false;
        }
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][deepbrid] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][deepbrid] repair re-add failed`, { hash: infoHash, err: err?.message });
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete torrent list from Deepbrid and converts completed
     * torrents into virtual directories.
     *
     * For completed torrents, fetches file details via `GET /torrents/files?token=K&id=ID`
     * to populate the virtual file list.
     *
     * @returns Array of virtual directories representing completed torrent items.
     */
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][deepbrid] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/list`;
            const res = await axiosIPv4.get(url, {
                params: authParams(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'fetch directories');
            const torrents = Array.isArray(data) ? data : [];
            // Only include completed torrents
            const completed = torrents.filter((t) => {
                const s = String(t.status || '').toLowerCase();
                return COMPLETED_STATUSES.has(s);
            });
            console.log(`[${new Date().toISOString()}][deepbrid] fetched ${completed.length} completed torrents out of ${torrents.length} total`);
            const directories = [];
            for (const t of completed) {
                try {
                    const files = await this.fetchTorrentFilesInternal(String(t.id));
                    directories.push({
                        id: String(t.id),
                        name: sanitiseName(t.name || String(t.id)),
                        originalName: t.name || String(t.id),
                        files,
                    });
                }
                catch (fileErr) {
                    console.warn(`[${new Date().toISOString()}][deepbrid] failed to fetch files for torrent ${t.id}`, { error: fileErr?.message });
                    // Still include directory with no files
                    directories.push({
                        id: String(t.id),
                        name: sanitiseName(t.name || String(t.id)),
                        originalName: t.name || String(t.id),
                        files: [],
                    });
                }
            }
            return directories;
        }
        catch (err) {
            this.handleError(err, 'fetch directories');
            return [];
        }
    }
    /**
     * Resolves a direct download URL for a Deepbrid file.
     *
     * Deepbrid provides direct download URLs in the file entries returned by
     * `GET /torrents/files?token=K&id=ID`. We fetch the files for the given
     * torrent and return the URL from the matching file entry.
     *
     * @param torrentId - The Deepbrid torrent ID.
     * @param fileId - The file ID or index within the torrent.
     * @param _linkIndex - Unused for Deepbrid.
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.deepbridApiKey;
        const isRotated = downloadToken !== config_1.config.deepbridApiKey;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][deepbrid] rate limited, cannot resolve download URL for torrent ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/torrents/files`;
            const res = await axiosIPv4.get(url, {
                params: {
                    ...authParams(downloadToken),
                    id: torrentId,
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'resolve download URL');
            const rawFiles = Array.isArray(data?.files) ? data.files : (Array.isArray(data) ? data : []);
            // Try matching by file ID first, then by index
            let file = rawFiles.find((f) => String(f.id) === String(fileId));
            if (!file) {
                const fileIndex = parseInt(fileId, 10);
                if (!isNaN(fileIndex) && fileIndex >= 0 && fileIndex < rawFiles.length) {
                    file = rawFiles[fileIndex];
                }
            }
            if (!file) {
                console.warn(`[${new Date().toISOString()}][deepbrid] file ${fileId} not found in torrent ${torrentId} (${rawFiles.length} files available)`);
                return null;
            }
            const downloadUrl = file.url || file.downloadUrl || file.link;
            if (!downloadUrl) {
                console.error(`[${new Date().toISOString()}][deepbrid] file found but no download URL for torrent ${torrentId}, file ${fileId}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for torrent ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.deepbridApiKey) {
                const duration = status === 429 ? 60 * 60 * 1000 : undefined;
                tokenRotator_1.tokenRotator.markTokenLimited(PROVIDER_NAME, downloadToken, `${status} ${err?.response?.statusText || 'limit'}`, duration);
            }
            return null;
        }
    }
    // -------------------------------------------------------------------------
    // Mount Configuration
    // -------------------------------------------------------------------------
    /**
     * Checks whether native Deepbrid WebDAV credentials are configured.
     *
     * @returns `true` if all three WebDAV settings (URL, username, password) are set.
     */
    hasDirectWebDAV() {
        return !!(config_1.config.deepbridWebdavUrl && config_1.config.deepbridWebdavUsername && config_1.config.deepbridWebdavPassword);
    }
    /**
     * Checks whether the Deepbrid API key is configured.
     *
     * @returns `true` if the API key is set.
     */
    hasApiKey() {
        return !!config_1.config.deepbridApiKey;
    }
    /**
     * Returns the native Deepbrid WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.deepbridWebdavUrl,
            username: config_1.config.deepbridWebdavUsername,
            password: config_1.config.deepbridWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for Deepbrid.
     *
     * @returns The configured bridge port (default from config).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortDB;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Fetches detailed file information for a specific torrent.
     *
     * Uses `GET /torrents/files?token=K&id=ID` to retrieve file listing
     * with direct download URLs.
     *
     * @param torrentId - The Deepbrid torrent ID.
     * @returns Array of virtual files for the torrent.
     */
    async fetchTorrentFilesInternal(torrentId) {
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const url = `${getBaseUrl()}/torrents/files`;
        const res = await axiosIPv4.get(url, {
            params: {
                ...authParams(),
                id: torrentId,
            },
            timeout: 20000,
        });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const data = unwrapResponse(res, `fetch files for torrent ${torrentId}`);
        const rawFiles = Array.isArray(data?.files) ? data.files : (Array.isArray(data) ? data : []);
        return rawFiles.map((f, idx) => ({
            id: String(f.id ?? idx),
            name: sanitiseName(f.name || `file_${idx}`),
            size: typeof f.size === 'number' ? f.size : 0,
        }));
    }
    /**
     * Normalises raw Deepbrid API responses into the standard
     * {@link TorrentInfo} shape.
     *
     * @param rawTorrents - Array of raw torrent objects from the Deepbrid API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTorrents) {
        return rawTorrents.map((t) => {
            const statusString = String(t.status || '').toLowerCase();
            const progress = COMPLETED_STATUSES.has(statusString)
                ? 100
                : (typeof t.progress === 'number' ? t.progress : 0);
            const rawFiles = Array.isArray(t.files) ? t.files : [];
            const files = rawFiles.map((f, idx) => ({
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
    handleError(err, operation, overrideToken) {
        const errorMsg = err?.message || String(err);
        const status = err?.response?.status;
        const retryAfter = err?.response?.headers?.['retry-after'];
        if (status === 429 || status === 503 || rateLimiter_1.rateLimiter.isRateLimitError(err)) {
            if (overrideToken && overrideToken !== config_1.config.deepbridApiKey) {
                console.warn(`[${new Date().toISOString()}][deepbrid] download token rate limited during ${operation}`, { status });
                return;
            }
            let backoffMs;
            if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
            }
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
            console.warn(`[${new Date().toISOString()}][deepbrid] rate limited during ${operation}`, { status, backoffMs });
        }
        else {
            console.error(`[${new Date().toISOString()}][deepbrid] ${operation} error: ${errorMsg}`, { status });
        }
    }
}
exports.DeepbridProvider = DeepbridProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
registry_1.registry.register(new DeepbridProvider());
// Register with token rotator for download token cycling
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.deepbridApiKey, config_1.config.deepbridDownloadTokens);
