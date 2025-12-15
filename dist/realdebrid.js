"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRDConfigured = isRDConfigured;
exports.isRDRateLimited = isRDRateLimited;
exports.getRDWaitTime = getRDWaitTime;
exports.listRDTorrents = listRDTorrents;
exports.addMagnetToRD = addMagnetToRD;
exports.selectAllFilesRD = selectAllFilesRD;
exports.isRDTorrentDead = isRDTorrentDead;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const rateLimiter_1 = require("./rateLimiter");
const PROVIDER_NAME = "realdebrid";
function isRDConfigured() {
    return !!config_1.config.rdAccessToken;
}
function isRDRateLimited() {
    return rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME);
}
function getRDWaitTime() {
    return rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}
function rdHeaders() {
    return { Authorization: `Bearer ${config_1.config.rdAccessToken}` };
}
async function listRDTorrents() {
    if (!isRDConfigured())
        return [];
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        console.warn(`[${new Date().toISOString()}][rd] rate limited, returning empty list (wait ${waitTime}s)`);
        return [];
    }
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents`;
    try {
        const res = await axios_1.default.get(url, { headers: rdHeaders(), timeout: 20000 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        const arr = Array.isArray(res?.data) ? res?.data : [];
        return arr;
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][rd] list torrents failed`, {
            error: errorMsg,
            status: err?.response?.status,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
        return [];
    }
}
async function addMagnetToRD(magnet) {
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        const error = new Error(`Real-Debrid rate limited, retry in ${waitTime}s`);
        console.warn(`[${new Date().toISOString()}][rd] rate limited, cannot add magnet (wait ${waitTime}s)`);
        throw error;
    }
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents/addMagnet`;
    const params = new URLSearchParams();
    params.set("magnet", magnet);
    try {
        const res = await axios_1.default.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
        return res.data || {};
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.error(`[${new Date().toISOString()}][rd] add magnet failed`, {
            error: errorMsg,
            status: err?.response?.status,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
        throw err;
    }
}
async function selectAllFilesRD(id) {
    if (!id)
        return;
    // Check rate limit before making request
    if (rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME)) {
        const waitTime = rateLimiter_1.rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
        console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping select files (wait ${waitTime}s)`);
        return;
    }
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
    const params = new URLSearchParams();
    params.set("files", "all");
    try {
        await axios_1.default.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
        rateLimiter_1.rateLimiter.recordSuccess(PROVIDER_NAME);
    }
    catch (err) {
        const errorMsg = err?.message || String(err);
        // Check if this is a rate limit error
        if (rateLimiter_1.rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
            rateLimiter_1.rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
        }
        console.warn(`[${new Date().toISOString()}][rd] select all files failed`, {
            id,
            error: errorMsg,
            status: err?.response?.status,
            rateLimited: rateLimiter_1.rateLimiter.isRateLimited(PROVIDER_NAME),
        });
    }
}
function isRDTorrentDead(t) {
    const s = String(t?.status || "").toLowerCase();
    if (typeof t?.progress === "number" && t.progress >= 100)
        return false;
    if (s.includes("error") || s.includes("dead"))
        return true;
    return false;
}
