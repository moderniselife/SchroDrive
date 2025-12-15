"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTorboxRateLimited = isTorboxRateLimited;
exports.getTorboxWaitTime = getTorboxWaitTime;
exports.checkExistingTorrents = checkExistingTorrents;
exports.addMagnetToTorbox = addMagnetToTorbox;
exports.listTorboxTorrents = listTorboxTorrents;
exports.isTorboxTorrentDead = isTorboxTorrentDead;
const node_torbox_api_1 = require("node-torbox-api");
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
function isTorboxRateLimited() {
    return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
}
function getTorboxWaitTime() {
    return rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}
async function checkExistingTorrents(searchTitle) {
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
async function listTorboxTorrents() {
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning empty list (wait ${waitTime}s)`);
        return [];
    }
    // Throttle to prevent hammering API
    await rateLimiter_1.rateLimiter.throttle(PROVIDER_NAME);
    const c = getClient();
    try {
        const res = await c.torrents.getTorrentList({ limit: 100 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
        return list;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err)) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][torbox] list torrents failed`, {
            error: errorMsg,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
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
