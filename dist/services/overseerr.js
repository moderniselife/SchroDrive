"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startOverseerrPoller = startOverseerrPoller;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
const index_1 = require("../indexers/index");
const providers_1 = require("../providers");
const db_1 = require("../core/db");
const plex_1 = require("../integrations/plex");
function defaultCategoriesFor(mediaType) {
    const map = {
        movie: ["5000"],
        tv: ["5000"],
    };
    const key = String(mediaType || '').toLowerCase();
    return map[key];
}
async function fetchTitleYearFromOverseerr(mediaType, tmdbId) {
    if (!config_1.config.overseerrUrl || (!config_1.config.overseerrApiKey && !config_1.config.overseerrAuth))
        return undefined;
    const base = config_1.config.overseerrUrl.replace(/\/$/, "");
    const path = mediaType?.toLowerCase() === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
    const url = `${base}${path}`;
    console.log(`[${new Date().toISOString()}][poller->overseerr] GET ${url} (details)`);
    const headers = {};
    if (config_1.config.overseerrApiKey)
        headers["X-Api-Key"] = config_1.config.overseerrApiKey;
    if (config_1.config.overseerrAuth)
        headers["Authorization"] = config_1.config.overseerrAuth.startsWith("Bearer ") ? config_1.config.overseerrAuth : `Bearer ${config_1.config.overseerrAuth}`;
    const res = await axios_1.default.get(url, { headers, timeout: 15000 });
    const data = res?.data || {};
    const title = data?.title || data?.name;
    const dateStr = data?.releaseDate || data?.firstAirDate || data?.first_air_date || data?.release_date;
    const year = dateStr ? Number(String(dateStr).slice(0, 4)) : undefined;
    if (title)
        return { title, year: Number.isFinite(year) ? year : undefined };
    return undefined;
}
function buildSearchFromRequest(r) {
    const media = r?.media || {};
    const title = media.title || media.name;
    const year = media.year || media.releaseYear;
    const mediaType = media.mediaType || media.type;
    const tmdbId = media.tmdbId || r.mediaId;
    let query = "";
    if (title) {
        query = year ? `${title} ${year}` : String(title);
        if (tmdbId && Number.isInteger(Number(tmdbId))) {
            query += ` TMDB${tmdbId}`;
        }
    }
    // Fallback: if no title available, still allow TMDB-only queries
    if (!query && tmdbId && Number.isInteger(Number(tmdbId))) {
        query = `TMDB${tmdbId}`;
    }
    if (!query)
        return undefined;
    const result = { query };
    const defaultCategories = {
        movie: ["5000"],
        tv: ["5000"],
    };
    const key = (mediaType || "").toString().toLowerCase();
    if (key && defaultCategories[key]) {
        result.categories = defaultCategories[key];
    }
    return result;
}
async function fetchApprovedRequests() {
    const base = config_1.config.overseerrUrl.replace(/\/$/, "");
    const url = `${base}/request`;
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][poller->overseerr] GET ${url}`, {
        params: { filter: "approved", sort: "modified", take: 50, skip: 0 },
    });
    const headers = {};
    if (config_1.config.overseerrApiKey)
        headers["X-Api-Key"] = config_1.config.overseerrApiKey;
    if (config_1.config.overseerrAuth)
        headers["Authorization"] = config_1.config.overseerrAuth.startsWith("Bearer ") ? config_1.config.overseerrAuth : `Bearer ${config_1.config.overseerrAuth}`;
    const res = await axios_1.default.get(url, {
        params: { filter: "approved", sort: "modified", take: 50, skip: 0 },
        headers,
        timeout: 30000,
    });
    const results = res?.data?.results || [];
    console.log(`[${new Date().toISOString()}][poller->overseerr] response`, { count: Array.isArray(results) ? results.length : 0, ms: Date.now() - started });
    return Array.isArray(results) ? results : [];
}
function startOverseerrPoller() {
    // Validate indexer is configured
    if (!(0, index_1.isIndexerConfigured)()) {
        throw new Error("No indexer configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
    }
    // Accept either Overseerr API key or Bearer token
    if (!config_1.config.overseerrUrl || (!config_1.config.overseerrApiKey && !config_1.config.overseerrAuth)) {
        throw new Error("Missing Overseerr credentials. Set OVERSEERR_URL and either OVERSEERR_API_KEY or OVERSEERR_AUTH.");
    }
    // Ensure at least one provider is configured
    const providers = providers_1.registry.configured();
    if (providers.length === 0) {
        throw new Error("No debrid provider configured. Set TORBOX_API_KEY and/or RD_ACCESS_TOKEN.");
    }
    console.log(`[${new Date().toISOString()}][poller] providers configured`, {
        providers: providers.map(p => p.id),
        order: providers_1.registry.ordered().map(p => p.id),
    });
    /** Loaded from SQLite on startup — survives container restarts. */
    let processed = new Set();
    function loadProcessedFromDb() {
        try {
            processed = (0, db_1.getProcessedOverseerrKeys)();
            console.log(`[${new Date().toISOString()}][poller→overseerr] Loaded ${processed.size} processed request(s) from database`);
        }
        catch (e) {
            console.warn(`[${new Date().toISOString()}][poller→overseerr] Failed to load processed state from DB: ${e?.message}`);
        }
    }
    loadProcessedFromDb();
    const intervalMs = Math.max(5, Number(config_1.config.pollIntervalSeconds || 30)) * 1000;
    console.log(`[${new Date().toISOString()}][poller] starting`, { intervalSeconds: Math.round(intervalMs / 1000) });
    // Test indexer connection on startup
    const provider = (0, index_1.getProviderName)();
    (0, index_1.testIndexerConnection)().then(connected => {
        if (!connected) {
            console.warn(`[${new Date().toISOString()}][poller] WARNING: ${provider} connection test failed. Searches may timeout.`);
        }
    }).catch(err => {
        console.error(`[${new Date().toISOString()}][poller] ${provider} connection test error`, err?.message || String(err));
    });
    const runOnce = async () => {
        try {
            const isStreaming = await (0, plex_1.isAnyMediaServerStreaming)();
            if (isStreaming) {
                console.log(`[${new Date().toISOString()}][poller] Active media stream detected. Skipping poller tick to avoid debrid rate limits.`);
                return;
            }
            const configuredProviders = providers_1.registry.configured();
            const allRateLimited = configuredProviders.every(p => p.isRateLimited());
            if (allRateLimited && configuredProviders.length > 0) {
                const minWait = Math.min(...configuredProviders.map(p => p.getWaitTime()));
                console.warn(`[${new Date().toISOString()}][poller] All debrid providers are rate-limited. Skipping tick to avoid API spam. Resuming in ${minWait}s.`);
                return;
            }
            console.log(`[${new Date().toISOString()}][poller] tick`);
            const items = await fetchApprovedRequests();
            console.log(`[${new Date().toISOString()}][poller] approved requests fetched`, { count: items.length });
            for (const r of items) {
                const currentProviders = providers_1.registry.configured();
                if (currentProviders.every(p => p.isRateLimited()) && currentProviders.length > 0) {
                    console.warn(`[${new Date().toISOString()}][poller] All debrid providers became rate-limited. Aborting tick.`);
                    break;
                }
                const id = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
                if (!id)
                    continue;
                // Persist to local database for historical request tracking
                const media = r?.media || {};
                const title = media.title || media.name;
                const mediaType = media?.mediaType ?? media?.type;
                const tmdbId = media?.tmdbId ?? r?.mediaId;
                if (title && mediaType) {
                    try {
                        (0, db_1.upsertOverseerrRequest)({
                            requestId: id,
                            title,
                            mediaType,
                            tmdbId: tmdbId ? Number(tmdbId) : undefined,
                            status: r.status || "approved",
                        });
                    }
                    catch (dbErr) {
                        console.error(`[${new Date().toISOString()}][poller] failed to persist request ${id} to database`, dbErr?.message);
                    }
                }
                if (processed.has(id)) {
                    console.log(`[${new Date().toISOString()}][poller] skip already processed`, { id });
                    continue;
                }
                let built = buildSearchFromRequest(r);
                if (!built) {
                    console.warn(`[${new Date().toISOString()}][poller] could not build query from request`, { id, media: r?.media });
                    // Try to enrich from Overseerr details
                    if (tmdbId) {
                        try {
                            const enriched = await fetchTitleYearFromOverseerr(String(mediaType || ''), Number(tmdbId));
                            if (enriched?.title) {
                                const year = enriched.year ? ` ${enriched.year}` : '';
                                built = { query: `${enriched.title}${year} TMDB${tmdbId}`, categories: mediaType ? defaultCategoriesFor(mediaType) : undefined };
                                console.log(`[${new Date().toISOString()}][poller] enriched query from Overseerr`, { id, query: built.query });
                            }
                        }
                        catch (e) {
                            console.warn(`[${new Date().toISOString()}][poller] enrich failed`, { id, err: e?.message || String(e) });
                        }
                    }
                    if (!built) {
                        continue;
                    }
                }
                // If query is TMDB-only, attempt to enrich with title/year for better search
                try {
                    if (tmdbId && built.query.trim() === `TMDB${tmdbId}`) {
                        const enriched = await fetchTitleYearFromOverseerr(String(mediaType || ''), Number(tmdbId));
                        if (enriched?.title) {
                            const year = enriched.year ? ` ${enriched.year}` : '';
                            built = { query: `${enriched.title}${year} TMDB${tmdbId}`, categories: mediaType ? defaultCategoriesFor(mediaType) : undefined };
                            console.log(`[${new Date().toISOString()}][poller] upgraded TMDB-only query`, { id, query: built.query });
                        }
                    }
                }
                catch (e) {
                    console.warn(`[${new Date().toISOString()}][poller] upgrade TMDB-only failed`, { err: e?.message || String(e) });
                }
                try {
                    const indexerName = (0, index_1.getProviderName)();
                    console.log(`[${new Date().toISOString()}][poller->${indexerName}] searching`, { id, query: built.query, categories: built.categories });
                    const t0 = Date.now();
                    const results = await (0, index_1.searchIndexer)(built.query, { categories: built.categories });
                    console.log(`[${new Date().toISOString()}][poller->${indexerName}] results`, { id, count: results.length, ms: Date.now() - t0 });
                    const best = (0, index_1.pickBestResult)(results);
                    console.log(`[${new Date().toISOString()}][poller->${indexerName}] chosen`, { id, title: best?.title, seeders: best?.seeders, size: best?.size });
                    // Try best first, then scan other candidates until a magnet is found
                    let magnet = undefined;
                    let chosenUsed = best;
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
                                console.warn(`[${new Date().toISOString()}][poller] magnet resolve failed`, { id, err: e?.message || String(e) });
                            }
                        }
                        if (magnet) {
                            chosenUsed = cand;
                            break;
                        }
                    }
                    if (!magnet) {
                        console.warn(`[${new Date().toISOString()}][poller] no magnet found`, { id, query: built.query });
                        processed.add(id);
                        (0, db_1.markOverseerrProcessed)(String(r.id), undefined, mediaType, tmdbId ? String(tmdbId) : undefined, undefined);
                        continue;
                    }
                    // -----------------------------------------------------------------
                    // Check for existing torrents across ALL configured providers
                    // -----------------------------------------------------------------
                    const torrentTitle = chosenUsed?.title || built.query;
                    const { exists: hasExisting, provider: existingProvider } = await providers_1.registry.checkExistingAcrossAll(torrentTitle);
                    if (hasExisting) {
                        console.log(`[${new Date().toISOString()}][poller] skipping duplicate torrent`, { id, title: torrentTitle, existingProvider });
                        processed.add(id);
                        continue;
                    }
                    // -----------------------------------------------------------------
                    // Add magnet to providers using configured strategy
                    // -----------------------------------------------------------------
                    const addStrategy = config_1.config.addStrategy || 'all';
                    const { results: addResults } = await providers_1.registry.addMagnetWithStrategy(magnet, torrentTitle, addStrategy);
                    const anySuccess = addResults.some(r => r.success);
                    if (!anySuccess) {
                        console.error(`[${new Date().toISOString()}][poller] ❌ failed to add to ANY provider`, { id, title: torrentTitle });
                    }
                    processed.add(id);
                    (0, db_1.markOverseerrProcessed)(String(r.id), torrentTitle, mediaType, tmdbId ? String(tmdbId) : undefined, undefined);
                }
                catch (err) {
                    console.error(`[${new Date().toISOString()}][poller] processing error`, { id, query: built.query, error: err?.message || String(err), stack: err?.stack });
                    // Don't add to processed set on error so it will be retried
                }
            }
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][poller] fetch error`, e?.message || String(e));
        }
    };
    // Start poller tick immediately and then on interval
    runOnce();
    setInterval(runOnce, intervalMs);
    console.log(`[${new Date().toISOString()}][poller] started`, { everySeconds: Math.round(intervalMs / 1000) });
    // Start background Overseerr requests sync and missing requests recovery scanner
    const runBackgroundSyncAndRecovery = async () => {
        try {
            await syncAllApprovedRequests();
            await checkAndReaddMissingRequests();
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][poller-sync] Background sync/recovery error`, e?.message || String(e));
        }
    };
    // Run on startup
    runBackgroundSyncAndRecovery();
    // Schedule background historical sync (every 6 hours) and missing requests scanner (every 1 hour)
    setInterval(async () => {
        try {
            await syncAllApprovedRequests();
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][poller-sync] Periodic sync error`, e?.message || String(e));
        }
    }, 6 * 60 * 60 * 1000);
    setInterval(async () => {
        try {
            await checkAndReaddMissingRequests();
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][poller-sync] Periodic recovery check error`, e?.message || String(e));
        }
    }, 60 * 60 * 1000);
}
/**
 * Pages through all approved requests from Overseerr and syncs them to SQLite database.
 */
async function syncAllApprovedRequests() {
    if (!config_1.config.overseerrUrl || (!config_1.config.overseerrApiKey && !config_1.config.overseerrAuth))
        return;
    const base = config_1.config.overseerrUrl.replace(/\/$/, "");
    const url = `${base}/request`;
    const headers = {};
    if (config_1.config.overseerrApiKey)
        headers["X-Api-Key"] = config_1.config.overseerrApiKey;
    if (config_1.config.overseerrAuth)
        headers["Authorization"] = config_1.config.overseerrAuth.startsWith("Bearer ") ? config_1.config.overseerrAuth : `Bearer ${config_1.config.overseerrAuth}`;
    let skip = 0;
    const take = 100;
    let total = 0;
    console.log(`[${new Date().toISOString()}][overseerr-sync] Starting historical requests sync...`);
    while (true) {
        try {
            const res = await axios_1.default.get(url, {
                params: { filter: "approved", sort: "modified", take, skip },
                headers,
                timeout: 30000,
            });
            const results = res?.data?.results || [];
            if (results.length === 0)
                break;
            for (const r of results) {
                const requestId = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
                const media = r?.media || {};
                const title = media.title || media.name;
                const tmdbId = media?.tmdbId ?? r?.mediaId;
                const mediaType = media?.mediaType ?? media?.type;
                if (requestId && title && mediaType) {
                    (0, db_1.upsertOverseerrRequest)({
                        requestId,
                        title,
                        mediaType,
                        tmdbId: tmdbId ? Number(tmdbId) : undefined,
                        status: r.status || "approved",
                    });
                }
            }
            total += results.length;
            if (results.length < take)
                break;
            skip += take;
            // Sleep slightly to avoid spamming Overseerr API
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][overseerr-sync] Historical sync failed at skip=${skip}: ${err?.message}`);
            break;
        }
    }
    console.log(`[${new Date().toISOString()}][overseerr-sync] Synced ${total} approved requests to local database.`);
}
/**
 * Checks all synced requests against active provider torrents. If a request has
 * no corresponding torrent on debrid providers, searches and re-adds it.
 */
async function checkAndReaddMissingRequests() {
    const isStreaming = await (0, plex_1.isAnyMediaServerStreaming)();
    if (isStreaming) {
        console.log(`[${new Date().toISOString()}][poller-sync] Active media stream detected. Skipping recovery check.`);
        return;
    }
    const configuredProviders = providers_1.registry.configured();
    const allRateLimited = configuredProviders.every(p => p.isRateLimited());
    if (allRateLimited && configuredProviders.length > 0) {
        console.warn(`[${new Date().toISOString()}][poller-sync] All providers are rate-limited. Skipping recovery check.`);
        return;
    }
    console.log(`[${new Date().toISOString()}][poller-sync] Checking for requests removed from debrid providers...`);
    const requests = (0, db_1.getAllOverseerrRequests)();
    const providers = providers_1.registry.configured();
    if (providers.length === 0) {
        console.warn(`[${new Date().toISOString()}][poller-sync] No configured debrid providers, skipping missing requests check`);
        return;
    }
    let readdedCount = 0;
    for (const req of requests) {
        const currentProviders = providers_1.registry.configured();
        if (currentProviders.every(p => p.isRateLimited()) && currentProviders.length > 0) {
            console.warn(`[${new Date().toISOString()}][poller-sync] All providers became rate-limited. Aborting recovery check.`);
            break;
        }
        try {
            // Check if a torrent for this request already exists on any provider
            const { exists } = await providers_1.registry.checkExistingAcrossAll(req.title);
            if (exists) {
                // Already present, skip
                continue;
            }
            // Not present! Check search cooldown to avoid spamming indexers
            const now = Date.now();
            const lastSearch = req.lastSearchAt || 0;
            const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours cooldown
            if (now - lastSearch < cooldownMs) {
                // Skipped due to cooldown
                continue;
            }
            // Update lastSearchAt immediately to prevent concurrent duplicate searches
            (0, db_1.upsertOverseerrRequest)({
                ...req,
                lastSearchAt: now,
            });
            // Build search query
            let query = req.title;
            if (req.tmdbId) {
                query += ` TMDB${req.tmdbId}`;
            }
            console.log(`[${new Date().toISOString()}][poller-sync] Request "${req.title}" is missing from providers. Re-searching...`);
            const categories = defaultCategoriesFor(req.mediaType);
            const results = await (0, index_1.searchIndexer)(query, { categories });
            if (results.length === 0) {
                console.log(`[${new Date().toISOString()}][poller-sync] No results found for missing request "${req.title}"`);
                continue;
            }
            const best = (0, index_1.pickBestResult)(results);
            let magnet = undefined;
            let chosenUsed = best;
            const sorted = results
                .slice()
                .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));
            for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
                magnet = (0, index_1.getMagnet)(cand);
                if (!magnet) {
                    try {
                        magnet = await (0, index_1.getMagnetOrResolve)(cand);
                    }
                    catch { }
                }
                if (magnet) {
                    chosenUsed = cand;
                    break;
                }
            }
            if (!magnet) {
                console.log(`[${new Date().toISOString()}][poller-sync] No magnet found for missing request "${req.title}"`);
                continue;
            }
            const torrentTitle = chosenUsed?.title || query;
            const addStrategy = config_1.config.addStrategy || 'all';
            const { results: addResults } = await providers_1.registry.addMagnetWithStrategy(magnet, torrentTitle, addStrategy);
            const anySuccess = addResults.some(r => r.success);
            if (anySuccess) {
                console.log(`[${new Date().toISOString()}][poller-sync] ✅ Successfully re-added missing request: "${req.title}"`);
                readdedCount++;
            }
            else {
                console.error(`[${new Date().toISOString()}][poller-sync] ❌ Failed to add re-added request to any provider: "${req.title}"`);
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][poller-sync] Error processing missing request "${req.title}": ${err?.message}`);
        }
    }
    console.log(`[${new Date().toISOString()}][poller-sync] Finished checking missing requests. Re-added ${readdedCount} shows/movies.`);
}
