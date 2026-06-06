"use strict";
/**
 * SchroDrive — Unified Media Server Watchlist Poller
 *
 * Polls watchlists from all configured media servers (Plex, Jellyfin, Emby)
 * at a configurable interval. When new items are detected, they are searched
 * via the indexer (Prowlarr/Jackett) and the best torrent is added to the
 * configured debrid providers (RealDebrid/TorBox).
 *
 * After a successful torrent add, the relevant media server library is
 * refreshed to pick up the new content.
 *
 * @module mediaServerWatchlist
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWatchlistPoller = startWatchlistPoller;
const config_1 = require("../core/config");
const db_1 = require("../core/db");
const plex_1 = require("../integrations/plex");
const jellyfin_1 = require("../integrations/jellyfin");
const emby_1 = require("../integrations/emby");
const trakt_1 = require("../integrations/trakt");
const mdblist_1 = require("../integrations/mdblist");
const listrr_1 = require("../integrations/listrr");
const index_1 = require("../indexers/index");
const providers_1 = require("../providers");
// =============================================================================
// Normalisation
// =============================================================================
/**
 * Normalises watchlist items from all configured media servers into a
 * unified format for processing.
 */
async function fetchAllWatchlists() {
    const items = [];
    // Plex
    if (config_1.config.plexToken) {
        try {
            const plexItems = await (0, plex_1.getPlexWatchlist)();
            for (const item of plexItems) {
                items.push({
                    key: `plex:${item.ratingKey}`,
                    source: "plex",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: (0, plex_1.extractTmdbId)(item),
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Plex fetch error:`, err?.message || String(err));
        }
    }
    // Jellyfin
    if (config_1.config.jellyfinUrl && config_1.config.jellyfinApiKey) {
        try {
            const jfItems = await (0, jellyfin_1.getJellyfinWatchlist)();
            for (const item of jfItems) {
                items.push({
                    key: `jellyfin:${item.id}`,
                    source: "jellyfin",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: item.tmdbId,
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Jellyfin fetch error:`, err?.message || String(err));
        }
    }
    // Emby
    if (config_1.config.embyUrl && config_1.config.embyApiKey) {
        try {
            const embyItems = await (0, emby_1.getEmbyWatchlist)();
            for (const item of embyItems) {
                items.push({
                    key: `emby:${item.id}`,
                    source: "emby",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: item.tmdbId,
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Emby fetch error:`, err?.message || String(err));
        }
    }
    // Trakt
    if ((0, trakt_1.isTraktConfigured)()) {
        try {
            const traktItems = await (0, trakt_1.getTraktWatchlist)();
            for (const item of traktItems) {
                items.push({
                    key: `trakt:${item.id}`,
                    source: "trakt",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: item.tmdbId,
                    imdbId: item.imdbId,
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Trakt fetch error:`, err?.message || String(err));
        }
    }
    // Mdblist
    if ((0, mdblist_1.isMdblistConfigured)()) {
        try {
            const mdbItems = await (0, mdblist_1.getMdblistWatchlist)();
            for (const item of mdbItems) {
                items.push({
                    key: `mdblist:${item.id}`,
                    source: "mdblist",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: item.tmdbId,
                    imdbId: item.imdbId,
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Mdblist fetch error:`, err?.message || String(err));
        }
    }
    // Listrr
    if ((0, listrr_1.isListrrConfigured)()) {
        try {
            const listrrItems = await (0, listrr_1.getListrrWatchlist)();
            for (const item of listrrItems) {
                items.push({
                    key: `listrr:${item.tmdbId || item.id}`,
                    source: "listrr",
                    title: item.title,
                    year: item.year,
                    type: item.type,
                    tmdbId: item.tmdbId,
                });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Listrr fetch error:`, err?.message || String(err));
        }
    }
    return items;
}
// =============================================================================
// Poller
// =============================================================================
/** In-memory cache of processed keys, hydrated from SQLite at startup. */
let processed = new Set();
/** Whether the processed set has been hydrated from the database. */
let processedHydrated = false;
/**
 * Builds a search query string from a watchlist item.
 *
 * @param item - Normalised watchlist item
 * @returns Search query string or undefined if not enough info
 */
function buildSearchQuery(item) {
    let query = item.title;
    if (item.year)
        query += ` ${item.year}`;
    if (item.tmdbId)
        query += ` TMDB${item.tmdbId}`;
    return query || undefined;
}
/**
 * Determines the best torrent categories for the media type.
 */
function categoriesForType(type) {
    // Category 5000 covers both movies and TV on most indexers
    return ["5000"];
}
/**
 * Refreshes the library for the media server that sourced this item.
 */
async function refreshSourceLibrary(source) {
    switch (source) {
        case "plex":
            await (0, plex_1.refreshPlexLibrary)();
            break;
        case "jellyfin":
            await (0, jellyfin_1.refreshJellyfinLibrary)();
            break;
        case "emby":
            await (0, emby_1.refreshEmbyLibrary)();
            break;
        case "trakt":
        case "mdblist":
        case "listrr":
            // List services don't have libraries to refresh
            break;
    }
}
/**
 * Processes a single watchlist item — searches, adds to debrid, refreshes library.
 *
 * @param item - Normalised watchlist item to process
 * @returns true if the item was successfully processed (torrent added)
 */
async function processWatchlistItem(item) {
    const query = buildSearchQuery(item);
    if (!query) {
        console.warn(`[${new Date().toISOString()}][watchlist] Cannot build query for: ${item.key}`);
        return false;
    }
    const categories = categoriesForType(item.type);
    const indexerName = (0, index_1.getProviderName)();
    console.log(`[${new Date().toISOString()}][watchlist→${indexerName}] Searching: "${query}"`);
    const t0 = Date.now();
    const results = await (0, index_1.searchIndexer)(query, { categories });
    console.log(`[${new Date().toISOString()}][watchlist→${indexerName}] ${results.length} results (${Date.now() - t0}ms)`);
    const best = (0, index_1.pickBestResult)(results);
    if (!best) {
        console.warn(`[${new Date().toISOString()}][watchlist] No results for: "${query}"`);
        return false;
    }
    // Try to get a magnet URI — try best first, then scan other candidates
    let magnet = undefined;
    let chosenTitle = best?.title || query;
    const sorted = results
        .slice()
        .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));
    for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
        magnet = (0, index_1.getMagnet)(cand);
        if (!magnet) {
            try {
                magnet = await (0, index_1.getMagnetOrResolve)(cand);
            }
            catch (e) {
                console.warn(`[${new Date().toISOString()}][watchlist] Magnet resolve failed:`, e?.message || String(e));
            }
        }
        if (magnet) {
            chosenTitle = cand?.title || chosenTitle;
            break;
        }
    }
    if (!magnet) {
        console.warn(`[${new Date().toISOString()}][watchlist] No magnet found for: "${query}"`);
        return false;
    }
    // Check for duplicates
    const { exists: hasExisting } = await providers_1.registry.checkExistingAcrossAll(chosenTitle);
    if (hasExisting) {
        console.log(`[${new Date().toISOString()}][watchlist] Skipping duplicate: "${chosenTitle}"`);
        return true; // Mark as processed since it already exists
    }
    // Add to all configured debrid providers
    const addStrategy = config_1.config.addStrategy || 'all';
    const { results: addResults } = await providers_1.registry.addMagnetWithStrategy(magnet, chosenTitle, addStrategy);
    const added = addResults.some(r => r.success);
    // Refresh the source media server library after successful add
    if (added) {
        try {
            await refreshSourceLibrary(item.source);
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][watchlist] Library refresh failed:`, err?.message || String(err));
        }
    }
    return added;
}
/**
 * Single tick of the watchlist poller — fetches all watchlists,
 * processes new items, and adds torrents.
 */
async function pollOnce() {
    try {
        const isStreaming = await (0, plex_1.isAnyMediaServerStreaming)();
        if (isStreaming) {
            console.log(`[${new Date().toISOString()}][watchlist] Active media stream detected. Skipping watchlist poll to avoid debrid rate limits.`);
            return;
        }
        console.log(`[${new Date().toISOString()}][watchlist] Polling all configured media servers...`);
        const items = await fetchAllWatchlists();
        console.log(`[${new Date().toISOString()}][watchlist] Total watchlist items: ${items.length}`);
        let newCount = 0;
        for (const item of items) {
            // Check in-memory cache first, then fall back to DB
            if (processed.has(item.key) || (0, db_1.isWatchlistProcessed)(item.key)) {
                // Ensure the in-memory cache stays in sync
                processed.add(item.key);
                continue;
            }
            try {
                const success = await processWatchlistItem(item);
                if (success) {
                    processed.add(item.key);
                    (0, db_1.markWatchlistProcessed)(item.key, item.source, item.title);
                    newCount++;
                }
                else {
                    // Still mark as processed to avoid hammering the indexer
                    // Item will be retried if the user re-adds or if DB is pruned after 30 days
                    processed.add(item.key);
                    (0, db_1.markWatchlistProcessed)(item.key, item.source, item.title);
                }
            }
            catch (err) {
                console.error(`[${new Date().toISOString()}][watchlist] Error processing ${item.key}:`, err?.message || String(err));
                // Don't add to processed — will retry next tick
            }
        }
        if (newCount > 0) {
            console.log(`[${new Date().toISOString()}][watchlist] Processed ${newCount} new item(s)`);
        }
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][watchlist] Poll error:`, err?.message || String(err));
    }
}
/**
 * Starts the unified media server watchlist poller.
 *
 * Checks if at least one media server and one indexer are configured,
 * then polls at the configured interval.
 *
 * @throws Error if no indexer or media server is configured
 */
function startWatchlistPoller() {
    // Verify at least one media server is configured
    const hasMediaServer = !!config_1.config.plexToken ||
        (!!config_1.config.jellyfinUrl && !!config_1.config.jellyfinApiKey) ||
        (!!config_1.config.embyUrl && !!config_1.config.embyApiKey);
    const hasWatchlistSource = hasMediaServer ||
        (0, trakt_1.isTraktConfigured)() ||
        (0, mdblist_1.isMdblistConfigured)() ||
        (0, listrr_1.isListrrConfigured)();
    if (!hasWatchlistSource) {
        console.warn(`[${new Date().toISOString()}][watchlist] No media server or watchlist source configured — watchlist poller disabled`);
        console.warn(`[${new Date().toISOString()}][watchlist] Set PLEX_TOKEN, JELLYFIN_URL+JELLYFIN_API_KEY, or EMBY_URL+EMBY_API_KEY`);
        return;
    }
    if (!(0, index_1.isIndexerConfigured)()) {
        console.warn(`[${new Date().toISOString()}][watchlist] No indexer configured — watchlist poller disabled`);
        return;
    }
    const intervalMs = Math.max(30, config_1.config.watchlistPollIntervalSeconds) * 1000;
    const servers = [];
    if (config_1.config.plexToken)
        servers.push("Plex");
    if (config_1.config.jellyfinUrl)
        servers.push("Jellyfin");
    if (config_1.config.embyUrl)
        servers.push("Emby");
    if ((0, trakt_1.isTraktConfigured)())
        servers.push("Trakt");
    if ((0, mdblist_1.isMdblistConfigured)())
        servers.push("Mdblist");
    if ((0, listrr_1.isListrrConfigured)())
        servers.push("Listrr");
    console.log(`[${new Date().toISOString()}][watchlist] Starting poller — servers: ${servers.join(", ")}, interval: ${Math.round(intervalMs / 1000)}s`);
    // Hydrate processed set from SQLite on first start
    if (!processedHydrated) {
        try {
            processed = (0, db_1.getProcessedWatchlistKeys)();
            processedHydrated = true;
            console.log(`[${new Date().toISOString()}][watchlist] Hydrated ${processed.size} processed keys from database`);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][watchlist] Failed to hydrate from database: ${err?.message}`);
            processedHydrated = true; // Don't retry every tick
        }
    }
    // Initial poll after a short delay to let mounts stabilise
    setTimeout(() => {
        pollOnce();
        setInterval(pollOnce, intervalMs);
    }, 10000);
}
