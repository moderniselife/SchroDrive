"use strict";
/**
 * SchroDrive — RealDebrid Provider Implementation
 *
 * Implements the {@link DebridProvider} interface for the Real-Debrid
 * debrid service. Wraps the existing RD API client logic (torrent listing,
 * magnet addition, file selection, download listing) and adds WebDAV bridge
 * support methods (directory fetching, file info, URL resolution).
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * @module providers/realdebrid
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealDebridProvider = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const config_1 = require("../core/config");
const rateLimiter_1 = require("../core/rateLimiter");
const tokenRotator_1 = require("../core/tokenRotator");
// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================
const PROVIDER_NAME = 'realdebrid';
/** Force IPv4 to avoid IPv6 timeout issues in Docker containers. */
const httpAgent = new http_1.default.Agent({ family: 4 });
const httpsAgent = new https_1.default.Agent({ family: 4 });
const axiosIPv4 = axios_1.default.create({ httpAgent, httpsAgent });
// Cache keys for the shared rateLimiter cache
const TORRENT_LIST_CACHE_KEY = 'realdebrid_torrents';
const DOWNLOADS_CACHE_KEY = 'realdebrid_downloads';
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Builds the authorisation headers required for RealDebrid API requests.
 *
 * @returns A headers object containing the Bearer token.
 */
function rdHeaders(overrideToken) {
    return { Authorization: `Bearer ${overrideToken || config_1.config.rdAccessToken}` };
}
/**
 * Returns the RD API base URL, stripping any trailing slash.
 *
 * @returns The normalised base URL.
 */
function getBaseUrl() {
    return (config_1.config.rdApiBase || 'https://api.real-debrid.com/rest/1.0').replace(/\/$/, '');
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
// RealDebridProvider
// ===========================================================================
/**
 * Debrid provider implementation for RealDebrid.
 *
 * Wraps all RD-specific API interactions behind the standard
 * {@link DebridProvider} interface, including torrent and download
 * management, WebDAV bridge support, and mount configuration.
 */
class RealDebridProvider {
    constructor() {
        this.id = 'realdebrid';
        this.displayName = 'RealDebrid';
    }
    // -------------------------------------------------------------------------
    // Status
    // -------------------------------------------------------------------------
    /**
     * Checks whether RealDebrid is configured with a valid access token.
     *
     * @returns `true` if the RD access token is set in the configuration.
     */
    isConfigured() {
        return !!config_1.config.rdAccessToken;
    }
    /**
     * Checks whether RealDebrid API requests are currently rate-limited.
     *
     * @returns `true` if the provider is in a backoff period.
     */
    isRateLimited() {
        return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
    }
    /**
     * Returns the remaining wait time (in seconds) before RealDebrid requests
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
     * Fetches the complete list of torrents from RealDebrid, paginating
     * through all available results. Returns cached data when rate-limited
     * or on error.
     *
     * The RD API allows a maximum page size of 2,500 items. Each page request
     * is throttled to respect rate limits.
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
                console.warn(`[${new Date().toISOString()}][rd] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseTorrents(cached);
            }
            console.warn(`[${new Date().toISOString()}][rd] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const allTorrents = [];
        let page = 1;
        const limit = 2500; // Max allowed by RD API
        try {
            while (true) {
                const url = `${base}/torrents?limit=${limit}&page=${page}`;
                const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
                rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                const arr = Array.isArray(res?.data) ? res.data : [];
                allTorrents.push(...arr);
                if (arr.length < limit)
                    break;
                page++;
                await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            }
            rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, allTorrents);
            console.log(`[${new Date().toISOString()}][rd] fetched ${allTorrents.length} torrents (${page} page(s))`);
            return this.normaliseTorrents(allTorrents);
        }
        catch (err) {
            this.handleError(err, 'list torrents');
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][rd] returning cached list on error (${cached.length} items)`);
                return this.normaliseTorrents(cached);
            }
            return [];
        }
    }
    /**
     * Async generator that yields torrent pages as they are fetched from RealDebrid.
     * Uses smaller page sizes (100) for faster initial delivery in SSE streaming contexts.
     *
     * Falls back to cached data when rate-limited.
     *
     * @yields Arrays of normalised torrent info objects, one array per page.
     */
    async *listTorrentsStream() {
        if (!this.isConfigured())
            return;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
            if (cached) {
                yield this.normaliseTorrents(cached);
            }
            return;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        let page = 1;
        const limit = 100; // Smaller pages for faster streaming
        try {
            while (true) {
                const url = `${base}/torrents?limit=${limit}&page=${page}`;
                const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
                rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                const arr = Array.isArray(res?.data) ? res.data : [];
                if (arr.length > 0) {
                    yield this.normaliseTorrents(arr);
                }
                if (arr.length < limit)
                    break;
                page++;
                await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            }
        }
        catch (err) {
            this.handleError(err, 'list torrents stream');
        }
    }
    /**
     * Adds a magnet link to RealDebrid for downloading, then automatically
     * selects all files within the created torrent.
     *
     * Sends the magnet as a URL-encoded form POST to the RD API.
     * Throws if rate-limited or if the API request fails.
     *
     * @param magnet - The magnet URI to add.
     * @param _name - Unused (RD doesn't support naming magnets). Kept for interface compatibility.
     * @returns An object containing the torrent `id` and `uri` from the RD response.
     * @throws {Error} If the provider is rate-limited or the request fails.
     */
    async addMagnet(magnet, _name) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            throw new Error(`RealDebrid rate limited, retry in ${waitTime}s`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/torrents/addMagnet`;
        const params = new URLSearchParams();
        params.set('magnet', magnet);
        try {
            const res = await axiosIPv4.post(url, params, {
                headers: { ...rdHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const data = res.data || {};
            const id = String(data.id || '');
            // Automatically select all files after adding the magnet
            if (id) {
                await this.selectAllFiles(id);
            }
            return { id, uri: data.uri };
        }
        catch (err) {
            this.handleError(err, 'add magnet');
            throw err;
        }
    }
    /**
     * Selects all files within a RealDebrid torrent for download.
     *
     * Called internally after adding a magnet to ensure all files in the
     * torrent are queued for retrieval by the debrid service.
     *
     * @param id - The RealDebrid torrent ID to select files for.
     */
    async selectAllFiles(id) {
        if (!id)
            return;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping select files (wait ${waitTime}s)`);
            return;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
        const params = new URLSearchParams();
        params.set('files', 'all');
        try {
            await axiosIPv4.post(url, params, {
                headers: { ...rdHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        }
        catch (err) {
            this.handleError(err, `select all files for torrent ${id}`);
        }
    }
    /**
     * Checks whether a torrent with a matching title already exists in RealDebrid.
     *
     * Fetches the current torrent list and performs a case-insensitive
     * bi-directional substring match (search ⊂ torrent name or
     * torrent name ⊂ search) to catch partial matches.
     *
     * @param title - The title to search for among existing torrents.
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
            console.warn(`[${new Date().toISOString()}][rd] check existing failed`, { error: err?.message });
            return false;
        }
    }
    /**
     * Determines whether a RealDebrid torrent is considered "dead" (failed or errored).
     *
     * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
     * considered dead if its status contains "error" or "dead".
     *
     * @param torrent - The normalised torrent info object.
     * @returns `true` if the torrent is dead/failed.
     */
    isTorrentDead(torrent) {
        const s = String(torrent?.status || '').toLowerCase();
        // Completed torrents are never dead, regardless of status string
        if (typeof torrent?.progress === 'number' && torrent.progress >= 100)
            return false;
        // RealDebrid dead/failed statuses:
        // - magnet_error: invalid or broken magnet link
        // - error: generic torrent error
        // - virus: file flagged as containing a virus
        // - dead: no seeders / torrent is fully dead
        // - compressing_error: RD-side compression failure
        const deadStatuses = ['magnet_error', 'error', 'virus', 'dead', 'compressing_error'];
        if (deadStatuses.includes(s))
            return true;
        // Fallback: catch any status containing 'error' or 'dead'
        if (s.includes('error') || s.includes('dead'))
            return true;
        return false;
    }
    /**
     * Deletes a torrent from RealDebrid by its ID.
     *
     * Uses the `DELETE /torrents/delete/{id}` endpoint. Rate-limit aware.
     *
     * @param torrentId - The RD torrent ID to delete.
     * @throws {Error} If the deletion fails.
     */
    async deleteTorrent(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            throw new Error(`RealDebrid rate limited, cannot delete torrent ${torrentId}`);
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/torrents/delete/${encodeURIComponent(torrentId)}`;
        try {
            await axiosIPv4.delete(url, { headers: rdHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            console.log(`[${new Date().toISOString()}][rd] deleted torrent ${torrentId}`);
        }
        catch (err) {
            this.handleError(err, `delete torrent ${torrentId}`);
            throw err;
        }
    }
    /**
     * Returns the info hash for a torrent, used for repair (re-adding).
     *
     * Fetches the torrent info from RealDebrid and returns the hash field.
     * The hash can be used to construct a magnet URI for re-adding.
     *
     * @param torrentId - The RD torrent ID.
     * @returns The info hash string, or null if not available.
     */
    async getInfoHash(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME))
            return null;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const url = `${base}/torrents/info/${encodeURIComponent(torrentId)}`;
        try {
            const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 20000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const hash = res.data?.hash;
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
     * This is SchröDrive's equivalent of Zurg's `enable_repair`. When a
     * torrent shows as dead/errored, the provider link may have simply
     * expired. Re-adding the same magnet often restores access instantly
     * because the debrid service still has the content cached.
     *
     * Flow:
     * 1. Fetch the info hash from the dead torrent
     * 2. Delete the broken torrent
     * 3. Re-add the same magnet to this provider
     * 4. If successful → repaired; if failed → needs replacement
     *
     * This goes beyond Zurg by supporting multi-provider repair: if repair
     * fails on this provider, the dead scanner can try other providers.
     *
     * @param torrentId - The RD torrent ID to repair.
     * @returns `true` if repair succeeded, `false` if the torrent should be replaced.
     */
    async repairTorrent(torrentId) {
        console.log(`[${new Date().toISOString()}][rd] attempting repair for torrent ${torrentId}`);
        // Step 1: Get the info hash before we delete
        const infoHash = await this.getInfoHash(torrentId);
        if (!infoHash) {
            console.warn(`[${new Date().toISOString()}][rd] repair failed — could not get info hash for ${torrentId}`);
            return false;
        }
        // Step 2: Delete the broken torrent
        try {
            await this.deleteTorrent(torrentId);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][rd] repair delete failed for ${torrentId}`, { err: err?.message });
            // If we can't delete, we can't repair
            return false;
        }
        // Step 3: Re-add the same magnet
        const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
        try {
            const result = await this.addMagnet(magnet);
            if (result.id) {
                console.log(`[${new Date().toISOString()}][rd] repair successful — re-added as ${result.id}`, { hash: infoHash });
                return true;
            }
        }
        catch (err) {
            const status = err?.response?.status || err?.status;
            if (status === 451) {
                console.warn(`[${new Date().toISOString()}][rd] ⚖️ repair blocked — 451 Unavailable For Legal Reasons`, { hash: infoHash });
                // Don't blacklist here — the dead scanner will handle it in Phase C
            }
            else {
                console.warn(`[${new Date().toISOString()}][rd] repair re-add failed`, { hash: infoHash, err: err?.message });
            }
        }
        return false;
    }
    /**
     * Fetches the complete list of downloads from RealDebrid, paginating
     * through all available results. Returns cached data when rate-limited
     * or on error.
     *
     * Downloads represent completed/unrestricted files available for direct
     * download from the RD CDN.
     *
     * @returns An array of normalised download info objects.
     */
    async listDownloads() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
            const cached = rateLimiter_1.rateLimiter.getCache(DOWNLOADS_CACHE_KEY);
            if (cached) {
                console.warn(`[${new Date().toISOString()}][rd] rate limited, returning cached downloads (${cached.length} items, wait ${waitTime}s)`);
                return this.normaliseDownloads(cached);
            }
            console.warn(`[${new Date().toISOString()}][rd] rate limited, no cache available (wait ${waitTime}s)`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const allDownloads = [];
        let page = 1;
        const limit = 2500;
        try {
            while (true) {
                const url = `${base}/downloads?limit=${limit}&page=${page}`;
                const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
                rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                const arr = Array.isArray(res?.data) ? res.data : [];
                allDownloads.push(...arr);
                if (arr.length < limit)
                    break;
                page++;
                await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            }
            rateLimiter_1.rateLimiter.setCache(DOWNLOADS_CACHE_KEY, allDownloads);
            console.log(`[${new Date().toISOString()}][rd] fetched ${allDownloads.length} downloads (${page} page(s))`);
            return this.normaliseDownloads(allDownloads);
        }
        catch (err) {
            this.handleError(err, 'list downloads');
            const cached = rateLimiter_1.rateLimiter.getCache(DOWNLOADS_CACHE_KEY);
            if (cached) {
                console.log(`[${new Date().toISOString()}][rd] returning cached downloads on error (${cached.length} items)`);
                return this.normaliseDownloads(cached);
            }
            return [];
        }
    }
    /**
     * Async generator that yields download pages as they are fetched from RealDebrid.
     * Uses smaller page sizes (100) for faster initial delivery in SSE streaming contexts.
     *
     * Falls back to cached data when rate-limited.
     *
     * @yields Arrays of normalised download info objects, one array per page.
     */
    async *listDownloadsStream() {
        if (!this.isConfigured())
            return;
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            const cached = rateLimiter_1.rateLimiter.getCache(DOWNLOADS_CACHE_KEY);
            if (cached) {
                yield this.normaliseDownloads(cached);
            }
            return;
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        let page = 1;
        const limit = 100;
        try {
            while (true) {
                const url = `${base}/downloads?limit=${limit}&page=${page}`;
                const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
                rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                const arr = Array.isArray(res?.data) ? res.data : [];
                if (arr.length > 0) {
                    yield this.normaliseDownloads(arr);
                }
                if (arr.length < limit)
                    break;
                page++;
                await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            }
        }
        catch (err) {
            this.handleError(err, 'list downloads stream');
        }
    }
    // -------------------------------------------------------------------------
    // WebDAV Bridge Support
    // -------------------------------------------------------------------------
    /**
     * Fetches the complete torrent list from RealDebrid and converts it
     * into virtual directories. Only includes fully downloaded torrents
     * (progress ≥ 100).
     *
     * @returns Array of virtual directories representing completed RD torrents.
     */
    async fetchDirectories() {
        if (!this.isConfigured())
            return [];
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping directory fetch`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        const allTorrents = [];
        let page = 1;
        const limit = 2500;
        try {
            while (true) {
                const url = `${base}/torrents?limit=${limit}&page=${page}`;
                const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
                rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
                const arr = Array.isArray(res?.data) ? res.data : [];
                allTorrents.push(...arr);
                if (arr.length < limit)
                    break;
                page++;
                await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            }
            // Only include fully downloaded torrents
            const completed = allTorrents.filter((t) => {
                const progress = typeof t.progress === 'number' ? t.progress : 0;
                return progress >= 100;
            });
            console.log(`[${new Date().toISOString()}][rd] fetched ${completed.length} completed torrents out of ${allTorrents.length} total`);
            return completed.map((t) => ({
                id: String(t.id),
                name: sanitiseName(t.filename || t.id),
                originalName: t.filename || t.id,
                files: [], // Files are fetched lazily via fetchTorrentFiles()
            }));
        }
        catch (err) {
            this.handleError(err, 'fetch directories');
            return [];
        }
    }
    /**
     * Fetches detailed file information for a single RealDebrid torrent.
     *
     * Uses the `/torrents/info/{id}` endpoint which returns file paths, sizes,
     * and selection state. The `links[]` array maps 1:1 to selected files.
     *
     * @param torrentId - The RD torrent ID.
     * @returns Array of virtual files within the torrent.
     */
    async fetchTorrentFiles(torrentId) {
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping file fetch for torrent ${torrentId}`);
            return [];
        }
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        try {
            const url = `${base}/torrents/info/${encodeURIComponent(torrentId)}`;
            const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const files = Array.isArray(res?.data?.files) ? res.data.files : [];
            // Build the virtual file list from selected files
            // The links[] array maps 1:1 to selected files (files with selected === 1)
            const selectedFiles = files.filter((f) => f.selected === 1);
            let linkIdx = 0;
            return selectedFiles.map((f) => {
                const pathParts = String(f.path || '').split('/').filter(Boolean);
                const fileName = pathParts[pathParts.length - 1] || `file_${f.id}`;
                const vf = {
                    id: String(f.id),
                    name: sanitiseName(fileName),
                    size: typeof f.bytes === 'number' ? f.bytes : 0,
                    linkIndex: linkIdx,
                };
                linkIdx++;
                return vf;
            });
        }
        catch (err) {
            this.handleError(err, `fetch files for torrent ${torrentId}`);
            return [];
        }
    }
    /**
     * Resolves a download URL for a RealDebrid file by unrestricting the
     * corresponding link from the torrent's `links[]` array.
     *
     * @param torrentId - The RD torrent ID.
     * @param _fileId - Unused for RD (we use linkIndex instead).
     * @param linkIndex - The index into the torrent's `links[]` array.
     * @returns The direct download URL, or `null` on failure.
     */
    async resolveDownloadUrl(torrentId, _fileId, linkIndex) {
        if (linkIndex === undefined || linkIndex === null) {
            console.error(`[${new Date().toISOString()}][rd] resolveDownloadUrl requires linkIndex for RealDebrid`);
            return null;
        }
        if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
            console.warn(`[${new Date().toISOString()}][rd] rate limited, cannot resolve download URL for torrent ${torrentId}`);
            return null;
        }
        const downloadToken = tokenRotator_1.tokenRotator.getDownloadToken(PROVIDER_NAME) || config_1.config.rdAccessToken;
        await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
        const base = getBaseUrl();
        try {
            // First, get the torrent info to retrieve the link
            const infoUrl = `${base}/torrents/info/${encodeURIComponent(torrentId)}`;
            const infoRes = await axiosIPv4.get(infoUrl, { headers: rdHeaders(downloadToken), timeout: 30000 });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const links = Array.isArray(infoRes?.data?.links) ? infoRes.data.links : [];
            if (linkIndex < 0 || linkIndex >= links.length) {
                console.error(`[${new Date().toISOString()}][rd] link index ${linkIndex} out of range (${links.length} links) for torrent ${torrentId}`);
                return null;
            }
            const link = links[linkIndex];
            // Unrestrict the link to get the direct download URL
            await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
            const unrestrictUrl = `${base}/unrestrict/link`;
            const params = new URLSearchParams();
            params.set('link', link);
            const unrestrictRes = await axiosIPv4.post(unrestrictUrl, params, {
                headers: { ...rdHeaders(downloadToken), 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 20000,
            });
            rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
            const downloadUrl = unrestrictRes?.data?.download;
            if (!downloadUrl) {
                console.error(`[${new Date().toISOString()}][rd] unrestrict returned no download URL for torrent ${torrentId}, link ${linkIndex}`);
                return null;
            }
            return downloadUrl;
        }
        catch (err) {
            this.handleError(err, `resolve download URL for torrent ${torrentId}, link ${linkIndex}`, downloadToken);
            const status = err?.response?.status;
            if ((status === 503 || status === 429) && downloadToken !== config_1.config.rdAccessToken) {
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
     * Checks whether native RealDebrid WebDAV credentials are configured.
     *
     * @returns `true` if all three WebDAV settings (URL, username, password) are set.
     */
    hasDirectWebDAV() {
        return !!(config_1.config.rdWebdavUrl && config_1.config.rdWebdavUsername && config_1.config.rdWebdavPassword);
    }
    /**
     * Checks whether the RealDebrid API access token is configured.
     *
     * @returns `true` if the access token is set.
     */
    hasApiKey() {
        return !!config_1.config.rdAccessToken;
    }
    /**
     * Returns the native RealDebrid WebDAV connection details.
     *
     * @returns WebDAV config object, or `null` if not fully configured.
     */
    getWebDAVConfig() {
        if (!this.hasDirectWebDAV())
            return null;
        return {
            url: config_1.config.rdWebdavUrl,
            username: config_1.config.rdWebdavUsername,
            password: config_1.config.rdWebdavPassword,
        };
    }
    /**
     * Returns the local port the WebDAV bridge listens on for RealDebrid.
     *
     * @returns The configured bridge port (default: 9115).
     */
    getBridgePort() {
        return config_1.config.webdavBridgePortRD;
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Normalises raw RD torrent API responses into the standard {@link TorrentInfo} shape.
     *
     * @param rawTorrents - Array of raw torrent objects from the RD API.
     * @returns Array of normalised torrent info objects.
     */
    normaliseTorrents(rawTorrents) {
        return rawTorrents.map((t) => ({
            id: String(t.id || ''),
            name: t.filename || t.id || '',
            filename: t.filename,
            status: t.status || '',
            progress: typeof t.progress === 'number' ? t.progress : 0,
            bytes: typeof t.bytes === 'number' ? t.bytes : 0,
            files: Array.isArray(t.files)
                ? t.files.map((f) => ({
                    id: String(f.id || ''),
                    name: f.path?.split('/')?.pop() || '',
                    path: f.path || '',
                    size: typeof f.bytes === 'number' ? f.bytes : 0,
                    selected: f.selected === 1,
                }))
                : [],
            addedAt: t.added ? new Date(t.added) : undefined,
            raw: t,
        }));
    }
    /**
     * Normalises raw RD download API responses into the standard {@link DownloadInfo} shape.
     *
     * @param rawDownloads - Array of raw download objects from the RD API.
     * @returns Array of normalised download info objects.
     */
    normaliseDownloads(rawDownloads) {
        return rawDownloads.map((d) => ({
            id: String(d.id || ''),
            name: d.filename || '',
            url: d.download,
            size: typeof d.filesize === 'number' ? d.filesize : 0,
            status: 'downloaded',
            progress: 100,
            type: 'torrent',
            raw: d,
        }));
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
            const primaryToken = config_1.config.rdAccessToken;
            if (overrideToken && overrideToken !== primaryToken) {
                console.warn(`[${new Date().toISOString()}][rd] Rotated download token hit 429/rate-limit. Bypassing global rate limit.`);
            }
            else {
                // Try to extract Retry-After header from RD's response
                let backoffMs;
                if (responseHeaders) {
                    const retryAfter = responseHeaders['retry-after'] || responseHeaders['Retry-After'];
                    if (retryAfter) {
                        const seconds = parseInt(String(retryAfter), 10);
                        if (Number.isFinite(seconds) && seconds > 0) {
                            backoffMs = seconds * 1000;
                        }
                    }
                }
                rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg, backoffMs);
            }
        }
        console.error(`[${new Date().toISOString()}][rd] ${operation} failed`, {
            error: errorMsg,
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            isNetworkError,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
    }
}
exports.RealDebridProvider = RealDebridProvider;
// ===========================================================================
// Self-Registration
// ===========================================================================
const index_1 = require("./index");
index_1.registry.register(new RealDebridProvider());
tokenRotator_1.tokenRotator.registerProvider(PROVIDER_NAME, config_1.config.rdAccessToken, config_1.config.rdDownloadTokens);
