import axios from "axios";
import { config } from "./config";

export type ProwlarrResult = {
  title?: string;
  guid?: string;
  magnetUrl?: string;
  link?: string;
  downloadUrl?: string;
  seeders?: number;
  leechers?: number;
  size?: number;
  indexer?: string;
  categories?: number[] | string[];
  [key: string]: any;
};

export async function testProwlarrConnection(): Promise<boolean> {
  try {
    const base = config.prowlarrUrl?.replace(/\/$/, "");
    if (!base || !config.prowlarrApiKey) return false;
    
    const started = Date.now();
    console.log(`[${new Date().toISOString()}][prowlarr] testing connection to ${base}`, { timeoutMs: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 10000, 60000)) });
    
    const res = await axios.get(`${base}/api/v1/indexer`, {
      headers: { "X-Api-Key": config.prowlarrApiKey },
      timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 10000, 60000)),
    });
    
    console.log(`[${new Date().toISOString()}][prowlarr] connection test successful`, {
      ms: Date.now() - started,
      indexerCount: Array.isArray(res.data) ? res.data.length : 0
    });
    return true;
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][prowlarr] connection test failed`, {
      error: err?.message || String(err),
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
    });
    return false;
  }
}

export async function searchProwlarr(query: string, opts?: {
  categories?: string[];
  indexerIds?: string[];
  limit?: number;
}): Promise<ProwlarrResult[]> {
  if (!config.prowlarrUrl || !config.prowlarrApiKey) {
    throw new Error("Prowlarr not configured. Set PROWLARR_URL and PROWLARR_API_KEY.");
  }

  const base = config.prowlarrUrl.replace(/\/$/, "");
  const url = new URL("/api/v1/search", base);
  const originalQuery = String(query || "");
  const stripTmdb = (q: string) => q.replace(/\s*TMDB\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
  const withoutTmdb = stripTmdb(originalQuery);
  const usedQuery = withoutTmdb || originalQuery;
  const params: any = { query: usedQuery };
  const searchType = 'search';
  params.type = searchType;
  const categories = (opts?.categories?.length ? opts.categories : (config.prowlarrCategories?.length ? config.prowlarrCategories : undefined));
  if (categories?.length) params.categories = categories.join(",");
  const indexerIds = (opts?.indexerIds?.length ? opts.indexerIds : (config.prowlarrIndexerIds?.length ? config.prowlarrIndexerIds : undefined));
  if (indexerIds?.length) params.indexerIds = indexerIds.join(",");
  const limit = opts?.limit ?? (Number.isFinite(config.prowlarrSearchLimit) ? config.prowlarrSearchLimit : undefined);
  if (limit) params.limit = limit;

  const maskedKey = config.prowlarrApiKey ? `${config.prowlarrApiKey.slice(0, 4)}…` : "unset";
  const started = Date.now();
  console.log(`[${new Date().toISOString()}][prowlarr] GET ${url.toString()}`, {
    query: originalQuery,
    usedQuery,
    categories,
    indexerIds,
    limit,
    apikey: maskedKey,
    timeoutMs: config.prowlarrTimeoutMs,
    type: searchType,
  });
  
  const res = await axios.get<ProwlarrResult[]>(url.toString(), {
    params,
    headers: { "X-Api-Key": config.prowlarrApiKey },
    timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000)),
  }).catch((err: any) => {
    console.error(`[${new Date().toISOString()}][prowlarr] request failed`, {
      query,
      error: err?.message || String(err),
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      url: url.toString(),
      timeout: `${Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000))}ms`
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
      const params2: any = { ...params, query: withoutYear };
      console.log(`[${new Date().toISOString()}][prowlarr] fallback GET ${url.toString()}`, {
        originalQuery,
        usedQuery,
        fallbackQuery: withoutYear,
        categories,
        indexerIds,
        limit,
        apikey: maskedKey,
        timeoutMs: config.prowlarrTimeoutMs,
        type: searchType,
      });
      const res2 = await axios.get<ProwlarrResult[]>(url.toString(), {
        params: params2,
        headers: { "X-Api-Key": config.prowlarrApiKey },
        timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000)),
      }).catch((err: any) => {
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
    const params3: any = { ...params };
    delete params3.categories;
    console.log(`[${new Date().toISOString()}][prowlarr] fallback (no categories) GET ${url.toString()}`, {
      originalQuery,
      usedQuery,
      categoriesRemoved: true,
      indexerIds,
      limit,
      apikey: maskedKey,
      timeoutMs: config.prowlarrTimeoutMs,
      type: searchType,
    });
    const res3 = await axios.get<ProwlarrResult[]>(url.toString(), {
      params: params3,
      headers: { "X-Api-Key": config.prowlarrApiKey },
      timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000)),
    }).catch((err: any) => {
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

export function pickBestResult(results: ProwlarrResult[]): ProwlarrResult | undefined {
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

export function getMagnet(r: ProwlarrResult | undefined): string | undefined {
  if (!r) return undefined;
  const magnet = r.magnetUrl || r.guid || r.link;
  const ok = typeof magnet === "string" && magnet.startsWith("magnet:");
  console.log(`[${new Date().toISOString()}][prowlarr] getMagnet`, { hasCandidate: !!magnet, ok });
  if (ok) return magnet;
  return undefined;
}

function isMagnet(s: any): s is string {
  return typeof s === 'string' && s.startsWith('magnet:');
}

function absoluteUrl(u: string, base: string): string {
  try { return new URL(u, base).toString(); } catch { return u; }
}

export async function getMagnetOrResolve(r: ProwlarrResult | undefined): Promise<string | undefined> {
  if (!r) return undefined;
  const direct = getMagnet(r);
  if (direct) return direct;
  const base = config.prowlarrUrl.replace(/\/$/, "");
  const candidate = (r as any).downloadUrl || (r as any).download || (r as any).downloadurl || (r as any).download_link || (r as any).link;
  let url = typeof candidate === 'string' ? absoluteUrl(candidate, base) : '';
  if (!url || !(url.startsWith('http://') || url.startsWith('https://'))) return undefined;

  const maxHops = Math.max(1, Math.min(Number(config.prowlarrRedirectMaxHops || 5), 10));
  let hops = 0;
  while (hops < maxHops && url && (url.startsWith('http://') || url.startsWith('https://'))) {
    hops++;
    let resp: any;
    try {
      resp = await axios.head(url, { headers: { 'X-Api-Key': config.prowlarrApiKey }, maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000)) });
    } catch {
      try {
        resp = await axios.get(url, { headers: { 'X-Api-Key': config.prowlarrApiKey }, maxRedirects: 0, validateStatus: () => true, timeout: Math.max(5000, Math.min(config.prowlarrTimeoutMs || 15000, 120000)) });
      } catch (e) {
        console.warn(`[${new Date().toISOString()}][prowlarr] resolveMagnet failed`, { url, err: (e as any)?.message });
        return undefined;
      }
    }
    const status = resp?.status || 0;
    const location = String(resp?.headers?.location || '');
    const ctype = String(resp?.headers?.['content-type'] || '').toLowerCase();
    if (status >= 300 && status < 400 && location) {
      if (isMagnet(location)) {
        console.log(`[${new Date().toISOString()}][prowlarr] resolveMagnet redirect->magnet`, { hops, hash: (location.match(/btih:([^&]+)/i)||[])[1] });
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

