"use strict";
/**
 * SchroDrive — Put.io Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Put.io
 * cloud storage and debrid service. Wraps the Put.io v2 API (transfer
 * listing, magnet addition, file retrieval, download URL resolution)
 * and adds WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * Put.io authenticates via `Authorization: Bearer <TOKEN>` header.
 * Response format: `{ transfers: [...], status: "OK" }` for transfer operations.
 *
 * Put.io uses a folder-based model: completed transfers create folders,
 * files are listed via `GET /files/list?parent_id=FOLDER_ID`, and downloads
 * are initiated via `GET /files/{id}/download` which returns a 302 redirect.
 *
 * @module providers/putio
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PutioProvider = void 0;
const httpClient_1 = require("../core/httpClient");
const utils_1 = require("../core/utils");
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const tokenRotator_1 = require("../core/tokenRotator");
const registry_1 = require("./registry");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'putio';
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'putio_torrents';
// ===========================================================================
// Put.io Status Mapping
// ===========================================================================
/**
 * Put.io uses uppercase string statuses for transfer state.
 *
 * Known statuses:
 * - "COMPLETED"   — fully downloaded and available
 * - "DOWNLOADING" — actively downloading from peers
 * - "IN_QUEUE"    — waiting in the download queue
 * - "SEEDING"     — seeding to peers (completed)
 * - "ERROR"       — download failed
 */
/** Status strings that indicate an error / dead transfer. */
const ERROR_STATUSES = new Set(['error']);
/** Status strings indicating the transfer is complete (downloadable). */
const COMPLETED_STATUSES = new Set(['completed', 'seeding']);
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Returns the Put.io API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.putioApiBase || 'https://api.put.io/v2').replace(/\/$/, '');
}
/**
 * Builds the authorisation headers for Put.io API requests.
 * Uses Bearer token authentication.
 *
 * @param overrideToken - Optional token override for download rotation.
 * @returns A headers object containing the Bearer token.
 */
function authHeaders(overrideToken) {
    return {
        Authorization: `Bearer ${overrideToken || config_1.config.putioOauthToken}`,
    };
}
/**
 * Validates a Put.io API response and throws on error.
 *
 * Put.io returns `{ status: "OK" }` on success. Errors may include
 * an `error_type` and `error_message` field.
 *
 * @param res - The Axios response object.
 * @param operation - Description of the operation for error messages.
 * @returns The response data.
 * @throws {Error} If the response indicates an error.
 */
function unwrapResponse(res, operation) {
    const body = res?.data;
    if (body?.status === 'ERROR' || body?.error_type) {
        const errMsg = body?.error_message || body?.error_type || 'Unknown Put.io error';
        throw new Error(`Put.io ${operation} failed: ${errMsg}`);
    }
    return body;
}
// ===========================================================================
// PutioProvider
// ===========================================================================
/**
 * Debrid provider implementation for Put.io.
 *
 * Wraps all Put.io-specific API interactions behind the standard
 * {@link DebridProvider} interface, including transfer management,
 * WebDAV bridge support, and mount configuration.
 *
 * Put.io uses a transfer + file model: magnets are added as transfers,
 * completed transfers create folders in the file tree, and individual
 * files are downloaded via 302 redirects.
 */
class PutioProvider {
    constructor() {
        this.id = 'putio';
        this.displayName = 'Put.io';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether Put.io is configured with a valid OAuth token.
     *
     * @returns `true` if the Put.io OAuth token is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.putioOauthToken;
    }
    /**
     * Checks whether Put.io API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before Put.io requests
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
     * Fetches the complete list of transfers from Put.io.
     * Returns cached data when rate-limited or on error.
     *
     * Uses `GET /transfers/list` which returns
     * `{ transfers: [...], status: "OK" }`.
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
                console.warn(`[${new Date().toISOString()}][putio] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][putio] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/list`;
            const res = await httpClient_1.axiosIPv4.get(url, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'list transfers');
            const transfers = Array.isArray(data?.transfers) ? data.transfers : [];
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, transfers);
            console.log(`[${new Date().toISOString()}][putio] fetched ${transfers.length} transfer items`);
            return this.normaliseTorrents(transfers);
        }
        catch (err) {
            this.handleError(err, 'list transfers');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][putio] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Adds a magnet link to Put.io for downloading.
     *
     * Uses `POST /transfers/add` with form data `url=MAGNET_URI`.
     *
     * @param magnet - The magnet URI to add.
     * @param _name - Unused (Put.io derives the name from the magnet).
     * @returns An object containing the transfer `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`Put.io rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/add`;
            const params = new URLSearchParams();
            params.set('url', magnet);
            const res = await httpClient_1.axiosIPv4.post(url, params, {
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'add magnet');
            const transfer = data?.transfer;
            const id = String(transfer?.id || '');
            if (!id) {
                throw new Error('Put.io transfers/add returned no ID');
            }
            console.log(`[${new Date().toISOString()}][putio] added magnet as transfer ${id}`);
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Uploads a .torrent file buffer to Put.io.
     *
     * Uses `POST /transfers/add` with multipart form data.
     * The file is sent as a `file` field in the form.
     *
     * @param fileBuffer - The raw .torrent file contents.
     * @param name - Optional human-readable name for logging.
     * @returns An object containing the transfer `id`.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addTorrentFile(fileBuffer, name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`Put.io rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/add`;
            console.log(`[${new Date().toISOString()}][putio] Uploading .torrent file${name ? `: ${name}` : ''}`);
            const formData = new FormData();
            formData.append('file', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');
            const res = await httpClient_1.axiosIPv4.post(url, formData, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'upload torrent file');
            const transfer = data?.transfer;
            const id = String(transfer?.id || '');
            if (!id) {
                throw new Error('Put.io transfers/add (file) returned no ID');
            }
            return { id };
        }
        catch (err) {
            this.handleError(err, 'add torrent file');
            throw err;
        }
    }
    /**
     * Checks whether a transfer with a matching title already exists in Put.io.
     *
     * Fetches the current transfer list and performs a case-insensitive
     * bi-directional substring match.
     *
     * @param title - The title to search for among existing transfers.
     * @returns `true` if a matching transfer already exists.
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
            console.warn(`[${new Date().toISOString()}][putio] check existing failed`, { error: err?.message });
            return false;
        }
    }
    /**
     * Determines whether a Put.io transfer is considered "dead" (failed or errored).
     *
     * A transfer is NOT dead if its progress has reached 100%. Otherwise, it is
     * considered dead if its status is "ERROR" or contains "error"/"dead"/"deleted".
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
     * Cancels/deletes a transfer from Put.io by its ID.
     *
     * Uses `POST /transfers/cancel` with form data `transfer_ids=ID`.
     *
     * @param torrentId - The Put.io transfer ID to cancel.
     * @throws {Error} If the cancellation fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`Put.io rate limited, cannot delete transfer ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/cancel`;
            const params = new URLSearchParams();
            params.set('transfer_ids', torrentId);
            await httpClient_1.axiosIPv4.post(url, params, {
                headers: {
                    ...authHeaders(),
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][putio] cancelled transfer ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete transfer ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a transfer, used for repair (re-adding).
     *
     * @param torrentId - The Put.io transfer ID.
     * @returns The info hash string, or null if not available.
     */
    async getInfoHash(torrentId) {
        // Check cached transfer list first
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            const transfer = cached.find((t) => String(t.id) === String(torrentId));
            if (transfer?.hash)
                return transfer.hash;
            if (transfer?.hashString)
                return transfer.hashString;
        }
        // Fall back to API call
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME))
            return null;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/list`;
            const res = await httpClient_1.axiosIPv4.get(url, {
                headers: authHeaders(),
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'get transfer info');
            const transfers = Array.isArray(data?.transfers) ? data.transfers : [];
            const transfer = transfers.find((t) => String(t.id) === String(torrentId));
            const hash = transfer?.hash || transfer?.hashString;
            return typeof hash === 'string' && hash.length >= 32 ? hash : null;
        }
        catch (err) {
            this.handleError(err, `get info hash ${torrentId}`);
            return null;
        }
    }
    /**
     * Attempts to repair a dead transfer by re-adding the same magnet.
     *
     * @param torrentId - The Put.io transfer ID to repair.
     * @returns `true` if repair succeeded, `false` if the transfer should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][putio] attempting repair for transfer ${torrentId}`);
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][putio] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][putio] repair delete failed for ${torrentId}`, { err: err?.message });
            return false;
        }
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][putio] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][putio] repair re-add failed`, { hash: infoHash, err: err?.message });
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete transfer list from Put.io and converts completed
     * transfers into virtual directories.
     *
     * For completed transfers, fetches files from the transfer's save folder
     * via `GET /files/list?parent_id=FOLDER_ID` to populate the virtual file list.
     *
     * @returns Array of virtual directories representing completed transfers.
     */
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][putio] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/transfers/list`;
            const res = await httpClient_1.axiosIPv4.get(url, {
                headers: authHeaders(),
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'fetch directories');
            const transfers = Array.isArray(data?.transfers) ? data.transfers : [];
            // Only include completed transfers
            const completed = transfers.filter((t) => {
                const s = String(t.status || '').toLowerCase();
                return COMPLETED_STATUSES.has(s);
            });
            console.log(`[${new Date().toISOString()}][putio] fetched ${completed.length} completed transfers out of ${transfers.length} total`);
            const directories = [];
            for (const t of completed) {
                try {
                    const folderId = t.file_id || t.save_parent_id;
                    if (!folderId) {
                        console.warn(`[${new Date().toISOString()}][putio] transfer ${t.id} has no folder ID, skipping file fetch`);
                        directories.push({
                            id: String(t.id),
                            name: (0, utils_1.sanitiseName)(t.name || String(t.id)),
                            originalName: t.name || String(t.id),
                            files: [],
                        });
                        continue;
                    }
                    const files = await this.fetchFilesForFolder(String(folderId));
                    directories.push({
                        id: String(t.id),
                        name: (0, utils_1.sanitiseName)(t.name || String(t.id)),
                        originalName: t.name || String(t.id),
                        files,
                    });
                }
                catch (fileErr) {
                    console.warn(`[${new Date().toISOString()}][putio] failed to fetch files for transfer ${t.id}`, { error: fileErr?.message });
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
     * Resolves a direct download URL for a Put.io file.
     *
     * Uses `GET /files/{id}/download` which returns a 302 redirect to
     * the actual download URL. We follow the redirect and capture the
     * final URL, or extract from response headers.
     *
     * @param torrentId - The Put.io transfer ID (used for logging context).
     * @param fileId - The Put.io file ID to download.
     * @param _linkIndex - Unused for Put.io.
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.putioOauthToken;
        const isRotated = downloadToken !== config_1.config.putioOauthToken;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][putio] rate limited, cannot resolve download URL for transfer ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = `${getBaseUrl()}/files/${encodeURIComponent(fileId)}/download`;
            const res = await httpClient_1.axiosIPv4.get(url, {
                headers: authHeaders(downloadToken),
                timeout: 30000,
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            // Check for 302 redirect — the Location header contains the download URL
            if (res.status === 302 || res.status === 301) {
                const location = res.headers?.location;
                if (location)
                    return location;
            }
            // Some responses return JSON with a url field
            const data = res?.data;
            if (data?.url)
                return data.url;
            if (data?.location)
                return data.location;
            console.warn(`[${new Date().toISOString()}][putio] no download URL found for file ${fileId} in transfer ${torrentId}`);
            return null;
        }
        catch (err) {
            // Handle redirect response captured as an error (axios throws on 3xx with maxRedirects: 0)
            if (err?.response?.status === 302 || err?.response?.status === 301) {
                const location = err.response.headers?.location;
                if (location) {
                    rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                    return location;
                }
            }
            this.handleError(err, `resolve download URL for transfer ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.putioOauthToken) {
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
     * Checks whether native Put.io WebDAV credentials are configured.
     *
     * @returns `true` if all three WebDAV settings (URL, username, password) are set.
     */
    hasDirectWebDAV() {
        return !!(config_1.config.putioWebdavUrl && config_1.config.putioWebdavUsername && config_1.config.putioWebdavPassword);
    }
    /**
     * Checks whether the Put.io OAuth token is configured.
     *
     * @returns `true` if the OAuth token is set.
     */
    hasApiKey() {
        return !!config_1.config.putioOauthToken;
    }
    /**
     * Returns the native Put.io WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.putioWebdavUrl,
            username: config_1.config.putioWebdavUsername,
            password: config_1.config.putioWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for Put.io.
     *
     * @returns The configured bridge port (default from config).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortPUTIO;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Fetches the file list for a given Put.io folder.
     *
     * Uses `GET /files/list?parent_id=FOLDER_ID` to retrieve child files.
     *
     * @param folderId - The Put.io folder ID to list.
     * @returns Array of virtual files in the folder.
     */
    async fetchFilesForFolder(folderId) {
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const url = `${getBaseUrl()}/files/list`;
        const res = await httpClient_1.axiosIPv4.get(url, {
            headers: authHeaders(),
            params: { parent_id: folderId },
            timeout: 20000,
        });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const data = unwrapResponse(res, `fetch files for folder ${folderId}`);
        const rawFiles = Array.isArray(data?.files) ? data.files : [];
        return rawFiles.map((f, idx) => ({
            id: String(f.id ?? idx),
            name: (0, utils_1.sanitiseName)(f.name || `file_${idx}`),
            size: typeof f.size === 'number' ? f.size : 0,
        }));
    }
    /**
     * Normalises raw Put.io API responses into the standard
     * {@link TorrentInfo} shape.
     *
     * @param rawTransfers - Array of raw transfer objects from the Put.io API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTransfers) {
        return rawTransfers.map((t) => {
            const statusString = String(t.status || '').toLowerCase();
            const progress = COMPLETED_STATUSES.has(statusString)
                ? 100
                : (typeof t.percent_done === 'number' ? t.percent_done : (typeof t.progress === 'number' ? t.progress : 0));
            // Put.io transfers don't embed files directly — they reference folders
            const files = [];
            return {
                id: String(t.id || ''),
                name: t.name || '',
                filename: t.name,
                status: statusString,
                progress,
                bytes: typeof t.size === 'number' ? t.size : 0,
                files,
                addedAt: t.created_at ? new Date(t.created_at) : undefined,
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
            if (overrideToken && overrideToken !== config_1.config.putioOauthToken) {
                console.warn(`[${new Date().toISOString()}][putio] download token rate limited during ${operation}`, { status });
                return;
            }
            let backoffMs;
            if (retryAfter) {
                const parsed = parseInt(retryAfter, 10);
                backoffMs = isNaN(parsed) ? undefined : parsed * 1000;
            }
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, `${status} rate limit`, backoffMs);
            console.warn(`[${new Date().toISOString()}][putio] rate limited during ${operation}`, { status, backoffMs });
        }
        else {
            console.error(`[${new Date().toISOString()}][putio] ${operation} error: ${errorMsg}`, { status });
        }
    }
}
exports.PutioProvider = PutioProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
registry_1.registry.register(new PutioProvider());
// Register with token rotator for download token cycling
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.putioOauthToken, config_1.config.putioDownloadTokens);
