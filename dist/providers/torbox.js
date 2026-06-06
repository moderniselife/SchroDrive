"use strict";
/**
 * SchroDrive — TorBox Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the TorBox debrid
 * service. Wraps the existing TorBox API client logic (torrent listing,
 * magnet addition, existing torrent checking, web/usenet downloads) and
 * adds WebDAV bridge support methods (directory fetching, URL resolution).
 *
 * Uses the `node-torbox-api` SDK client for torrent operations and falls
 * back to direct Axios requests for web/usenet download endpoints.
 * All requests are rate-limited via the shared {@link rateLimiter} singleton.
 *
 * @module providers/torbox
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorBoxProvider = void 0;
exports.isTorboxApiDisabled = isTorboxApiDisabled;
exports.getTorboxApiDisabledReason = getTorboxApiDisabledReason;
const node_torbox_api_1 = require("node-torbox-api");
const axios_1 = __importDefault(require("axios"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const rateLimitStore_1 = require("../core/rateLimitStore");
const tokenRotator_1 = require("../core/tokenRotator");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'torbox';
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
const axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'torbox_torrents';
const WEB_DOWNLOADS_CACHE_KEY = 'torbox_webdownloads';
const USENET_DOWNLOADS_CACHE_KEY = 'torbox_usenetdownloads';
// ===========================================================================
// Plan Limitation Tracking
// ===========================================================================
/** Flag indicating the API has been disabled due to plan limitations (e.g. free tier). */
let apiDisabled = false;
/** Human-readable reason the API was disabled. */
let apiDisabledReason = '';
/**
 * Checks whether TorBox API access has been disabled due to plan limitations.
 *
 * @returns `true` if the API is disabled (user needs to upgrade their plan).
 */
function isTorboxApiDisabled() {
    return apiDisabled;
}
/**
 * Returns the human-readable reason the TorBox API was disabled.
 *
 * @returns The disabled reason string, or empty if not disabled.
 */
function getTorboxApiDisabledReason() {
    return apiDisabledReason;
}
/**
 * Inspects an error to determine if it indicates a plan limitation (HTTP 403
 * with "plan" or "upgrade" in the message). If so, permanently disables
 * further API calls until the application is restarted.
 *
 * @param err - The error object to inspect.
 * @returns `true` if the error was a plan limitation error.
 */
function checkPlanError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('403') && (msg.includes('plan') || msg.includes('upgrade'))) {
        apiDisabled = true;
        apiDisabledReason = 'TorBox API requires a paid plan. Please upgrade at torbox.app';
        console.error(`[${new Date().toISOString()}][torbox] API DISABLED: ${apiDisabledReason}`);
        return true;
    }
    return false;
}
// ===========================================================================
// Client Initialisation
// ===========================================================================
/** Lazily-initialised TorBox SDK client singleton. */
let client = null;
/**
 * Returns the TorBox SDK client, initialising it on first use.
 * Requires the `torboxApiKey` environment variable to be set.
 *
 * The API key is partially masked in log output for security.
 *
 * @returns The initialised TorboxClient instance.
 * @throws {Error} If `torboxApiKey` is not configured.
 */
function getClient() {
    (0, config_1.requireEnv)('torboxApiKey');
    if (!client) {
        const maskedKey = config_1.config.torboxApiKey ? `${config_1.config.torboxApiKey.slice(0, 4)}…` : 'unset';
        console.log(`[${new Date().toISOString()}][torbox] init client`, { baseURL: config_1.config.torboxBaseUrl, apiKey: maskedKey });
        client = new node_torbox_api_1.TorboxClient({ apiKey: config_1.config.torboxApiKey, baseURL: config_1.config.torboxBaseUrl });
    }
    return client;
}
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Builds the authorisation headers required for direct TorBox API requests
 * (used for endpoints not covered by the SDK client).
 *
 * @returns A headers object containing the Bearer token.
 */
function torboxHeaders() {
    return { Authorization: `Bearer ${config_1.config.torboxApiKey}` };
}
/**
 * Returns the TorBox API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.torboxBaseUrl || 'https://api.torbox.app').replace(/\/$/, '');
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
// ===========================================================================
// TorBoxProvider
// ===========================================================================
/**
 * Debrid provider implementation for TorBox.
 *
 * Wraps all TorBox-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent and download
 * management, WebDAV bridge support, plan limitation tracking,
 * and mount configuration.
 */
class TorBoxProvider {
    constructor() {
        this.id = 'torbox';
        this.displayName = 'TorBox';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether TorBox is configured with a valid API key.
     *
     * @returns `true` if the TorBox API key is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.torboxApiKey;
    }
    /**
     * Checks whether TorBox API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before TorBox requests
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
     * Fetches the list of torrents from TorBox. Returns cached data when
     * rate-limited or on error.
     *
     * @returns An array of normalised torrent info objects.
     */
    async listTorrents() {
        if (apiDisabled)
            return [];
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const c = getClient();
        try {
            const res = await c.torrents.getTorrentList({ limit: 100 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            // API may return a single object or an array — normalise to array
            const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, list);
            return this.normaliseTorrents(list);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][torbox] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Adds a magnet link to TorBox for downloading.
     *
     * Throws if the API is disabled (plan limitation), rate-limited,
     * or if the SDK request fails.
     *
     * @param magnet - The magnet URI to add.
     * @param name - Optional human-readable name for the torrent.
     * @returns An object containing the torrent ID.
     * @throws {Error} If the API is disabled, rate-limited, or the request fails.
     */
    async addMagnet(magnet, name) {
        if (apiDisabled) {
            throw new Error(apiDisabledReason);
        }
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`TorBox rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const c = getClient();
        const teaser = magnet.slice(0, 80) + '...';
        console.log(`[${new Date().toISOString()}][torbox] createTorrent`, { name, teaser });
        const started = Date.now();
        try {
            const res = await c.torrents.createTorrent({ magnet, name });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][torbox] createTorrent done`, { ms: Date.now() - started });
            // Extract the torrent ID from the response (SDK type doesn't expose all fields)
            const data = res?.data;
            const id = String(data?.torrent_id || data?.id || '');
            return { id };
        }
        catch (err) {
            checkPlanError(err);
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Checks whether a torrent with a matching title already exists in TorBox.
     *
     * Fetches the current torrent list and performs a case-insensitive
     * bi-directional substring match (search ⊂ torrent name or
     * torrent name ⊂ search) to catch partial matches.
     *
     * @param title - The title to search for among existing torrents.
     * @returns `true` if a matching torrent already exists.
     */
    async checkExisting(title) {
        if (apiDisabled)
            return false;
        if (!this.isConfigured())
            return false;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, skipping check (wait ${waitTime}s)`);
            return false;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const c = getClient();
        console.log(`[${new Date().toISOString()}][torbox] checking existing torrents`, { searchTitle: title });
        const started = Date.now();
        try {
            const res = await c.torrents.getTorrentList({ limit: 100 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const existingTorrents = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
            console.log(`[${new Date().toISOString()}][torbox] existing torrents check`, {
                searchTitle: title,
                count: existingTorrents.length,
                ms: Date.now() - started,
            });
            // Bi-directional case-insensitive substring match
            const normalised = title.toLowerCase();
            const hasExisting = existingTorrents.some((torrent) => {
                const torrentName = (torrent.name || '').toLowerCase();
                return torrentName.includes(normalised) || normalised.includes(torrentName);
            });
            if (hasExisting) {
                console.log(`[${new Date().toISOString()}][torbox] found existing torrent`, {
                    searchTitle: title,
                    existingNames: existingTorrents.slice(0, 3).map((t) => t.name),
                });
            }
            return hasExisting;
        }
        catch (err) {
            if (checkPlanError(err))
                return false;
            this.handleError(err, 'check existing');
            return false;
        }
    }
    /**
     * Determines whether a TorBox torrent is considered "dead"
     * (failed, stalled, or inactive).
     *
     * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
     * considered dead if its status contains "failed", "stalled", or "inactive".
     *
     * @param torrent - The normalised torrent info object.
     * @returns `true` if the torrent is dead/failed.
     */
    isTorrentDead(torrent) {
        const status = String(torrent?.status || '').toLowerCase();
        // Completed torrents are never dead, regardless of status string
        if (typeof torrent?.progress === 'number' && torrent.progress >= 100)
            return false;
        if (status.includes('failed'))
            return true;
        if (status.includes('stalled'))
            return true;
        if (status.includes('inactive'))
            return true;
        return false;
    }
    /**
     * Deletes a torrent from TorBox by its ID.
     *
     * Uses the `POST /v1/api/torrents/controltorrent` endpoint with
     * `operation: 'delete'`. Rate-limit aware.
     *
     * @param torrentId - The TorBox torrent ID to delete.
     * @throws {Error} If the deletion fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`TorBox rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/v1/api/torrents/controltorrent`;
        try {
            await axiosIPv4.post(url, { torrent_id: Number(torrentId), operation: 'delete' }, { headers: torboxHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][torbox] deleted torrent ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete torrent ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a torrent, used for repair (re-adding).
     *
     * Fetches the torrent info from TorBox and returns the hash field.
     * TorBox returns hash in the torrent data from the list endpoint,
     * so we check cached data first before making an API call.
     *
     * @param torrentId - The TorBox torrent ID.
     * @returns The info hash string, or null if not available.
     */
    async getInfoHash(torrentId) {
        // Check cached torrent list first (avoid unnecessary API call)
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            const torrent = cached.find((t) => String(t.id) === String(torrentId));
            if (torrent?.hash)
                return torrent.hash;
        }
        // Fall back to API call
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME))
            return null;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/v1/api/torrents/torrentstatus?id=${encodeURIComponent(torrentId)}`;
        try {
            const res = await axiosIPv4.get(url, { headers: torboxHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const hash = res.data?.data?.hash;
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
     * Flow:
     * 1. Fetch the info hash from the dead torrent
     * 2. Delete the broken torrent
     * 3. Re-add the same magnet to TorBox
     * 4. If successful → repaired; if failed → needs replacement
     *
     * @param torrentId - The TorBox torrent ID to repair.
     * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][torbox] attempting repair for torrent ${torrentId}`);
        // Step 1: Get the info hash before deletion
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][torbox] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        // Step 2: Delete the broken torrent
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][torbox] repair delete failed for ${torrentId}`, { err: err?.message });
            return false;
        }
        // Step 3: Re-add the same magnet
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][torbox] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][torbox] repair re-add failed`, { hash: infoHash, err: err?.message });
        }
        return false;
    }
    // -------------------------------------------------------------------------
    // Download Operations
    // -------------------------------------------------------------------------
    /**
     * Fetches the list of web downloads from TorBox.
     *
     * Uses the direct REST API (not the SDK) as this endpoint isn't
     * covered by the `node-torbox-api` package.
     * Returns cached data when rate-limited or on error.
     *
     * @returns An array of normalised download info objects.
     */
    async listWebDownloads() {
        if (!config_1.config.torboxApiKey)
            return [];
        if (apiDisabled)
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(WEB_DOWNLOADS_CACHE_KEY);
            if (cached) {
                console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached web downloads (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseDownloads(cached, 'web');
            }
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, no web downloads cache (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/v1/api/webdl/mylist`;
        try {
            const res = await axios_1.default.get(url, { headers: torboxHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            // TorBox wraps the list in a nested `data.data` structure
            const list = Array.isArray(res?.data?.data) ? res.data.data : [];
            rateLimiter_1.rateLimiter.setCache(WEB_DOWNLOADS_CACHE_KEY, list);
            return this.normaliseDownloads(list, 'web');
        }
        catch (err) {
            if (checkPlanError(err))
                return [];
            this.handleError(err, 'list web downloads');
            const cached = rateLimiter_1.rateLimiter.getCache(WEB_DOWNLOADS_CACHE_KEY);
            if (cached)
                return this.normaliseDownloads(cached, 'web');
            return [];
        }
    }
    /**
     * Fetches the list of Usenet downloads from TorBox.
     *
     * Uses the direct REST API (not the SDK) as this endpoint isn't
     * covered by the `node-torbox-api` package.
     * Returns cached data when rate-limited or on error.
     *
     * @returns An array of normalised download info objects.
     */
    async listUsenetDownloads() {
        if (!config_1.config.torboxApiKey)
            return [];
        if (apiDisabled)
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(USENET_DOWNLOADS_CACHE_KEY);
            if (cached) {
                console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached usenet downloads (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseDownloads(cached, 'usenet');
            }
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, no usenet downloads cache (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/v1/api/usenet/mylist`;
        try {
            const res = await axios_1.default.get(url, { headers: torboxHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            // TorBox wraps the list in a nested `data.data` structure
            const list = Array.isArray(res?.data?.data) ? res.data.data : [];
            rateLimiter_1.rateLimiter.setCache(USENET_DOWNLOADS_CACHE_KEY, list);
            return this.normaliseDownloads(list, 'usenet');
        }
        catch (err) {
            if (checkPlanError(err))
                return [];
            this.handleError(err, 'list usenet downloads');
            const cached = rateLimiter_1.rateLimiter.getCache(USENET_DOWNLOADS_CACHE_KEY);
            if (cached)
                return this.normaliseDownloads(cached, 'usenet');
            return [];
        }
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete torrent list from TorBox and converts it into
     * virtual directories. Only includes torrents where `download_finished === true`.
     *
     * TorBox embeds file details directly in the torrent listing, so no
     * additional API call is needed for file info (unlike RealDebrid).
     *
     * @returns Array of virtual directories representing completed TorBox torrents.
     */
    rawTorrentsToDirs(torrents) {
        const completed = torrents.filter((t) => t.download_finished === true);
        return completed.map((t) => {
            const files = Array.isArray(t.files) ? t.files : [];
            return {
                id: String(t.id),
                name: sanitiseName(t.name || String(t.id)),
                originalName: t.name || String(t.id),
                files: files.map((f) => ({
                    id: String(f.id),
                    name: sanitiseName(f.short_name || f.name || `file_${f.id}`),
                    size: typeof f.size === 'number' ? f.size : 0,
                })),
            };
        });
    }
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (apiDisabled)
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached && cached.length > 0) {
                console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached directories (${cached.length} items, wait ${waitTime}s)`);
                return this.rawTorrentsToDirs(cached);
            }
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        try {
            const url = `${base}/v1/api/torrents/mylist`;
            const res = await axiosIPv4.get(url, {
                headers: { Authorization: `Bearer ${config_1.config.torboxApiKey}` },
                timeout: 30000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            // TorBox wraps data in { data: [...] }
            const rawList = Array.isArray(res?.data?.data) ? res.data.data : [];
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, rawList);
            const completed = rawList.filter((t) => t.download_finished === true);
            console.log(`[${new Date().toISOString()}][torbox] fetched ${completed.length} completed torrents out of ${rawList.length} total`);
            return this.rawTorrentsToDirs(rawList);
        }
        catch (err) {
            this.handleError(err, 'fetch directories');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached && cached.length > 0) {
                console.log(`[${new Date().toISOString()}][torbox] returning cached directories on error (${cached.length} items)`);
                return this.rawTorrentsToDirs(cached);
            }
            return [];
        }
    }
    /**
     * Resolves a download URL for a TorBox file using the `requestdl` endpoint.
     *
     * @param torrentId - The TorBox torrent ID.
     * @param fileId - The file ID within the torrent.
     * @param _linkIndex - Unused for TorBox (RD-specific parameter).
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, fileId, _linkIndex) {
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.torboxApiKey;
        const isRotated = downloadToken !== config_1.config.torboxApiKey;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME) && !isRotated) {
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, cannot resolve download URL for torrent ${torrentId}`);
            return null;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        try {
            const params = new URLSearchParams({
                token: downloadToken,
                torrent_id: torrentId,
                file_id: fileId,
                zip_link: 'false',
            });
            const url = `${base}/v1/api/torrents/requestdl?${params.toString()}`;
            const res = await axiosIPv4.get(url, { timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const downloadUrl = res?.data?.data;
            if (!downloadUrl || typeof downloadUrl !== 'string') {
                console.error(`[${new Date().toISOString()}][torbox] requestdl returned no URL for torrent ${torrentId}, file ${fileId}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for torrent ${torrentId}, file ${fileId}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.torboxApiKey) {
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
     * Checks whether native TorBox WebDAV credentials are configured.
     *
     * @returns `true` if all three WebDAV settings (URL, username, password) are set.
     */
    hasDirectWebDAV() {
        return !!(config_1.config.torboxWebdavUrl && config_1.config.torboxWebdavUsername && config_1.config.torboxWebdavPassword);
    }
    /**
     * Checks whether the TorBox API key is configured.
     *
     * @returns `true` if the API key is set.
     */
    hasApiKey() {
        return !!config_1.config.torboxApiKey;
    }
    /**
     * Returns the native TorBox WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.torboxWebdavUrl,
            username: config_1.config.torboxWebdavUsername,
            password: config_1.config.torboxWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for TorBox.
     *
     * @returns The configured bridge port (default: 9116).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortTB;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Normalises raw TorBox torrent API responses into the standard {@link TorrentInfo} shape.
     *
     * @param rawTorrents - Array of raw torrent objects from the TorBox API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTorrents) {
        return rawTorrents.map((t) => ({
            id: String(t.id || ''),
            name: t.name || '',
            filename: t.name,
            status: t.download_state || t.status || '',
            progress: typeof t.progress === 'number' ? t.progress : 0,
            bytes: typeof t.size === 'number' ? t.size : 0,
            files: Array.isArray(t.files)
                ? t.files.map((f) => ({
                    id: String(f.id || ''),
                    name: f.short_name || f.name || '',
                    path: f.name || '',
                    size: typeof f.size === 'number' ? f.size : 0,
                    selected: true, // TorBox selects all files by default
                }))
                : [],
            addedAt: t.created_at ? new Date(t.created_at) : undefined,
            raw: t,
        }));
    }
    /**
     * Normalises raw TorBox download API responses into the standard {@link DownloadInfo} shape.
     *
     * @param rawDownloads - Array of raw download objects from the TorBox API.
     * @param type - The download type ('web' or 'usenet').
     * @returns Array of normalised download info objects.
     */
    normaliseDownloads(rawDownloads, type) {
        return rawDownloads.map((d) => ({
            id: String(d.id || ''),
            name: d.name || '',
            url: d.download_url,
            size: typeof d.size === 'number' ? d.size : 0,
            status: d.download_state || d.status || '',
            progress: typeof d.progress === 'number' ? d.progress : 0,
            type,
            raw: d,
        }));
    }
    /**
     * Centralised error handling for API requests.
     * Logs the error, checks for plan limitations, and records rate limits
     * where applicable.
     *
     * @param err - The error object.
     * @param operation - A human-readable description of the failed operation.
     */
    handleError(err, operation, overrideToken) {
        const errorMsg = err?.message || String(err);
        const responseData = err?.response?.data;
        const responseStatus = err?.response?.status;
        const responseHeaders = err?.response?.headers;
        const isNetworkError = err?.code === 'ECONNREFUSED' ||
            err?.code === 'ENOTFOUND' ||
            err?.code === 'ETIMEDOUT' ||
            err?.code === 'ECONNRESET' ||
            errorMsg.includes('timeout') ||
            errorMsg.includes('network');
        checkPlanError(err);
        // Detect rate limiting — TorBox may return 429 or include rate limit info in body
        const isRateLimit = rateLimiter_1.rateLimiter.isRateLimitError(err) || responseStatus === 429;
        if (isRateLimit) {
            // If we used a rotated download token, do NOT globally rate-limit the provider
            const primaryToken = config_1.config.torboxApiKey;
            if (overrideToken && overrideToken !== primaryToken) {
                console.warn(`[${new Date().toISOString()}][torbox] Rotated download token hit 429/rate-limit. Bypassing global rate limit.`);
            }
            else {
                // Try to extract specific rate limit details from TorBox's response
                // TorBox often returns messages like "Rate limit: 60 per hour" or similar
                let retryAfterS;
                const bodyStr = typeof responseData === 'string'
                    ? responseData
                    : typeof responseData?.detail === 'string'
                        ? responseData.detail
                        : typeof responseData?.error === 'string'
                            ? responseData.error
                            : JSON.stringify(responseData || '');
                // Parse "X per hour/minute/second" patterns from TorBox responses
                const perTimeMatch = bodyStr.match(/(\d+)\s*per\s*(hour|minute|second)/i);
                if (perTimeMatch) {
                    const limit = parseInt(perTimeMatch[1], 10);
                    const unit = perTimeMatch[2].toLowerCase();
                    let windowSeconds = 3600; // default hour
                    if (unit === 'minute')
                        windowSeconds = 60;
                    else if (unit === 'second')
                        windowSeconds = 1;
                    // Calculate optimal retry delay: window / limit with 20% safety margin
                    retryAfterS = Math.ceil((windowSeconds / limit) * 1.2);
                    console.warn(`[${new Date().toISOString()}][torbox] Detected rate limit: ${limit} per ${unit} ` +
                        `→ calculated retry delay: ${retryAfterS}s`);
                    // Update the global throttle delay to match learned limit
                    const newDelayMs = Math.ceil((windowSeconds / limit) * 1000 * 1.2);
                    rateLimiter_1.rateLimiter.setThrottleDelay(PROVIDER_NAME, newDelayMs);
                    console.log(`[${new Date().toISOString()}][torbox] Updated throttle delay to ${newDelayMs}ms ` +
                        `(${limit} req/${unit})`);
                }
                // Also check Retry-After header (standard HTTP)
                if (!retryAfterS && responseHeaders) {
                    const retryHeader = responseHeaders['retry-after'] || responseHeaders['Retry-After'];
                    if (retryHeader) {
                        const parsed = rateLimitStore_1.rateLimitStore.parseRetryAfter(String(retryHeader));
                        if (parsed)
                            retryAfterS = parsed;
                    }
                }
                rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg, retryAfterS ? retryAfterS * 1000 : undefined);
                // Feed into the learning store for long-term adaptation
                rateLimitStore_1.rateLimitStore.recordRateLimit(PROVIDER_NAME, operation, retryAfterS);
            }
        }
        console.error(`[${new Date().toISOString()}][torbox] ${operation} failed`, {
            error: errorMsg,
            code: err?.code,
            status: responseStatus,
            statusText: err?.response?.statusText,
            isNetworkError,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
            responseDetail: typeof responseData === 'object' ? responseData?.detail || responseData?.error : undefined,
        });
    }
}
exports.TorBoxProvider = TorBoxProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
const registry_1 = require("./registry");
registry_1.registry.register(new TorBoxProvider());
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.torboxApiKey, config_1.config.torboxDownloadTokens);
