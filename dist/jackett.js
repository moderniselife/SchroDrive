"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testJackettConnection = testJackettConnection;
exports.searchJackett = searchJackett;
exports.pickBestResult = pickBestResult;
exports.getMagnet = getMagnet;
exports.getMagnetOrResolve = getMagnetOrResolve;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
// Normalize Jackett result to match Prowlarr-like structure
function normalizeResult(r) {
    return {
        ...r,
        title: r.Title || r.title,
        guid: r.Guid || r.guid,
        magnetUrl: r.MagnetUri || r.magnetUrl,
        link: r.Link || r.link,
        seeders: r.Seeders ?? r.seeders,
        leechers: r.Peers ?? r.leechers,
        size: r.Size ?? r.size,
        indexer: r.Tracker || r.indexer,
        indexerId: r.TrackerId || r.indexerId,
        infoHash: r.InfoHash || r.infoHash,
        categories: r.Category || r.categories,
    };
}
async function testJackettConnection() {
    try {
        const base = config_1.config.jackettUrl?.replace(/\/$/, "");
        if (!base || !config_1.config.jackettApiKey)
            return false;
        const started = Date.now();
        console.log(`[${new Date().toISOString()}][jackett] testing connection to ${base}`, { timeoutMs: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 10000, 60000)) });
        // Jackett uses /api/v2.0/indexers/all/results for search, but we can test with /api/v2.0/server/config
        const res = await axios_1.default.get(`${base}/api/v2.0/server/config`, {
            params: { apikey: config_1.config.jackettApiKey },
            timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 10000, 60000)),
        });
        console.log(`[${new Date().toISOString()}][jackett] connection test successful`, {
            ms: Date.now() - started,
            port: res.data?.port,
        });
        return true;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][jackett] connection test failed`, {
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
        });
        return false;
    }
}
async function searchJackett(query, opts) {
    if (!config_1.config.jackettUrl || !config_1.config.jackettApiKey) {
        throw new Error("Jackett not configured. Set JACKETT_URL and JACKETT_API_KEY.");
    }
    const base = config_1.config.jackettUrl.replace(/\/$/, "");
    // Jackett Torznab API endpoint - use "all" to search all indexers, or specific indexer ID
    const indexerPath = opts?.indexerIds?.length ? opts.indexerIds[0] : "all";
    const url = new URL(`/api/v2.0/indexers/${indexerPath}/results`, base);
    const originalQuery = String(query || "");
    const stripTmdb = (q) => q.replace(/\s*TMDB\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
    const withoutTmdb = stripTmdb(originalQuery);
    const usedQuery = withoutTmdb || originalQuery;
    const params = {
        apikey: config_1.config.jackettApiKey,
        Query: usedQuery,
    };
    const categories = opts?.categories?.length ? opts.categories : (config_1.config.jackettCategories?.length ? config_1.config.jackettCategories : undefined);
    if (categories?.length) {
        params.Category = categories;
    }
    const maskedKey = config_1.config.jackettApiKey ? `${config_1.config.jackettApiKey.slice(0, 4)}…` : "unset";
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][jackett] GET ${url.toString()}`, {
        query: originalQuery,
        usedQuery,
        categories,
        indexerPath,
        apikey: maskedKey,
        timeoutMs: config_1.config.jackettTimeoutMs,
    });
    const res = await axios_1.default.get(url.toString(), {
        params,
        timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000)),
    }).catch((err) => {
        console.error(`[${new Date().toISOString()}][jackett] request failed`, {
            query,
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            url: url.toString(),
            timeout: `${Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000))}ms`
        });
        if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
            console.error(`[${new Date().toISOString()}][jackett] timeout diagnostics`, {
                base,
                query,
                params: { ...params, apikey: maskedKey },
                suggestion: 'Check network connectivity to Jackett; consider increasing JACKETT_TIMEOUT_MS or reducing indexers'
            });
        }
        throw err;
    });
    // Jackett returns { Results: [...] } or just an array depending on endpoint
    let rawData = res.data?.Results || res.data || [];
    if (!Array.isArray(rawData))
        rawData = [];
    let data = rawData.map(normalizeResult);
    // Apply limit if specified
    const limit = opts?.limit ?? (Number.isFinite(config_1.config.jackettSearchLimit) ? config_1.config.jackettSearchLimit : undefined);
    if (limit && data.length > limit) {
        data = data.slice(0, limit);
    }
    console.log(`[${new Date().toISOString()}][jackett] response`, {
        count: data.length,
        ms: Date.now() - started,
        sample: data.slice(0, 5).map((r) => ({
            title: r.title,
            seeders: r.seeders,
            size: r.size,
            hasMagnet: !!(r.magnetUrl || r.guid || r.link),
            indexer: r.indexer,
        })),
    });
    // Fallback: if no results and query contains a year, retry without the year
    if (!data.length && /\b(19|20)\d{2}\b/.test(usedQuery)) {
        const withoutYear = usedQuery.replace(/\b(19|20)\d{2}\b/g, "").replace(/\s{2,}/g, " ").trim();
        if (withoutYear && withoutYear !== usedQuery) {
            const started2 = Date.now();
            const params2 = { ...params, Query: withoutYear };
            console.log(`[${new Date().toISOString()}][jackett] fallback GET ${url.toString()}`, {
                originalQuery,
                usedQuery,
                fallbackQuery: withoutYear,
                categories,
                apikey: maskedKey,
                timeoutMs: config_1.config.jackettTimeoutMs,
            });
            const res2 = await axios_1.default.get(url.toString(), {
                params: params2,
                timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000)),
            }).catch((err) => {
                console.error(`[${new Date().toISOString()}][jackett] fallback request failed`, {
                    originalQuery,
                    fallbackQuery: withoutYear,
                    error: err?.message || String(err),
                    code: err?.code,
                    status: err?.response?.status,
                    statusText: err?.response?.statusText,
                    url: url.toString(),
                });
                throw err;
            });
            let rawData2 = res2.data?.Results || res2.data || [];
            if (!Array.isArray(rawData2))
                rawData2 = [];
            data = rawData2.map(normalizeResult);
            if (limit && data.length > limit) {
                data = data.slice(0, limit);
            }
            console.log(`[${new Date().toISOString()}][jackett] fallback response`, {
                count: data.length,
                ms: Date.now() - started2,
                sample: data.slice(0, 5).map((r) => ({ title: r.title, seeders: r.seeders, size: r.size, indexer: r.indexer })),
            });
        }
    }
    // Fallback: if still no results and categories were used, try without categories
    if (!data.length && categories?.length) {
        const started3 = Date.now();
        const params3 = { ...params };
        delete params3.Category;
        console.log(`[${new Date().toISOString()}][jackett] fallback (no categories) GET ${url.toString()}`, {
            originalQuery,
            usedQuery,
            categoriesRemoved: true,
            apikey: maskedKey,
            timeoutMs: config_1.config.jackettTimeoutMs,
        });
        const res3 = await axios_1.default.get(url.toString(), {
            params: params3,
            timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000)),
        }).catch((err) => {
            console.error(`[${new Date().toISOString()}][jackett] fallback (no categories) failed`, {
                originalQuery,
                usedQuery,
                error: err?.message || String(err),
                code: err?.code,
                status: err?.response?.status,
                statusText: err?.response?.statusText,
                url: url.toString(),
            });
            throw err;
        });
        let rawData3 = res3.data?.Results || res3.data || [];
        if (!Array.isArray(rawData3))
            rawData3 = [];
        data = rawData3.map(normalizeResult);
        if (limit && data.length > limit) {
            data = data.slice(0, limit);
        }
        console.log(`[${new Date().toISOString()}][jackett] fallback (no categories) response`, {
            count: data.length,
            ms: Date.now() - started3,
            sample: data.slice(0, 5).map((r) => ({ title: r.title, seeders: r.seeders, size: r.size, indexer: r.indexer })),
        });
    }
    return data;
}
function pickBestResult(results) {
    const withMagnet = results.filter((r) => getMagnet(r));
    const pool = withMagnet.length ? withMagnet : results;
    const sorted = pool
        .slice()
        .sort((a, b) => ((b.seeders ?? 0) - (a.seeders ?? 0)) || ((b.size ?? 0) - (a.size ?? 0)));
    const chosen = sorted[0];
    console.log(`[${new Date().toISOString()}][jackett] pickBestResult`, {
        inputCount: results.length,
        poolCount: pool.length,
        chosen: chosen ? { title: chosen.title, seeders: chosen.seeders, size: chosen.size } : null,
    });
    return chosen;
}
function getMagnet(r) {
    if (!r)
        return undefined;
    const direct = r.magnetUrl || r.MagnetUri || r.guid || r.Guid || r.link || r.Link;
    const ok = typeof direct === "string" && direct.startsWith("magnet:");
    console.log(`[${new Date().toISOString()}][jackett] getMagnet`, { hasCandidate: !!direct, ok });
    if (ok)
        return direct;
    // Try to build a magnet from info hash if present
    const hashCand = (r.infoHash || r.InfoHash || "").toString().trim();
    if (hashCand) {
        const hex40 = /^[a-fA-F0-9]{40}$/;
        const b32 = /^[A-Z2-7]{32,39}$/i;
        if (hex40.test(hashCand) || b32.test(hashCand)) {
            const hashUpper = hashCand.toUpperCase();
            const dn = r.title ? `&dn=${encodeURIComponent(r.title)}` : "";
            const built = `magnet:?xt=urn:btih:${hashUpper}${dn}`;
            console.log(`[${new Date().toISOString()}][jackett] getMagnet built from infoHash`, { built: true });
            return built;
        }
    }
    return undefined;
}
function isMagnet(s) {
    return typeof s === 'string' && s.startsWith('magnet:');
}
function absoluteUrl(u, base) {
    try {
        return new URL(u, base).toString();
    }
    catch {
        return u;
    }
}
async function getMagnetOrResolve(r) {
    if (!r)
        return undefined;
    const direct = getMagnet(r);
    if (direct)
        return direct;
    const base = config_1.config.jackettUrl.replace(/\/$/, "");
    const candidate = r.Link || r.link || r.Guid || r.guid;
    let url = typeof candidate === 'string' ? absoluteUrl(candidate, base) : '';
    if (!url || !(url.startsWith('http://') || url.startsWith('https://')))
        return undefined;
    const maxHops = Math.max(1, Math.min(Number(config_1.config.jackettRedirectMaxHops || 5), 10));
    let hops = 0;
    while (hops < maxHops && url && (url.startsWith('http://') || url.startsWith('https://'))) {
        hops++;
        let resp;
        try {
            resp = await axios_1.default.head(url, { maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000)) });
        }
        catch {
            try {
                resp = await axios_1.default.get(url, { maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config_1.config.jackettTimeoutMs || 15000, 120000)) });
            }
            catch (e) {
                console.warn(`[${new Date().toISOString()}][jackett] resolveMagnet failed`, { url, err: e?.message });
                return undefined;
            }
        }
        const status = resp?.status || 0;
        const location = String(resp?.headers?.location || '');
        const ctype = String(resp?.headers?.['content-type'] || '').toLowerCase();
        if (status >= 300 && status < 400 && location) {
            if (isMagnet(location)) {
                console.log(`[${new Date().toISOString()}][jackett] resolveMagnet redirect->magnet`, { hops, hash: (location.match(/btih:([^&]+)/i) || [])[1] });
                return location;
            }
            url = absoluteUrl(location, base);
            if (url.endsWith('.torrent')) {
                console.log(`[${new Date().toISOString()}][jackett] resolveMagnet redirect->torrent`, { hops, url });
                return undefined;
            }
            continue;
        }
        if (ctype.includes('bittorrent') || url.endsWith('.torrent')) {
            console.log(`[${new Date().toISOString()}][jackett] resolveMagnet content-type torrent`, { url });
            return undefined;
        }
        break;
    }
    return undefined;
}
