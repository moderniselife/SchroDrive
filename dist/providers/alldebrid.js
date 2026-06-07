"use strict";
/**
 * SchroDrive — AllDebrid Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the AllDebrid
 * debrid service. Wraps the AllDebrid v4/v4.1 API (magnet listing, upload,
 * file selection, link unlocking) and adds WebDAV bridge support methods
 * (directory fetching, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * AllDebrid authenticates via `Authorization: Bearer <apikey>` header.
 * Rate limits: 12 req/s, 600 req/min.
 *
 * API version notes (Oct 2024+):
 * - /v4/magnet/status is DEPRECATED — use /v4.1/magnet/status (POST)
 * - /v4/magnet/upload, /v4/magnet/delete, /v4/link/unlock remain v4
 * - Auth: Bearer header (query param `apikey` removed)
 *
 * @module providers/alldebrid
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AllDebridProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const tokenRotator_1 = require("../core/tokenRotator");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'alldebrid';
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
const axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'alldebrid_torrents';
// ===========================================================================
// AllDebrid Status Code Mapping
// ===========================================================================
/**
 * Maps AllDebrid magnet status codes (v4.1) to human-readable strings.
 *
 * - 0: In Queue — queued for processing
 * - 1: Downloading — actively downloading from peers
 * - 2: Compressing / Moving
 * - 3: Uploading
 * - 4: Ready — fully downloaded and available
 * - 5: Upload fail
 * - 6: Internal error on unpacking
 * - 7: Not downloaded in 20 min
 * - 8: File too big
 * - 9: Internal error
 * - 10: Download took more than 72h
 */
const STATUS_MAP = {
    0: 'processing',
    1: 'downloading',
    2: 'compressing',
    3: 'uploading',
    4: 'finished',
    5: 'upload_error',
    6: 'unpack_error',
    7: 'timeout_20min',
    8: 'file_too_big',
    9: 'internal_error',
    10: 'timeout_72h',
};
/** Status codes that indicate an error / dead torrent. */
const ERROR_STATUS_CODES = new Set([5, 6, 7, 8, 9, 10]);
/** Status code that indicates a fully completed torrent. */
const FINISHED_STATUS_CODE = 4;
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Returns the AllDebrid API base URL (no version suffix), stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.alldebridApiBase || 'https://api.alldebrid.com').replace(/\/v4\.?\d*\/?$/, '').replace(/\/$/, '');
}
/**
 * Returns the API key to use for the current request.
 */
function getApiKey(overrideApiKey) {
    return overrideApiKey || config_1.config.alldebridApiKey;
}
/**
 * Builds common headers for AllDebrid API requests.
 * Uses `Authorization: Bearer <apikey>` header (v4.1+ auth method).
 *
 * @param overrideApiKey - Optional API key override for token rotation.
 * @returns Headers object with Authorization and agent.
 */
function authHeaders(overrideApiKey) {
    return {
        'Authorization': `Bearer ${getApiKey(overrideApiKey)}`,
    };
}
/**
 * Constructs a URL for AllDebrid API requests.
 * The path should include the version prefix (e.g. `/v4/magnet/upload` or `/v4.1/magnet/status`).
 *
 * @param path - The API path with version prefix (e.g. `/v4.1/magnet/status`).
 * @param extra - Additional query parameters to include.
 * @returns The fully-qualified URL string.
 */
function buildUrl(path, extra = {}) {
    const base = getBaseUrl();
    const url = new URL(path.startsWith('http') ? path : `${base}${path}`);
    // Add agent parameter (still supported as query param)
    url.searchParams.set('agent', config_1.config.alldebridAgent || 'schrodrive');
    for (const [key, value] of Object.entries(extra)) {
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
function unwrapResponse(res, operation) {
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
class AllDebridProvider {
    constructor() {
        this.id = 'alldebrid';
        this.displayName = 'AllDebrid';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether AllDebrid is configured with a valid API key.
     *
     * @returns `true` if the AllDebrid API key is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.alldebridApiKey;
    }
    /**
     * Checks whether AllDebrid API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before AllDebrid requests
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
     * Fetches the complete list of magnets from AllDebrid.
     * Returns cached data when rate-limited or on error.
     *
     * AllDebrid returns all magnets in a single request via
     * `GET /v4/magnet/status` (no pagination needed).
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
                console.warn(`[${new Date().toISOString()}][ad] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][ad] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4.1/magnet/status');
            const res = await axiosIPv4.post(url, null, { headers: authHeaders(), timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'list magnets');
            const magnets = Array.isArray(data?.magnets) ? data.magnets : [];
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, magnets);
            console.log(`[${new Date().toISOString()}][ad] fetched ${magnets.length} magnets`);
            return this.normaliseTorrents(magnets);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
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
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`AllDebrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            // Step 1: Upload the magnet
            const uploadUrl = buildUrl('/v4/magnet/upload');
            const params = new URLSearchParams();
            params.set('magnets[]', magnet);
            const uploadRes = await axiosIPv4.post(uploadUrl, params, {
                headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
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
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Uploads a .torrent file buffer to AllDebrid.
     *
     * Uses `POST /v4/magnet/upload/file` with multipart form data.
     * The file is sent as a `files[]` field in the form.
     * Automatically selects all files after upload (same as addMagnet).
     *
     * @param fileBuffer - The raw .torrent file contents.
     * @param name - Optional human-readable name for logging.
     * @returns An object containing the magnet `id` from the AllDebrid response.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addTorrentFile(fileBuffer, name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`AllDebrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4/magnet/upload/file');
            console.log(`[${new Date().toISOString()}][ad] Uploading .torrent file${name ? `: ${name}` : ''}`);
            const formData = new FormData();
            formData.append('files[]', new Blob([new Uint8Array(fileBuffer)], { type: 'application/x-bittorrent' }), name || 'upload.torrent');
            const uploadRes = await axiosIPv4.post(url, formData, {
                headers: { ...authHeaders() },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const uploadData = unwrapResponse(uploadRes, 'upload torrent file');
            // AllDebrid returns { files: [{ id, ... }] } or { magnets: [{ id, ... }] }
            const magnetId = String(uploadData?.files?.[0]?.id || uploadData?.magnets?.[0]?.id || '');
            if (!magnetId) {
                throw new Error('AllDebrid upload/file returned no magnet ID');
            }
            // Select all files
            await this.selectAllFiles(magnetId);
            return { id: magnetId };
        }
        catch (err) {
            this.handleError(err, 'add torrent file');
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
    async selectAllFiles(id) {
        if (!id)
            return;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            console.warn(`[${new Date().toISOString()}][ad] rate limited, skipping select files (wait ${waitTime}s)`);
            return;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4/magnet/selectFiles');
            const selectParams = new URLSearchParams();
            selectParams.set('id', id);
            selectParams.set('files[]', 'all');
            await axiosIPv4.post(url, selectParams, {
                headers: { ...authHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        }
        catch (err) {
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
    isTorrentDead(torrent) {
        const s = String(torrent?.status || '').toLowerCase();
        // Completed torrents are never dead, regardless of status string
        if (typeof torrent?.progress === 'number' && torrent.progress >= 100)
            return false;
        if (s.includes('error') || s.includes('dead'))
            return true;
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
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`AllDebrid rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4/magnet/delete', { id: torrentId });
            await axiosIPv4.post(url, null, { headers: authHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][ad] deleted magnet ${torrentId}`);
        }
        catch (err) {
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
    async getInfoHash(torrentId) {
        // Check cached torrent list first (avoid unnecessary API call)
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            const magnet = cached.find((m) => String(m.id) === String(torrentId));
            if (magnet?.hash)
                return magnet.hash;
        }
        // Fall back to API call for specific magnet
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME))
            return null;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4.1/magnet/status', { id: torrentId });
            const res = await axiosIPv4.post(url, null, { headers: authHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'get magnet info');
            // Single magnet query returns { magnets: { ... } } (object, not array)
            const magnet = Array.isArray(data?.magnets) ? data.magnets[0] : data?.magnets;
            const hash = magnet?.hash;
            return typeof hash === 'string' && hash.length >= 32 ? hash : null;
        }
        catch (err) {
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
    async repairTorrent(torrentId) {
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
        }
        catch (err) {
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
        }
        catch (err) {
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
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][ad] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            const url = buildUrl('/v4.1/magnet/status');
            const res = await axiosIPv4.post(url, null, { headers: authHeaders(), timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = unwrapResponse(res, 'fetch directories');
            const magnets = Array.isArray(data?.magnets) ? data.magnets : [];
            // Only include fully downloaded magnets (statusCode 4 = finished)
            const completed = magnets.filter((m) => {
                const statusCode = typeof m.statusCode === 'number' ? m.statusCode : -1;
                return statusCode === FINISHED_STATUS_CODE;
            });
            console.log(`[${new Date().toISOString()}][ad] fetched ${completed.length} completed magnets out of ${magnets.length} total`);
            return completed.map((m) => {
                // AllDebrid files use: n (name), s (size), l (link)
                const rawLinks = Array.isArray(m.links) ? m.links : [];
                const files = rawLinks.map((link, idx) => ({
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
        }
        catch (err) {
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
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.alldebridApiKey;
        const isRotated = downloadToken !== config_1.config.alldebridApiKey;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][ad] rate limited, cannot resolve download URL for magnet ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        try {
            // Fetch the magnet info to retrieve the file link
            const infoUrl = buildUrl('/v4.1/magnet/status', { id: torrentId });
            const infoRes = await axiosIPv4.post(infoUrl, null, { headers: authHeaders(downloadToken), timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const infoData = unwrapResponse(infoRes, 'magnet info');
            // When querying a single magnet, AllDebrid returns { magnets: { ... } } (object, not array)
            const magnet = Array.isArray(infoData?.magnets) ? infoData.magnets[0] : infoData?.magnets;
            const rawLinks = Array.isArray(magnet?.links) ? magnet.links : [];
            const fileIndex = parseInt(fileId, 10);
            if (isNaN(fileIndex) || fileIndex < 0 || fileIndex >= rawLinks.length) {
                // Per-file issue (stale mapping) — don't kill the entire torrent
                console.warn(`[${new Date().toISOString()}][ad] File index ${fileId} out of range (${rawLinks.length} links) for magnet ${torrentId} — skipping file`);
                return null;
            }
            const fileLink = rawLinks[fileIndex]?.link || rawLinks[fileIndex]?.l;
            if (!fileLink) {
                console.error(`[${new Date().toISOString()}][ad] no link found at index ${fileId} for magnet ${torrentId}`);
                return null;
            }
            // Unlock the link to get the direct download URL
            await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            const unlockUrl = buildUrl('/v4/link/unlock');
            const params = new URLSearchParams();
            params.set('link', fileLink);
            const unlockRes = await axiosIPv4.post(unlockUrl, params, {
                headers: { ...authHeaders(downloadToken), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const unlockData = unwrapResponse(unlockRes, 'unlock link');
            const downloadUrl = unlockData?.link;
            if (!downloadUrl) {
                console.error(`[${new Date().toISOString()}][ad] unlock returned no download URL for magnet ${torrentId}, file ${fileId}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for magnet ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.alldebridApiKey) {
                const duration = status === 429 ? 60 * 60 * 1000 : undefined; // 1 hour for 429
                tokenRotator_1.tokenRotator.markTokenLimited(PROVIDER_NAME, downloadToken, `${status} ${err?.response?.statusText || 'limit'}`, duration);
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
    hasDirectWebDAV() {
        return !!(config_1.config.alldebridWebdavUrl && config_1.config.alldebridWebdavUsername && config_1.config.alldebridWebdavPassword);
    }
    /**
     * Checks whether the AllDebrid API key is configured.
     *
     * @returns `true` if the API key is set.
     */
    hasApiKey() {
        return !!config_1.config.alldebridApiKey;
    }
    /**
     * Returns the native AllDebrid WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.alldebridWebdavUrl,
            username: config_1.config.alldebridWebdavUsername,
            password: config_1.config.alldebridWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for AllDebrid.
     *
     * @returns The configured bridge port (default: 9117).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortAD;
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
    normaliseTorrents(rawMagnets) {
        return rawMagnets.map((m) => {
            const statusCode = typeof m.statusCode === 'number' ? m.statusCode : -1;
            const statusString = STATUS_MAP[statusCode] || m.status || '';
            const progress = statusCode === FINISHED_STATUS_CODE
                ? 100
                : (typeof m.downloadSpeed === 'number' && typeof m.size === 'number' && m.size > 0
                    ? Math.round(((m.downloaded || 0) / m.size) * 100)
                    : 0);
            // AllDebrid's links array serves as both files and download links
            const rawLinks = Array.isArray(m.links) ? m.links : [];
            const files = rawLinks.map((link, idx) => ({
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
    handleError(err, operation, overrideToken) {
        const errorMsg = err?.message || String(err);
        const responseHeaders = err?.response?.headers;
        const isNetworkError = err?.code === 'ECONNREFUSED' ||
            err?.code === 'ENOTFOUND' ||
            err?.code === 'ETIMEDOUT' ||
            err?.code === 'ECONNRESET' ||
            errorMsg.includes('timeout') ||
            errorMsg.includes('network');
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            // If we used a rotated download token, do NOT globally rate-limit the provider
            const primaryToken = config_1.config.alldebridApiKey;
            if (overrideToken && overrideToken !== primaryToken) {
                console.warn(`[${new Date().toISOString()}][ad] Rotated download token hit 429/rate-limit. Bypassing global rate limit.`);
            }
            else {
                let backoffMs;
                if (responseHeaders) {
                    const retryAfter = responseHeaders['retry-after'] || responseHeaders['Retry-After'];
                    if (retryAfter) {
                        const seconds = parseInt(String(retryAfter), 10);
                        if (Number.isFinite(seconds) && seconds > 0)
                            backoffMs = seconds * 1000;
                    }
                }
                rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg, backoffMs);
            }
        }
        console.error(`[${new Date().toISOString()}][ad] ${operation} failed`, {
            error: errorMsg,
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            isNetworkError,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
    }
}
exports.AllDebridProvider = AllDebridProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
const registry_1 = require("./registry");
registry_1.registry.register(new AllDebridProvider());
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.alldebridApiKey, config_1.config.alldebridDownloadTokens);
