"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTorboxApiDisabled = isTorboxApiDisabled;
exports.getTorboxApiDisabledReason = getTorboxApiDisabledReason;
exports.isTorboxRateLimited = isTorboxRateLimited;
exports.getTorboxWaitTime = getTorboxWaitTime;
exports.checkExistingTorrents = checkExistingTorrents;
exports.addMagnetToTorbox = addMagnetToTorbox;
exports.listTorboxTorrents = listTorboxTorrents;
exports.isTorboxTorrentDead = isTorboxTorrentDead;
exports.listTorboxWebDownloads = listTorboxWebDownloads;
exports.listTorboxUsenetDownloads = listTorboxUsenetDownloads;
const node_torbox_api_1 = require("node-torbox-api");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const rateLimiter_1 = require("./rateLimiter");
let client = null;
function getClient() {
    (0, config_1.requireEnv)("torboxApiKey");
    if (!client) {
        const maskedKey = config_1.config.torboxApiKey ? `${config_1.config.torboxApiKey.slice(0, 4)}…` : "unset";
        console.log(`[${new Date().toISOString()}][torbox] init client`, { baseURL: config_1.config.torboxBaseUrl, apiKey: maskedKey });
        client = new node_torbox_api_1.TorboxClient({ apiKey: config_1.config.torboxApiKey, baseURL: config_1.config.torboxBaseUrl });
    }
    return client;
}
const PROVIDER_NAME = "torbox";
// Track if API access is disabled due to plan limitations
let apiDisabled = false;
let apiDisabledReason = "";
function isTorboxApiDisabled() {
    return apiDisabled;
}
function getTorboxApiDisabledReason() {
    return apiDisabledReason;
}
function checkPlanError(err) {
    const msg = String(err?.message || err || "").toLowerCase();
    if (msg.includes("403") && (msg.includes("plan") || msg.includes("upgrade"))) {
        apiDisabled = true;
        apiDisabledReason = "TorBox API requires a paid plan. Please upgrade at torbox.app";
        console.error(`[${new Date().toISOString()}][torbox] API DISABLED: ${apiDisabledReason}`);
        return true;
    }
    return false;
}
function isTorboxRateLimited() {
    return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
}
function getTorboxWaitTime() {
    return rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}
async function checkExistingTorrents(searchTitle) {
    // Check if API is disabled due to plan limitations
    if (apiDisabled) {
        return false;
    }
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, skipping check (wait ${waitTime}s)`);
        return false; // Assume doesn't exist to avoid blocking
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const c = getClient();
    console.log(`[${new Date().toISOString()}][torbox] checking existing torrents`, { searchTitle });
    const started = Date.now();
    try {
        // Get all torrents and filter them locally since the API doesn't support search
        const res = await c.torrents.getTorrentList({
            limit: 100 // Get more torrents to check against
        });
        // Record success
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        // Handle both single torrent and array responses
        const existingTorrents = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
        console.log(`[${new Date().toISOString()}][torbox] existing torrents check`, {
            searchTitle,
            count: existingTorrents.length,
            ms: Date.now() - started
        });
        // Check if any existing torrent matches our search title
        // We'll do a case-insensitive contains check
        const normalizedSearch = searchTitle.toLowerCase();
        const hasExisting = existingTorrents.some((torrent) => {
            const torrentName = (torrent.name || '').toLowerCase();
            return torrentName.includes(normalizedSearch) || normalizedSearch.includes(torrentName);
        });
        if (hasExisting) {
            console.log(`[${new Date().toISOString()}][torbox] found existing torrent`, {
                searchTitle,
                existingNames: existingTorrents.slice(0, 3).map((t) => t.name)
            });
        }
        return hasExisting;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a plan limitation error
        if (checkPlanError(err)) {
            return false;
        }
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err)) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] existing torrents check failed`, {
            searchTitle,
            error: errorMsg,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
        });
        // If we can't check existing torrents, assume it doesn't exist to avoid missing content
        return false;
    }
}
async function addMagnetToTorbox(magnet, name) {
    // Check if API is disabled due to plan limitations
    if (apiDisabled) {
        throw new Error(apiDisabledReason);
    }
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        const error = new Error(`TorBox rate limited, retry in ${waitTime}s`);
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, cannot add magnet (wait ${waitTime}s)`);
        throw error;
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const c = getClient();
    const teaser = magnet.slice(0, 80) + '...';
    console.log(`[${new Date().toISOString()}][torbox] createTorrent`, { name, teaser });
    const started = Date.now();
    try {
        const res = await c.torrents.createTorrent({ magnet, name });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        console.log(`[${new Date().toISOString()}][torbox] createTorrent done`, { ms: Date.now() - started });
        return res;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a plan limitation error
        checkPlanError(err);
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err)) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] createTorrent failed`, {
            name,
            teaser,
            error: errorMsg,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
        throw err;
    }
}
const TORRENT_LIST_CACHE_KEY = "torbox_torrents";
async function listTorboxTorrents() {
    // Check if API is disabled due to plan limitations
    if (apiDisabled) {
        return [];
    }
    // Check rate limit before making request - return cached data if available
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
            return cached;
        }
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, no cache available (wait ${waitTime}s)`);
        return [];
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const c = getClient();
    try {
        const res = await c.torrents.getTorrentList({ limit: 100 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
        // Cache the successful result
        rateLimiter_1.rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, list);
        return list;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        const isNetworkError = err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' ||
            err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
            errorMsg.includes('timeout') || errorMsg.includes('network');
        // Check if this is a plan limitation error
        if (checkPlanError(err)) {
            return [];
        }
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] list torrents failed`, {
            error: errorMsg,
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            isNetworkError,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
        // Return cached data on error if available
        const cached = rateLimiter_1.rateLimiter.getCache(TORRENT_LIST_CACHE_KEY);
        if (cached) {
            console.log(`[${new Date().toISOString()}][torbox] returning cached list on error (${cached.length} items)`);
            return cached;
        }
        return [];
    }
}
function isTorboxTorrentDead(t) {
    const status = String(t?.status || t?.state || "").toLowerCase();
    if (typeof t?.progress === "number" && t.progress >= 100)
        return false;
    if (status.includes("failed"))
        return true;
    if (status.includes("stalled"))
        return true;
    if (status.includes("inactive"))
        return true;
    return false;
}
function torboxHeaders() {
    return { Authorization: `Bearer ${config_1.config.torboxApiKey}` };
}
const WEB_DOWNLOADS_CACHE_KEY = "torbox_webdownloads";
const USENET_DOWNLOADS_CACHE_KEY = "torbox_usenetdownloads";
async function listTorboxWebDownloads() {
    if (!config_1.config.torboxApiKey)
        return [];
    // Check if API is disabled due to plan limitations
    if (apiDisabled) {
        return [];
    }
    // Check rate limit before making request - return cached data if available
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        const cached = rateLimiter_1.rateLimiter.getCache(WEB_DOWNLOADS_CACHE_KEY);
        if (cached) {
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached web downloads (${cached.length} items, wait ${waitTime}s)`);
            return cached;
        }
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, no web downloads cache (wait ${waitTime}s)`);
        return [];
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const base = (config_1.config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");
    const url = `${base}/v1/api/webdl/mylist`;
    try {
        const res = await axios_1.default.get(url, { headers: torboxHeaders(), timeout: 20000 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const list = Array.isArray(res?.data?.data) ? res.data.data : [];
        rateLimiter_1.rateLimiter.setCache(WEB_DOWNLOADS_CACHE_KEY, list);
        return list;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a plan limitation error
        if (checkPlanError(err)) {
            return [];
        }
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] list web downloads failed`, {
            error: errorMsg,
            status: err?.response?.status,
        });
        const cached = rateLimiter_1.rateLimiter.getCache(WEB_DOWNLOADS_CACHE_KEY);
        if (cached)
            return cached;
        return [];
    }
}
async function listTorboxUsenetDownloads() {
    if (!config_1.config.torboxApiKey)
        return [];
    // Check if API is disabled due to plan limitations
    if (apiDisabled) {
        return [];
    }
    // Check rate limit before making request - return cached data if available
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        const cached = rateLimiter_1.rateLimiter.getCache(USENET_DOWNLOADS_CACHE_KEY);
        if (cached) {
            console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached usenet downloads (${cached.length} items, wait ${waitTime}s)`);
            return cached;
        }
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, no usenet downloads cache (wait ${waitTime}s)`);
        return [];
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const base = (config_1.config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");
    const url = `${base}/v1/api/usenet/mylist`;
    try {
        const res = await axios_1.default.get(url, { headers: torboxHeaders(), timeout: 20000 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const list = Array.isArray(res?.data?.data) ? res.data.data : [];
        rateLimiter_1.rateLimiter.setCache(USENET_DOWNLOADS_CACHE_KEY, list);
        return list;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a plan limitation error
        if (checkPlanError(err)) {
            return [];
        }
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] list usenet downloads failed`, {
            error: errorMsg,
            status: err?.response?.status,
        });
        const cached = rateLimiter_1.rateLimiter.getCache(USENET_DOWNLOADS_CACHE_KEY);
        if (cached)
            return cached;
        return [];
    }
}
