"use strict";
/**
 * SchroDrive — Debrid-Link Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Debrid-Link
 * debrid service. Wraps the Debrid-Link Seedbox API v2 (torrent listing,
 * magnet addition, file retrieval, download URL resolution) and adds
 * WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * Debrid-Link authenticates via `Authorization: Bearer <API_KEY>` header.
 * Response format: `{ success: true, value: ... }` or `{ success: false, error: "...", error_description: "..." }`.
 *
 * @module providers/debridlink
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DebridLinkProvider = void 0;
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
const PROVIDER_NAME = 'debridlink';
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
const axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'debridlink_torrents';
// ===========================================================================
// Debrid-Link Status Code Mapping
// ===========================================================================
/**
 * Maps Debrid-Link seedbox status codes to human-readable strings.
 *
 * - 0: Queued — waiting in the download queue
 * - 1: Downloading — actively downloading from peers
 * - 2: Processing — post-download processing
 * - 3: Seeding — seeding to peers
 * - 4: Finished — fully downloaded and available
 * - 5: Error — download failed
 * - 6: Deleted — removed from seedbox
 */
const STATUS_MAP = {
    0: 'queued',
    1: 'downloading',
    2: 'processing',
    3: 'seeding',
    4: 'finished',
    5: 'error',
    6: 'deleted',
};
/** Status codes that indicate an error / dead torrent. */
const ERROR_STATUS_CODES = new Set([5]);
/** Status code that indicates a fully completed torrent. */
const FINISHED_STATUS_CODE = 4;
/** Status codes indicating the torrent is complete (downloadable). */
const COMPLETED_STATUS_CODES = new Set([3, 4]);
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Returns the Debrid-Link API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.debridlinkApiBase || 'https://debrid-link.com/api/v2').replace(/\/$/, '');
}
/**
 * Builds the authorisation headers for Debrid-Link API requests.
 * Uses Bearer token authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A headers object containing the Bearer token.
 */
function authHeaders(overrideToken) {
    return {
        Authorization: `Bearer ${overrideToken || config_1.config.debridlinkApiKey}`,
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
 * Extracts the response data from a Debrid-Link API response.
 *
 * Debrid-Link wraps all responses in `{ success: true|false, value: {...} }`.
 * This helper extracts the `value` property and throws on error responses.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The unwrapped value object.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res, operation) {
    const body = res?.data;
    if (body?.success === false) {
        const errMsg = body?.error_description || body?.error || 'Unknown Debrid-Link error';
        throw new Error(`DebridLink ${operation} failed: ${errMsg}`);
    }
    return body?.value ?? body;
}
// ===========================================================================
// DebridLinkProvider
// ===========================================================================
/**
 * Debrid provider implementation for Debrid-Link.
 *
 * Wraps all Debrid-Link-specific API interactions behind the standard
 * {@link DebridProvider} interface, including seedbox management,
 * WebDAV bridge support, and mount configuration.
 *
 * Debrid-Link uses a seedbox model where torrents are added and managed
 * via the `/seedbox/*` endpoint family. Completed torrents embed direct
 * download URLs in their file entries — no separate unrestrict step is needed.
 */
class DebridLinkProvider {
    constructor() {
        this.id = 'debridlink';
        this.displayName = 'DebridLink';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether Debrid-Link is configured with a valid API key.
     *
     * @returns `true` if the Debrid-Link API key is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.debridlinkApiKey;
    }
    /**
     * Checks whether Debrid-Link API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before Debrid-Link requests
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
     * Fetches the complete list of seedbox torrents from Debrid-Link.
     * Returns cached data when rate-limited or on error.
     *
     * Uses `GET /seedbox/list` which returns `{ success: true, value: [...] }`.
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
                console.warn(`[${new Date().toISOString()}][dl] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][dl] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/list`;
            const res = await axiosIPv4.get(url, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'list seedbox');
            const torrents = Array.isArray(data) ? data : [];
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, torrents);
            console.log(`[${new Date().toISOString()}][dl] fetched ${torrents.length} seedbox items`);
            return this.normaliseTorrents(torrents);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][dl] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Adds a magnet link to Debrid-Link's seedbox for downloading.
     *
     * Uses `POST /seedbox/add` with form data `url=MAGNET_URI`.
     *
     * @param magnet - The magnet URI to add.
     * @param _name - Unused (Debrid-Link derives the name from the magnet).
     * @returns An object containing the seedbox torrent `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`DebridLink rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/add`;
            const params = new URLSearchParams();
            params.set('url', magnet);
            const res = await axiosIPv4.post(url, params, {
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'add magnet');
            const id = String(data?.id || '');
            if (!id) {
                throw new Error('DebridLink seedbox/add returned no ID');
            }
            console.log(`[${new Date().toISOString()}][dl] added magnet as seedbox item ${id}`);
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Uploads a .torrent file buffer to Debrid-Link's seedbox.
     *
     * Uses `POST /seedbox/add` with multipart form data.
     * The file is sent as a `file` field in the form.
     *
     * @param fileBuffer - The raw .torrent file contents.
     * @param name - Optional human-readable name for logging.
     * @returns An object containing the seedbox torrent `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addTorrentFile(fileBuffer, name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`DebridLink rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/add`;
            console.log(`[${new Date().toISOString()}][dl] Uploading .torrent file${name ? `: ${name}` : ''}`);
            const formData = new FormData();
            formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');
            const res = await axiosIPv4.post(url, formData, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'upload torrent file');
            const id = String(data?.id || '');
            if (!id) {
                throw new Error('DebridLink seedbox/add (file) returned no ID');
            }
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add torrent file');
            throw err;
        }
    }
    /**
     * Checks whether a torrent with a matching title already exists in Debrid-Link.
     *
     * Fetches the current seedbox list and performs a case-insensitive
     * bi-directional substring match.
     *
     * @param title - The title to search for among existing seedbox items.
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
            console.warn(`[${new Date().toISOString()}][dl] check existing failed`, { error: err?.message });
            return false;
        }
    }
    /**
     * Determines whether a Debrid-Link torrent is considered "dead" (failed or errored).
     *
     * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
     * considered dead if its status maps to an error code (5) or contains "error".
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
     * Deletes a torrent from Debrid-Link's seedbox by its ID.
     *
     * Uses `DELETE /seedbox/{id}/remove`.
     *
     * @param torrentId - The Debrid-Link seedbox item ID to delete.
     * @throws {Error} If the deletion fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`DebridLink rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/${encodeURIComponent(torrentId)}/remove`;
            await axiosIPv4.delete(url, {
                headers: authHeaders(),
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][dl] deleted seedbox item ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete torrent ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a seedbox torrent, used for repair (re-adding).
     *
     * @param torrentId - The Debrid-Link seedbox item ID.
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
            const url = `${getBaseUrl()}/seedbox/list`;
            const res = await axiosIPv4.get(url, {
                headers: authHeaders(),
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
     * @param torrentId - The Debrid-Link seedbox item ID to repair.
     * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][dl] attempting repair for seedbox item ${torrentId}`);
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][dl] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][dl] repair delete failed for ${torrentId}`, { err: err?.message });
            return false;
        }
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][dl] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][dl] repair re-add failed`, { hash: infoHash, err: err?.message });
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete seedbox list from Debrid-Link and converts completed
     * torrents into virtual directories.
     *
     * Debrid-Link embeds file details directly in the seedbox response (similar
     * to AllDebrid), so files are populated inline — no separate file fetch needed.
     *
     * @returns Array of virtual directories representing completed seedbox items.
     */
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][dl] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/list`;
            const res = await axiosIPv4.get(url, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'fetch directories');
            const torrents = Array.isArray(data) ? data : [];
            // Only include completed torrents (status 3=seeding or 4=finished)
            const completed = torrents.filter((t) => {
                const statusCode = typeof t.status === 'number' ? t.status : -1;
                return COMPLETED_STATUS_CODES.has(statusCode);
            });
            console.log(`[${new Date().toISOString()}][dl] fetched ${completed.length} completed seedbox items out of ${torrents.length} total`);
            return completed.map((t) => {
                const rawFiles = Array.isArray(t.files) ? t.files : [];
                const files = rawFiles.map((f, idx) => ({
                    id: String(f.id ?? idx),
                    name: sanitiseName(f.name || `file_${idx}`),
                    size: typeof f.size === 'number' ? f.size : 0,
                }));
                return {
                    id: String(t.id),
                    name: sanitiseName(t.name || String(t.id)),
                    originalName: t.name || String(t.id),
                    files,
                };
            });
        }
        catch (err) {
            this.handleError(err, 'fetch directories');
            return [];
        }
    }
    /**
     * Resolves a direct download URL for a Debrid-Link file.
     *
     * Debrid-Link embeds download URLs directly in the file entries of completed
     * seedbox items. We fetch the seedbox list, locate the torrent, and return
     * the URL from the matching file entry.
     *
     * @param torrentId - The Debrid-Link seedbox item ID.
     * @param fileId - The file ID or index within the seedbox item.
     * @param _linkIndex - Unused for Debrid-Link.
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.debridlinkApiKey;
        const isRotated = downloadToken !== config_1.config.debridlinkApiKey;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][dl] rate limited, cannot resolve download URL for seedbox item ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/seedbox/list`;
            const res = await axiosIPv4.get(url, {
                headers: authHeaders(downloadToken),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'resolve download URL');
            const torrents = Array.isArray(data) ? data : [];
            const torrent = torrents.find((t) => String(t.id) === String(torrentId));
            if (!torrent) {
                console.error(`[${new Date().toISOString()}][dl] torrent ${torrentId} not found in seedbox list`);
                return null;
            }
            const rawFiles = Array.isArray(torrent.files) ? torrent.files : [];
            // Try matching by file ID first, then by index
            let file = rawFiles.find((f) => String(f.id) === String(fileId));
            if (!file) {
                const fileIndex = parseInt(fileId, 10);
                if (!isNaN(fileIndex) && fileIndex >= 0 && fileIndex < rawFiles.length) {
                    file = rawFiles[fileIndex];
                }
            }
            if (!file) {
                console.warn(`[${new Date().toISOString()}][dl] file ${fileId} not found in seedbox item ${torrentId} (${rawFiles.length} files available)`);
                return null;
            }
            const downloadUrl = file.downloadUrl || file.url || file.link;
            if (!downloadUrl) {
                console.error(`[${new Date().toISOString()}][dl] file found but no download URL for seedbox item ${torrentId}, file ${fileId}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for seedbox item ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.debridlinkApiKey) {
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
     * Checks whether native Debrid-Link WebDAV credentials are configured.
     *
     * @returns `true` if all three WebDAV settings (URL, username, password) are set.
     */
    hasDirectWebDAV() {
        return !!(config_1.config.debridlinkWebdavUrl && config_1.config.debridlinkWebdavUsername && config_1.config.debridlinkWebdavPassword);
    }
    /**
     * Checks whether the Debrid-Link API key is configured.
     *
     * @returns `true` if the API key is set.
     */
    hasApiKey() {
        return !!config_1.config.debridlinkApiKey;
    }
    /**
     * Returns the native Debrid-Link WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.debridlinkWebdavUrl,
            username: config_1.config.debridlinkWebdavUsername,
            password: config_1.config.debridlinkWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for Debrid-Link.
     *
     * @returns The configured bridge port (default: 9119).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortDL;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Normalises raw Debrid-Link seedbox API responses into the standard
     * {@link TorrentInfo} shape.
     *
     * @param rawTorrents - Array of raw seedbox objects from the Debrid-Link API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTorrents) {
        return rawTorrents.map((t) => {
            const statusCode = typeof t.status === 'number' ? t.status : -1;
            const statusString = STATUS_MAP[statusCode] || String(t.status || '');
            const progress = COMPLETED_STATUS_CODES.has(statusCode)
                ? 100
                : (typeof t.downloadPercent === 'number' ? t.downloadPercent : 0);
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
                addedAt: t.created ? new Date(t.created * 1000) : undefined,
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
            if (overrideToken && overrideToken !== config_1.config.debridlinkApiKey) {
                console.warn(`[${new Date().toISOString()}][dl] download token rate limited during ${operation}`, { status });
                return;
            }
            let backoffMs;
            if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
            }
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
            console.warn(`[${new Date().toISOString()}][dl] rate limited during ${operation}`, { status, backoffMs });
        }
        else {
            console.error(`[${new Date().toISOString()}][dl] ${operation} error: ${errorMsg}`, { status });
        }
    }
}
exports.DebridLinkProvider = DebridLinkProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
registry_1.registry.register(new DebridLinkProvider());
// Register with token rotator for download token cycling
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.debridlinkApiKey, config_1.config.debridlinkDownloadTokens);
