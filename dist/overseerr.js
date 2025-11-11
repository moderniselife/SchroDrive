"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startOverseerrPoller = startOverseerrPoller;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const prowlarr_1 = require("./prowlarr");
const torbox_1 = require("./torbox");
const prowlarr_2 = require("./prowlarr");
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
    (0, config_1.requireEnv)("prowlarrUrl", "prowlarrApiKey", "torboxApiKey");
    // Accept either Overseerr API key or Bearer token
    if (!config_1.config.overseerrUrl || (!config_1.config.overseerrApiKey && !config_1.config.overseerrAuth)) {
        throw new Error("Missing Overseerr credentials. Set OVERSEERR_URL and either OVERSEERR_API_KEY or OVERSEERR_AUTH.");
    }
    const processed = new Set();
    const intervalMs = Math.max(5, Number(config_1.config.pollIntervalSeconds || 30)) * 1000;
    console.log(`[${new Date().toISOString()}][poller] starting`, { intervalSeconds: Math.round(intervalMs / 1000) });
    // Test Prowlarr connection on startup
    (0, prowlarr_2.testProwlarrConnection)().then(connected => {
        if (!connected) {
            console.warn(`[${new Date().toISOString()}][poller] WARNING: Prowlarr connection test failed. Searches may timeout.`);
        }
    }).catch(err => {
        console.error(`[${new Date().toISOString()}][poller] Prowlarr connection test error`, err?.message || String(err));
    });
    const runOnce = async () => {
        try {
            console.log(`[${new Date().toISOString()}][poller] tick`);
            const items = await fetchApprovedRequests();
            console.log(`[${new Date().toISOString()}][poller] approved requests fetched`, { count: items.length });
            for (const r of items) {
                const id = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
                if (!id)
                    continue;
                if (processed.has(id)) {
                    console.log(`[${new Date().toISOString()}][poller] skip already processed`, { id });
                    continue;
                }
                let built = buildSearchFromRequest(r);
                if (!built) {
                    console.warn(`[${new Date().toISOString()}][poller] could not build query from request`, { id, media: r?.media });
                    // Try to enrich from Overseerr details
                    const media = r?.media || {};
                    const tmdbId = media?.tmdbId ?? r?.mediaId;
                    const mediaType = media?.mediaType ?? media?.type;
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
                    const media = r?.media || {};
                    const tmdbId = media?.tmdbId ?? r?.mediaId;
                    const mediaType = media?.mediaType ?? media?.type;
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
                    console.log(`[${new Date().toISOString()}][poller->prowlarr] searching`, { id, query: built.query, categories: built.categories });
                    const t0 = Date.now();
                    const results = await (0, prowlarr_1.searchProwlarr)(built.query, { categories: built.categories });
                    console.log(`[${new Date().toISOString()}][poller->prowlarr] results`, { id, count: results.length, ms: Date.now() - t0 });
                    const best = (0, prowlarr_1.pickBestResult)(results);
                    console.log(`[${new Date().toISOString()}][poller->prowlarr] chosen`, { id, title: best?.title, seeders: best?.seeders, size: best?.size });
                    // Try best first, then scan other candidates until a magnet is found
                    let magnet = undefined;
                    let chosenUsed = best;
                    const sorted = results
                        .slice()
                        .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));
                    for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
                        magnet = (0, prowlarr_1.getMagnet)(cand);
                        if (!magnet) {
                            try {
                                magnet = await (0, prowlarr_1.getMagnetOrResolve)(cand);
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
                        continue;
                    }
                    // Check for existing torrents before adding
                    const torrentTitle = chosenUsed?.title || built.query;
                    const hasExisting = await (0, torbox_1.checkExistingTorrents)(torrentTitle);
                    if (hasExisting) {
                        console.log(`[${new Date().toISOString()}][poller] skipping duplicate torrent`, { id, title: torrentTitle });
                        processed.add(id);
                        continue;
                    }
                    const teaser = magnet.slice(0, 80) + '...';
                    console.log(`[${new Date().toISOString()}][poller->torbox] adding magnet`, { id, title: torrentTitle, teaser });
                    await (0, torbox_1.addMagnetToTorbox)(magnet, torrentTitle);
                    console.log(`[${new Date().toISOString()}][poller->torbox] added`, { id });
                    processed.add(id);
                    if (processed.size > 1000) {
                        // Trim processed set
                        const first = processed.values().next().value;
                        if (typeof first === "string") {
                            processed.delete(first);
                        }
                    }
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
    // Start immediately and then on interval
    runOnce();
    setInterval(runOnce, intervalMs);
    console.log(`[${new Date().toISOString()}][poller] started`, { everySeconds: Math.round(intervalMs / 1000) });
}
