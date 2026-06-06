"use strict";
/**
 * SchröDrive — Unified Indexer + Scraper Layer
 *
 * Provides a single entry point for torrent searching across two systems:
 * 1. **Indexers** (Prowlarr, Jackett) — text-based torrent search
 * 2. **Scrapers** (Torrentio, Comet, Zilean, Mediafusion) — Stremio addon searches
 *
 * The `SCRAPER_MODE` config controls how scrapers integrate:
 * - `merge`: Combine indexer + scraper results, deduplicate by infoHash
 * - `fallback`: Only use scrapers when indexer returns 0 results
 *
 * @module indexers
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectActiveProvider = detectActiveProvider;
exports.getActiveProvider = getActiveProvider;
exports.clearProviderCache = clearProviderCache;
exports.testIndexerConnection = testIndexerConnection;
exports.searchIndexer = searchIndexer;
exports.isAnyScraperConfigured = isAnyScraperConfigured;
exports.searchScrapers = searchScrapers;
exports.searchAll = searchAll;
exports.pickBestResult = pickBestResult;
exports.getMagnet = getMagnet;
exports.getMagnetOrResolve = getMagnetOrResolve;
exports.getProviderName = getProviderName;
exports.isIndexerConfigured = isIndexerConfigured;
exports.isAnySearchConfigured = isAnySearchConfigured;
const config_1 = require("../core/config");
const prowlarr_1 = require("./prowlarr");
const jackett_1 = require("./jackett");
const torrentio_1 = require("./torrentio");
const comet_1 = require("./comet");
const zilean_1 = require("./zilean");
const mediafusion_1 = require("./mediafusion");
let cachedProvider = null;
function isJackettConfigured() {
    return !!(config_1.config.jackettUrl && config_1.config.jackettApiKey);
}
function isProwlarrConfigured() {
    return !!(config_1.config.prowlarrUrl && config_1.config.prowlarrApiKey);
}
async function detectActiveProvider() {
    if (cachedProvider)
        return cachedProvider;
    const provider = config_1.config.indexerProvider;
    if (provider === "jackett") {
        if (isJackettConfigured()) {
            cachedProvider = "jackett";
            return "jackett";
        }
        console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=jackett but Jackett not configured`);
        return null;
    }
    if (provider === "prowlarr") {
        if (isProwlarrConfigured()) {
            cachedProvider = "prowlarr";
            return "prowlarr";
        }
        console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=prowlarr but Prowlarr not configured`);
        return null;
    }
    // Auto mode: try Jackett first (if configured), then Prowlarr
    if (isJackettConfigured()) {
        console.log(`[${new Date().toISOString()}][indexer] auto-detected Jackett as indexer provider`);
        cachedProvider = "jackett";
        return "jackett";
    }
    if (isProwlarrConfigured()) {
        console.log(`[${new Date().toISOString()}][indexer] auto-detected Prowlarr as indexer provider`);
        cachedProvider = "prowlarr";
        return "prowlarr";
    }
    console.warn(`[${new Date().toISOString()}][indexer] no indexer provider configured`);
    return null;
}
function getActiveProvider() {
    if (cachedProvider)
        return cachedProvider;
    const provider = config_1.config.indexerProvider;
    if (provider === "jackett" && isJackettConfigured()) {
        cachedProvider = "jackett";
        return "jackett";
    }
    if (provider === "prowlarr" && isProwlarrConfigured()) {
        cachedProvider = "prowlarr";
        return "prowlarr";
    }
    // Auto mode
    if (provider === "auto") {
        if (isJackettConfigured()) {
            cachedProvider = "jackett";
            return "jackett";
        }
        if (isProwlarrConfigured()) {
            cachedProvider = "prowlarr";
            return "prowlarr";
        }
    }
    return null;
}
function clearProviderCache() {
    cachedProvider = null;
}
async function testIndexerConnection() {
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.testJackettConnection)();
    }
    if (provider === "prowlarr") {
        return (0, prowlarr_1.testProwlarrConnection)();
    }
    console.warn(`[${new Date().toISOString()}][indexer] no provider configured for connection test`);
    return false;
}
// =============================================================================
// Indexer Search (Prowlarr / Jackett)
// =============================================================================
async function searchIndexer(query, opts) {
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.searchJackett)(query, opts);
    }
    if (provider === "prowlarr") {
        return (0, prowlarr_1.searchProwlarr)(query, opts);
    }
    throw new Error("No indexer provider configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
}
// =============================================================================
// Scraper Search (Torrentio, Comet, Zilean, Mediafusion)
// =============================================================================
/**
 * Returns true if at least one scraper is configured and enabled.
 */
function isAnyScraperConfigured() {
    return (0, torrentio_1.isTorrentioConfigured)() || (0, comet_1.isCometConfigured)() || (0, zilean_1.isZileanConfigured)() || (0, mediafusion_1.isMediafusionConfigured)();
}
/**
 * Searches all configured and enabled scrapers in parallel.
 *
 * Stremio addon scrapers (Torrentio, Comet, Mediafusion) require an IMDB ID.
 * Zilean uses text search and does not require an IMDB ID.
 *
 * @param query - Text query (used by Zilean)
 * @param opts - Search options including IMDB ID for Stremio addon searches
 * @returns Merged, deduplicated scraper results
 */
async function searchScrapers(query, opts) {
    const promises = [];
    const imdbId = opts?.imdbId;
    const mediaType = opts?.mediaType || "movie";
    const season = opts?.season;
    const episode = opts?.episode;
    // Stremio addon scrapers require an IMDB ID
    if (imdbId) {
        if ((0, torrentio_1.isTorrentioConfigured)()) {
            promises.push((0, torrentio_1.searchTorrentio)(imdbId, mediaType, season, episode).catch(err => {
                console.warn(`[${new Date().toISOString()}][scrapers] Torrentio failed:`, err?.message);
                return [];
            }));
        }
        if ((0, comet_1.isCometConfigured)()) {
            promises.push((0, comet_1.searchComet)(imdbId, mediaType, season, episode).catch(err => {
                console.warn(`[${new Date().toISOString()}][scrapers] Comet failed:`, err?.message);
                return [];
            }));
        }
        if ((0, mediafusion_1.isMediafusionConfigured)()) {
            promises.push((0, mediafusion_1.searchMediafusion)(imdbId, mediaType, season, episode).catch(err => {
                console.warn(`[${new Date().toISOString()}][scrapers] Mediafusion failed:`, err?.message);
                return [];
            }));
        }
    }
    // Zilean uses text search — no IMDB ID required
    if ((0, zilean_1.isZileanConfigured)()) {
        promises.push((0, zilean_1.searchZilean)(query).catch(err => {
            console.warn(`[${new Date().toISOString()}][scrapers] Zilean failed:`, err?.message);
            return [];
        }));
    }
    if (promises.length === 0)
        return [];
    const results = await Promise.all(promises);
    const merged = results.flat();
    // Deduplicate by infoHash
    const seen = new Set();
    const deduped = [];
    for (const r of merged) {
        const key = r.infoHash?.toLowerCase() || r.magnetUrl || r.title;
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(r);
        }
    }
    console.log(`[${new Date().toISOString()}][scrapers] total: ${merged.length}, deduped: ${deduped.length}`);
    return deduped;
}
// =============================================================================
// Unified Search (Indexer + Scrapers)
// =============================================================================
/**
 * Searches both indexers and scrapers according to the configured scraper mode.
 *
 * - `merge`: Runs indexer + scrapers in parallel, merges and deduplicates
 * - `fallback`: Runs indexer first; only runs scrapers if indexer returns 0
 *
 * @param query - Text search query
 * @param opts - Search options (categories, IMDB ID, etc.)
 * @returns Combined results from all sources
 */
async function searchAll(query, opts) {
    const hasIndexer = isIndexerConfigured();
    const hasScrapers = isAnyScraperConfigured();
    if (!hasIndexer && !hasScrapers) {
        throw new Error("No indexer or scraper configured. Set up Prowlarr/Jackett or enable a scraper.");
    }
    const mode = config_1.config.scraperMode;
    if (mode === "merge") {
        // Run indexer + scrapers in parallel
        const [indexerResults, scraperResults] = await Promise.all([
            hasIndexer ? searchIndexer(query, opts).catch(() => []) : Promise.resolve([]),
            hasScrapers ? searchScrapers(query, opts).catch(() => []) : Promise.resolve([]),
        ]);
        // Merge with indexer results taking priority (they have richer metadata)
        const merged = [...indexerResults];
        const indexerHashes = new Set(indexerResults
            .map((r) => (r.infoHash || r.infohash || r.hash || "").toLowerCase())
            .filter(Boolean));
        for (const sr of scraperResults) {
            const hash = sr.infoHash?.toLowerCase();
            if (!hash || !indexerHashes.has(hash)) {
                merged.push(sr);
            }
        }
        console.log(`[${new Date().toISOString()}][search] merge mode — indexer: ${indexerResults.length}, scrapers: ${scraperResults.length}, merged: ${merged.length}`);
        return merged;
    }
    // Fallback mode
    if (hasIndexer) {
        const indexerResults = await searchIndexer(query, opts);
        if (indexerResults.length > 0) {
            return indexerResults;
        }
        console.log(`[${new Date().toISOString()}][search] indexer returned 0, falling back to scrapers`);
    }
    if (hasScrapers) {
        return searchScrapers(query, opts);
    }
    return [];
}
// =============================================================================
// Helpers (backward-compatible exports)
// =============================================================================
function pickBestResult(results) {
    // Separate into indexer and scraper results
    const indexerResults = results.filter((r) => !('source' in r));
    const scraperResults = results.filter((r) => 'source' in r);
    const provider = getActiveProvider();
    // If we have indexer results, use the indexer's picker
    if (indexerResults.length > 0) {
        if (provider === "jackett") {
            return (0, jackett_1.pickBestResult)(indexerResults);
        }
        return (0, prowlarr_1.pickBestResult)(indexerResults);
    }
    // For scraper results, sort by seeders desc, then size desc
    if (scraperResults.length > 0) {
        const sorted = scraperResults
            .slice()
            .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || (b.size || 0) - (a.size || 0));
        return sorted[0];
    }
    return undefined;
}
function getMagnet(r) {
    if (!r)
        return undefined;
    // Scraper results have magnetUrl directly
    if ('source' in r) {
        return r.magnetUrl;
    }
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.getMagnet)(r);
    }
    return (0, prowlarr_1.getMagnet)(r);
}
async function getMagnetOrResolve(r) {
    if (!r)
        return undefined;
    // Scraper results already have resolved magnets
    if ('source' in r) {
        return r.magnetUrl;
    }
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.getMagnetOrResolve)(r);
    }
    return (0, prowlarr_1.getMagnetOrResolve)(r);
}
function getProviderName() {
    const provider = getActiveProvider();
    const scrapers = [];
    if ((0, torrentio_1.isTorrentioConfigured)())
        scrapers.push("torrentio");
    if ((0, comet_1.isCometConfigured)())
        scrapers.push("comet");
    if ((0, zilean_1.isZileanConfigured)())
        scrapers.push("zilean");
    if ((0, mediafusion_1.isMediafusionConfigured)())
        scrapers.push("mediafusion");
    const parts = [provider || "none"];
    if (scrapers.length > 0)
        parts.push(`+${scrapers.join(",")}`);
    return parts.join("");
}
function isIndexerConfigured() {
    return isJackettConfigured() || isProwlarrConfigured();
}
/**
 * Returns true if any search source is configured (indexer or scraper).
 */
function isAnySearchConfigured() {
    return isIndexerConfigured() || isAnyScraperConfigured();
}
