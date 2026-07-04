"use strict";
/**
 * SchroDrive — MegaDebrid Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the MegaDebrid
 * debrid service. Wraps the MegaDebrid API (torrent listing, magnet
 * addition, status checking, download URL resolution) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * MegaDebrid authenticates via query parameter `token=<KEY>` on all requests.
 * Response format varies: `{ response_code: "ok" }` or raw arrays depending
 * on the endpoint. Actions are specified via query parameter `action=<ACTION>`.
 *
 * **Note:** MegaDebrid does NOT support WebDAV — `hasDirectWebDAV()` returns
 * `false` and `getWebDAVConfig()` returns `null`.
 *
 * @module providers/megadebrid
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MegaDebridProvider = void 0;
const httpClient_1 = require("../core/httpClient");
const utils_1 = require("../core/utils");
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const tokenRotator_1 = require("../core/tokenRotator");
const registry_1 = require("./registry");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'megadebrid';
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'megadebrid_torrents';
// ===========================================================================
// MegaDebrid Status Mapping
// ===========================================================================
/**
 * MegaDebrid uses plain string statuses for torrent state.
 *
 * Known statuses:
 * - "downloading" — actively downloading from peers
 * - "finished"    — fully downloaded and available
 * - "error"       — download failed
 * - "queued"      — waiting in the download queue
 * - "uploading"   — uploading/processing
 */
/** Status strings that indicate an error / dead torrent. */
const ERROR_STATUSES = new Set(['error']);
/** Status strings indicating the torrent is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['finished']);
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Returns the MegaDebrid API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.megadebridApiBase || 'https://www.mega-debrid.eu').replace(/\/$/, '');
}
/**
 * Builds the authentication query parameters for MegaDebrid API requests.
 * Uses token-based query parameter authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A query params object containing the token.
 */
function authParams(overrideToken) {
    return {
        token: overrideToken || config_1.config.megadebridApiKey,
    };
}
/**
 * Validates a MegaDebrid API response and throws on error.
 *
 * MegaDebrid returns varying formats: `{ response_code: "ok" }` on success,
 * `{ response_code: "error", response_text: "..." }` on failure,
 * or raw arrays for listing endpoints.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The response data.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res, operation) {
    const body = res?.data;
    if (body?.response_code === 'error' || body?.response_code === 'nok') {
        const errMsg = body?.response_text || body?.message || 'Unknown MegaDebrid error';
        throw new Error(`MegaDebrid ${operation} failed: ${errMsg}`);
    }
    return body;
}
// ===========================================================================
// MegaDebridProvider
// ===========================================================================
/**
 * Debrid provider implementation for MegaDebrid.
 *
 * Wraps all MegaDebrid-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent management,
 * WebDAV bridge support, and mount configuration.
 *
 * MegaDebrid uses an action-based query parameter model where all
 * operations are dispatched via `?action=<ACTION>&token=K` on the
 * base URL. Completed torrents provide download links through the
 * status endpoint.
 *
 * **WebDAV is not supported** by MegaDebrid — all file access goes
 * through the WebDAV bridge proxy.
 */
class MegaDebridProvider {
    constructor() {
        this.id = 'megadebrid';
        this.displayName = 'MegaDebrid';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether MegaDebrid is configured with a valid API key.
     *
     * @returns `true` if the MegaDebrid API key is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.megadebridApiKey;
    }
    /**
     * Checks whether MegaDebrid API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before MegaDebrid requests
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
     * Fetches the complete list of torrents from MegaDebrid.
     * Returns cached data when rate-limited or on error.
     *
     * Uses `GET /?action=getTorrents&token=K` which returns a raw
     * array of torrent objects or `{ response_code: "ok", torrents: [...] }`.
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
                console.warn(`[${new Date().toISOString()}][megadebrid] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][megadebrid] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            const res = await httpClient_1.axiosIPv4.get(url, {
                params: {
                    ...authParams(),
                    action: 'getTorrents',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'list torrents');
            // MegaDebrid may return an array directly or wrap in { torrents: [...] }
            const torrents = Array.isArray(data) ? data : (Array.isArray(data?.torrents) ? data.torrents : []);
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, torrents);
            console.log(`[${new Date().toISOString()}][megadebrid] fetched ${torrents.length} torrent items`);
            return this.normaliseTorrents(torrents);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][megadebrid] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Adds a magnet link to MegaDebrid for downloading.
     *
     * Uses `POST /?action=upload-magnet&token=K` with form data `magnet=MAGNET_URI`.
     *
     * @param magnet - The magnet URI to add.
     * @param _name - Unused (MegaDebrid derives the name from the magnet).
     * @returns An object containing the torrent `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`MegaDebrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            const params = new URLSearchParams();
            params.set('magnet', magnet);
            const res = await httpClient_1.axiosIPv4.post(url, params, {
                params: {
                    ...authParams(),
                    action: 'upload-magnet',
                },
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'add magnet');
            const id = String(data?.id || data?.torrent_id || '');
            if (!id) {
                throw new Error('MegaDebrid upload-magnet returned no ID');
            }
            console.log(`[${new Date().toISOString()}][megadebrid] added magnet as torrent ${id}`);
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Uploads a .torrent file buffer to MegaDebrid.
     *
     * Uses `POST /?action=upload-torrent&token=K` with multipart form data.
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
            throw new Error(`MegaDebrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            console.log(`[${new Date().toISOString()}][megadebrid] Uploading .torrent file${name ? `: ${name}` : ''}`);
            const formData = new FormData();
            formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');
            const res = await httpClient_1.axiosIPv4.post(url, formData, {
                params: {
                    ...authParams(),
                    action: 'upload-torrent',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'upload torrent file');
            const id = String(data?.id || data?.torrent_id || '');
            if (!id) {
                throw new Error('MegaDebrid upload-torrent (file) returned no ID');
            }
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add torrent file');
            throw err;
        }
    }
    /**
     * Checks whether a torrent with a matching title already exists in MegaDebrid.
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
            console.warn(`[${new Date().toISOString()}][megadebrid] check existing failed`, { error: err?.message });
            return false;
        }
    }
    /**
     * Determines whether a MegaDebrid torrent is considered "dead" (failed or errored).
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
     * Deletes a torrent from MegaDebrid by its ID.
     *
     * Uses `GET /?action=torrent-delete&token=K&id=ID`.
     *
     * @param torrentId - The MegaDebrid torrent ID to delete.
     * @throws {Error} If the deletion fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`MegaDebrid rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            await httpClient_1.axiosIPv4.get(url, {
                params: {
                    ...authParams(),
                    action: 'torrent-delete',
                    id: torrentId,
                },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][megadebrid] deleted torrent ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete torrent ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a torrent, used for repair (re-adding).
     *
     * @param torrentId - The MegaDebrid torrent ID.
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
            const url = getBaseUrl();
            const res = await httpClient_1.axiosIPv4.get(url, {
                params: {
                    ...authParams(),
                    action: 'getTorrents',
                },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'get torrent info');
            const torrents = Array.isArray(data) ? data : (Array.isArray(data?.torrents) ? data.torrents : []);
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
     * @param torrentId - The MegaDebrid torrent ID to repair.
     * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][megadebrid] attempting repair for torrent ${torrentId}`);
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][megadebrid] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][megadebrid] repair delete failed for ${torrentId}`, { err: err?.message });
            return false;
        }
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][megadebrid] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][megadebrid] repair re-add failed`, { hash: infoHash, err: err?.message });
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete torrent list from MegaDebrid and converts completed
     * torrents into virtual directories.
     *
     * For completed torrents, fetches file details via
     * `GET /?action=torrent-status&token=K&id=ID` to populate the virtual file list.
     *
     * @returns Array of virtual directories representing completed torrent items.
     */
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][megadebrid] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            const res = await httpClient_1.axiosIPv4.get(url, {
                params: {
                    ...authParams(),
                    action: 'getTorrents',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'fetch directories');
            const torrents = Array.isArray(data) ? data : (Array.isArray(data?.torrents) ? data.torrents : []);
            // Only include completed torrents
            const completed = torrents.filter((t) => {
                const s = String(t.status || '').toLowerCase();
                return COMPLETED_STATUSES.has(s);
            });
            console.log(`[${new Date().toISOString()}][megadebrid] fetched ${completed.length} completed torrents out of ${torrents.length} total`);
            const directories = [];
            for (const t of completed) {
                try {
                    const files = await this.fetchTorrentFilesInternal(String(t.id));
                    directories.push({
                        id: String(t.id),
                        name: (0, utils_1.sanitiseName)(t.name || String(t.id)),
                        originalName: t.name || String(t.id),
                        files,
                    });
                }
                catch (fileErr) {
                    console.warn(`[${new Date().toISOString()}][megadebrid] failed to fetch files for torrent ${t.id}`, { error: fileErr?.message });
                    directories.push({
                        id: String(t.id),
                        name: (0, utils_1.sanitiseName)(t.name || String(t.id)),
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
     * Resolves a direct download URL for a MegaDebrid file.
     *
     * Fetches the torrent status via `GET /?action=torrent-status&token=K&id=ID`
     * and extracts the download link from the file entries.
     *
     * @param torrentId - The MegaDebrid torrent ID.
     * @param fileId - The file ID or index within the torrent.
     * @param _linkIndex - Unused for MegaDebrid.
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.megadebridApiKey;
        const isRotated = downloadToken !== config_1.config.megadebridApiKey;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][megadebrid] rate limited, cannot resolve download URL for torrent ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = getBaseUrl();
            const res = await httpClient_1.axiosIPv4.get(url, {
                params: {
                    ...authParams(downloadToken),
                    action: 'torrent-status',
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
                // If the torrent has a single download URL at the top level, use it
                if (data?.url || data?.downloadUrl || data?.link) {
                    return data.url || data.downloadUrl || data.link;
                }
                console.warn(`[${new Date().toISOString()}][megadebrid] file ${fileId} not found in torrent ${torrentId} (${rawFiles.length} files available)`);
                return null;
            }
            const downloadUrl = file.url || file.downloadUrl || file.link;
            if (!downloadUrl) {
                console.error(`[${new Date().toISOString()}][megadebrid] file found but no download URL for torrent ${torrentId}, file ${fileId}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for torrent ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.megadebridApiKey) {
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
     * MegaDebrid does NOT support native WebDAV.
     *
     * @returns Always `false`.
     */
    hasDirectWebDAV() {
        return false;
    }
    /**
     * Checks whether the MegaDebrid API key is configured.
     *
     * @returns `true` if the API key is set.
     */
    hasApiKey() {
        return !!config_1.config.megadebridApiKey;
    }
    /**
     * MegaDebrid does NOT support native WebDAV.
     *
     * @returns Always `null`.
     */
    getWebDAVConfig() {
        return null;
    }
    /**
     * Returns the local port the WebDAV bridge listens on for MegaDebrid.
     *
     * @returns The configured bridge port (default from config).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortMD;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Fetches detailed file information for a specific torrent.
     *
     * Uses `GET /?action=torrent-status&token=K&id=ID` to retrieve
     * file listing with download URLs.
     *
     * @param torrentId - The MegaDebrid torrent ID.
     * @returns Array of virtual files for the torrent.
     */
    async fetchTorrentFilesInternal(torrentId) {
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const url = getBaseUrl();
        const res = await httpClient_1.axiosIPv4.get(url, {
            params: {
                ...authParams(),
                action: 'torrent-status',
                id: torrentId,
            },
            timeout: 20000,
        });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const data = unwrapResponse(res, `fetch files for torrent ${torrentId}`);
        const rawFiles = Array.isArray(data?.files) ? data.files : (Array.isArray(data) ? data : []);
        return rawFiles.map((f, idx) => ({
            id: String(f.id ?? idx),
            name: (0, utils_1.sanitiseName)(f.name || `file_${idx}`),
            size: typeof f.size === 'number' ? f.size : 0,
        }));
    }
    /**
     * Normalises raw MegaDebrid API responses into the standard
     * {@link TorrentInfo} shape.
     *
     * @param rawTorrents - Array of raw torrent objects from the MegaDebrid API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTorrents) {
        return rawTorrents.map((t) => {
            const statusString = String(t.status || '').toLowerCase();
            const progress = COMPLETED_STATUSES.has(statusString)
                ? 100
                : (typeof t.progress === 'number' ? t.progress : (typeof t.percent === 'number' ? t.percent : 0));
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
            if (overrideToken && overrideToken !== config_1.config.megadebridApiKey) {
                console.warn(`[${new Date().toISOString()}][megadebrid] download token rate limited during ${operation}`, { status });
                return;
            }
            let backoffMs;
            if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
            }
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
            console.warn(`[${new Date().toISOString()}][megadebrid] rate limited during ${operation}`, { status, backoffMs });
        }
        else {
            console.error(`[${new Date().toISOString()}][megadebrid] ${operation} error: ${errorMsg}`, { status });
        }
    }
}
exports.MegaDebridProvider = MegaDebridProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
registry_1.registry.register(new MegaDebridProvider());
// Register with token rotator for download token cycling
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.megadebridApiKey, config_1.config.megadebridDownloadTokens);
