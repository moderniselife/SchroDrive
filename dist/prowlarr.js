"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testProwlarrConnection = testProwlarrConnection;
exports.searchProwlarr = searchProwlarr;
exports.pickBestResult = pickBestResult;
exports.getMagnet = getMagnet;
exports.getMagnetOrResolve = getMagnetOrResolve;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
async function testProwlarrConnection() {
    try {
        const base = config_1.config.prowlarrUrl?.replace(/\/$/, "");
        if (!base || !config_1.config.prowlarrApiKey)
            return false;
        const started = Date.now();
        console.log(`[${new Date().toISOString()}][prowlarr] testing connection to ${base}`, { timeoutMs: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 10000, 60000)) });
        const res = await axios_1.default.get(`${base}/api/v1/indexer`, {
            headers: { "X-Api-Key": config_1.config.prowlarrApiKey },
            timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 10000, 60000)),
        });
        console.log(`[${new Date().toISOString()}][prowlarr] connection test successful`, {
            ms: Date.now() - started,
            indexerCount: Array.isArray(res.data) ? res.data.length : 0
        });
        return true;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][prowlarr] connection test failed`, {
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
        });
        return false;
    }
}
async function searchProwlarr(query, opts) {
    if (!config_1.config.prowlarrUrl || !config_1.config.prowlarrApiKey) {
        throw new Error("Prowlarr not configured. Set PROWLARR_URL and PROWLARR_API_KEY.");
    }
    const base = config_1.config.prowlarrUrl.replace(/\/$/, "");
    const url = new URL("/api/v1/search", base);
    const originalQuery = String(query || "");
    const stripTmdb = (q) => q.replace(/\s*TMDB\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
    const withoutTmdb = stripTmdb(originalQuery);
    const usedQuery = withoutTmdb || originalQuery;
    const params = { query: usedQuery };
    const searchType = 'search';
    params.type = searchType;
    const categories = (opts?.categories?.length ? opts.categories : (config_1.config.prowlarrCategories?.length ? config_1.config.prowlarrCategories : undefined));
    if (categories?.length)
        params.categories = categories.join(",");
    const indexerIds = (opts?.indexerIds?.length ? opts.indexerIds : (config_1.config.prowlarrIndexerIds?.length ? config_1.config.prowlarrIndexerIds : undefined));
    if (indexerIds?.length)
        params.indexerIds = indexerIds.join(",");
    const limit = opts?.limit ?? (Number.isFinite(config_1.config.prowlarrSearchLimit) ? config_1.config.prowlarrSearchLimit : undefined);
    if (limit)
        params.limit = limit;
    const maskedKey = config_1.config.prowlarrApiKey ? `${config_1.config.prowlarrApiKey.slice(0, 4)}…` : "unset";
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][prowlarr] GET ${url.toString()}`, {
        query: originalQuery,
        usedQuery,
        categories,
        indexerIds,
        limit,
        apikey: maskedKey,
        timeoutMs: config_1.config.prowlarrTimeoutMs,
        type: searchType,
    });
    const res = await axios_1.default.get(url.toString(), {
        params,
        headers: { "X-Api-Key": config_1.config.prowlarrApiKey },
        timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000)),
    }).catch((err) => {
        console.error(`[${new Date().toISOString()}][prowlarr] request failed`, {
            query,
            error: err?.message || String(err),
            code: err?.code,
            status: err?.response?.status,
            statusText: err?.response?.statusText,
            url: url.toString(),
            timeout: `${Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000))}ms`
        });
        // Additional diagnostics for timeout errors
        if (err?.code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
            console.error(`[${new Date().toISOString()}][prowlarr] timeout diagnostics`, {
                base,
                query,
                params,
                suggestion: 'Check network connectivity to Prowlarr; consider increasing PROWLARR_TIMEOUT_MS, reducing PROWLARR_INDEXER_IDS or categories'
            });
        }
        throw err;
    });
    let data = Array.isArray(res.data) ? res.data : [];
    console.log(`[${new Date().toISOString()}][prowlarr] response`, {
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
            const params2 = { ...params, query: withoutYear };
            console.log(`[${new Date().toISOString()}][prowlarr] fallback GET ${url.toString()}`, {
                originalQuery,
                usedQuery,
                fallbackQuery: withoutYear,
                categories,
                indexerIds,
                limit,
                apikey: maskedKey,
                timeoutMs: config_1.config.prowlarrTimeoutMs,
                type: searchType,
            });
            const res2 = await axios_1.default.get(url.toString(), {
                params: params2,
                headers: { "X-Api-Key": config_1.config.prowlarrApiKey },
                timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000)),
            }).catch((err) => {
                console.error(`[${new Date().toISOString()}][prowlarr] fallback request failed`, {
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
            data = Array.isArray(res2.data) ? res2.data : [];
            console.log(`[${new Date().toISOString()}][prowlarr] fallback response`, {
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
        delete params3.categories;
        console.log(`[${new Date().toISOString()}][prowlarr] fallback (no categories) GET ${url.toString()}`, {
            originalQuery,
            usedQuery,
            categoriesRemoved: true,
            indexerIds,
            limit,
            apikey: maskedKey,
            timeoutMs: config_1.config.prowlarrTimeoutMs,
            type: searchType,
        });
        const res3 = await axios_1.default.get(url.toString(), {
            params: params3,
            headers: { "X-Api-Key": config_1.config.prowlarrApiKey },
            timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000)),
        }).catch((err) => {
            console.error(`[${new Date().toISOString()}][prowlarr] fallback (no categories) failed`, {
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
        data = Array.isArray(res3.data) ? res3.data : [];
        console.log(`[${new Date().toISOString()}][prowlarr] fallback (no categories) response`, {
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
        .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || (b.size || 0) - (a.size || 0));
    const chosen = sorted[0];
    console.log(`[${new Date().toISOString()}][prowlarr] pickBestResult`, {
        inputCount: results.length,
        poolCount: pool.length,
        chosen: chosen ? { title: chosen.title, seeders: chosen.seeders, size: chosen.size } : null,
    });
    return chosen;
}
function getMagnet(r) {
    if (!r)
        return undefined;
    const direct = r.magnetUrl || r.guid || r.link;
    const ok = typeof direct === "string" && direct.startsWith("magnet:");
    console.log(`[${new Date().toISOString()}][prowlarr] getMagnet`, { hasCandidate: !!direct, ok });
    if (ok)
        return direct;
    // Try to build a magnet from info hash if present
    const hashCand = (r.infoHash || r.infohash || r.hash || "").toString().trim();
    if (hashCand) {
        // Accept 40-hex or 32-base32 hashes
        const hex40 = /^[a-fA-F0-9]{40}$/;
        const b32 = /^[A-Z2-7]{32,39}$/i; // some providers use longer base32
        if (hex40.test(hashCand) || b32.test(hashCand)) {
            const hashUpper = hashCand.toUpperCase();
            const dn = r.title ? `&dn=${encodeURIComponent(r.title)}` : "";
            const built = `magnet:?xt=urn:btih:${hashUpper}${dn}`;
            console.log(`[${new Date().toISOString()}][prowlarr] getMagnet built from infoHash`, { built: true });
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
    const base = config_1.config.prowlarrUrl.replace(/\/$/, "");
    const candidate = r.downloadUrl || r.download || r.downloadurl || r.download_link || r.link;
    let url = typeof candidate === 'string' ? absoluteUrl(candidate, base) : '';
    if (!url || !(url.startsWith('http://') || url.startsWith('https://')))
        return undefined;
    const maxHops = Math.max(1, Math.min(Number(config_1.config.prowlarrRedirectMaxHops || 5), 10));
    let hops = 0;
    while (hops < maxHops && url && (url.startsWith('http://') || url.startsWith('https://'))) {
        hops++;
        let resp;
        try {
            resp = await axios_1.default.head(url, { headers: { 'X-Api-Key': config_1.config.prowlarrApiKey }, maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000)) });
        }
        catch {
            try {
                resp = await axios_1.default.get(url, { headers: { 'X-Api-Key': config_1.config.prowlarrApiKey }, maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config_1.config.prowlarrTimeoutMs || 15000, 120000)) });
            }
            catch (e) {
                console.warn(`[${new Date().toISOString()}][prowlarr] resolveMagnet failed`, { url, err: e?.message });
                return undefined;
            }
        }
        const status = resp?.status || 0;
        const location = String(resp?.headers?.location || '');
        const ctype = String(resp?.headers?.['content-type'] || '').toLowerCase();
        if (status >= 300 && status < 400 && location) {
            if (isMagnet(location)) {
                console.log(`[${new Date().toISOString()}][prowlarr] resolveMagnet redirect->magnet`, { hops, hash: (location.match(/btih:([^&]+)/i) || [])[1] });
                return location;
            }
            url = absoluteUrl(location, base);
            if (url.endsWith('.torrent')) {
                console.log(`[${new Date().toISOString()}][prowlarr] resolveMagnet redirect->torrent`, { hops, url });
                return undefined;
            }
            continue;
        }
        if (ctype.includes('bittorrent') || url.endsWith('.torrent')) {
            console.log(`[${new Date().toISOString()}][prowlarr] resolveMagnet content-type torrent`, { url });
            return undefined;
        }
        break;
    }
    return undefined;
}
