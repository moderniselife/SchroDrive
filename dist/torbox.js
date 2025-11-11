"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkExistingTorrents = checkExistingTorrents;
exports.addMagnetToTorbox = addMagnetToTorbox;
exports.listTorboxTorrents = listTorboxTorrents;
exports.isTorboxTorrentDead = isTorboxTorrentDead;
const node_torbox_api_1 = require("node-torbox-api");
const config_1 = require("./config");
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
async function checkExistingTorrents(searchTitle) {
    const c = getClient();
    console.log(`[${new Date().toISOString()}][torbox] checking existing torrents`, { searchTitle });
    const started = Date.now();
    try {
        // Get all torrents and filter them locally since the API doesn't support search
        const res = await c.torrents.getTorrentList({
            limit: 100 // Get more torrents to check against
        });
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
        console.error(`[${new Date().toISOString()}][torbox] existing torrents check failed`, {
            searchTitle,
            error: err?.message || String(err),
            status: err?.response?.status,
            statusText: err?.response?.statusText,
        });
        // If we can't check existing torrents, assume it doesn't exist to avoid missing content
        return false;
    }
}
async function addMagnetToTorbox(magnet, name) {
    const c = getClient();
    const teaser = magnet.slice(0, 80) + '...';
    console.log(`[${new Date().toISOString()}][torbox] createTorrent`, { name, teaser });
    const started = Date.now();
    const res = await c.torrents.createTorrent({ magnet, name }).catch((err) => {
        console.error(`[${new Date().toISOString()}][torbox] createTorrent failed`, {
            name,
            teaser,
            error: err?.message || String(err),
            status: err?.response?.status,
            statusText: err?.response?.statusText,
        });
        throw err;
    });
    console.log(`[${new Date().toISOString()}][torbox] createTorrent done`, { ms: Date.now() - started });
    return res;
}
async function listTorboxTorrents() {
    const c = getClient();
    try {
        const res = await c.torrents.getTorrentList({ limit: 100 });
        const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
        return list;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][torbox] list torrents failed`, {
            error: err?.message || String(err),
            status: err?.response?.status,
            statusText: err?.response?.statusText,
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
