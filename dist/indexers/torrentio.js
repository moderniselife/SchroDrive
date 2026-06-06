"use strict";
/**
 * torrentio.ts — Torrentio Stremio addon scraper.
 *
 * Queries the Torrentio addon using the standard Stremio stream protocol
 * and returns normalised ScraperResult objects for downstream processing.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTorrentioConfigured = isTorrentioConfigured;
exports.searchTorrentio = searchTorrentio;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
const stremioScraper_1 = require("./stremioScraper");
const SOURCE = "torrentio";
const TIMEOUT_MS = 15000;
/**
 * Returns `true` when Torrentio scraping is both enabled and minimally
 * configured (a base URL must be present).
 */
function isTorrentioConfigured() {
    return config_1.config.torrentioEnabled && !!config_1.config.torrentioUrl;
}
/**
 * Search Torrentio for streams matching the given IMDB ID.
 *
 * @param imdbId   — IMDB title ID, e.g. "tt1234567"
 * @param type     — "movie" or "series"
 * @param season   — Season number (series only)
 * @param episode  — Episode number (series only)
 * @returns Array of normalised ScraperResult objects
 */
async function searchTorrentio(imdbId, type, season, episode) {
    if (!isTorrentioConfigured()) {
        console.warn(`[${new Date().toISOString()}][${SOURCE}] skipped — not configured or disabled`);
        return [];
    }
    const url = (0, stremioScraper_1.buildStremioUrl)(config_1.config.torrentioUrl, config_1.config.torrentioConfig, type, imdbId, season, episode);
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][${SOURCE}] GET ${url}`, {
        imdbId,
        type,
        season,
        episode,
        timeoutMs: TIMEOUT_MS,
    });
    try {
        const res = await axios_1.default.get(url, { timeout: TIMEOUT_MS });
        const streams = res.data?.streams ?? [];
        console.log(`[${new Date().toISOString()}][${SOURCE}] response`, {
            count: streams.length,
            ms: Date.now() - started,
            sample: streams.slice(0, 3).map((s) => ({
                name: s.name?.slice(0, 60),
                hasHash: !!s.infoHash,
            })),
        });
        return (0, stremioScraper_1.parseStremioStreams)(streams, SOURCE);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][${SOURCE}] request failed`, {
            url,
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            ms: Date.now() - started,
        });
        return [];
    }
}
