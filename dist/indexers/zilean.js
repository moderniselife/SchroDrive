"use strict";
/**
 * zilean.ts — Zilean DMM hashlist scraper.
 *
 * Zilean is NOT a Stremio addon — it exposes its own REST API for querying
 * debrid media manager hashlists. This module queries the /dmm/filtered
 * endpoint and normalises results into ScraperResult objects.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isZileanConfigured = isZileanConfigured;
exports.searchZilean = searchZilean;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
const SOURCE = "zilean";
const TIMEOUT_MS = 15000;
/**
 * Returns `true` when Zilean scraping is both enabled and minimally
 * configured (a base URL must be present).
 */
function isZileanConfigured() {
    return config_1.config.zileanEnabled && !!config_1.config.zileanUrl;
}
/**
 * Build a magnet URI from a 40-hex or 32-base32 info hash.
 */
function buildMagnetFromHash(hash, title) {
    const trimmed = hash.trim();
    const hex40 = /^[a-fA-F0-9]{40}$/;
    const b32 = /^[A-Z2-7]{32,39}$/i;
    if (!hex40.test(trimmed) && !b32.test(trimmed))
        return undefined;
    const hashUpper = trimmed.toUpperCase();
    const dn = title ? `&dn=${encodeURIComponent(title)}` : "";
    return `magnet:?xt=urn:btih:${hashUpper}${dn}`;
}
/**
 * Search Zilean for torrents matching the given text query.
 *
 * @param query — Free-text search query (title, keywords, etc.)
 * @returns Array of normalised ScraperResult objects
 */
async function searchZilean(query) {
    if (!isZileanConfigured()) {
        console.warn(`[${new Date().toISOString()}][${SOURCE}] skipped — not configured or disabled`);
        return [];
    }
    const base = config_1.config.zileanUrl.replace(/\/+$/, "");
    const url = `${base}/dmm/filtered`;
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][${SOURCE}] GET ${url}`, {
        query,
        timeoutMs: TIMEOUT_MS,
    });
    try {
        const res = await axios_1.default.get(url, {
            params: { query },
            timeout: TIMEOUT_MS,
        });
        const entries = Array.isArray(res.data) ? res.data : [];
        console.log(`[${new Date().toISOString()}][${SOURCE}] response`, {
            count: entries.length,
            ms: Date.now() - started,
            sample: entries.slice(0, 3).map((e) => ({
                title: e.raw_title?.slice(0, 60),
                hasHash: !!e.info_hash,
                size: e.size,
            })),
        });
        const results = [];
        for (const entry of entries) {
            const title = entry.raw_title || "";
            const infoHash = (entry.info_hash || "").toLowerCase();
            const magnetUrl = buildMagnetFromHash(entry.info_hash || "", title);
            results.push({
                title,
                magnetUrl,
                infoHash: infoHash || undefined,
                size: entry.size,
                source: SOURCE,
            });
        }
        console.log(`[${new Date().toISOString()}][${SOURCE}] parsed ${results.length} results from ${entries.length} entries`);
        return results;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][${SOURCE}] request failed`, {
            url,
            query,
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            ms: Date.now() - started,
        });
        return [];
    }
}
