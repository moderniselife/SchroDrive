import axios from "axios";
import { config } from "./config";

export type ProwlarrResult = {
  title?: string;
  guid?: string;
  magnetUrl?: string;
  link?: string;
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
  const params: any = { query };
  const categories = (opts?.categories?.length ? opts.categories : (config.prowlarrCategories?.length ? config.prowlarrCategories : undefined));
  if (categories?.length) params.categories = categories.join(",");
  const indexerIds = (opts?.indexerIds?.length ? opts.indexerIds : (config.prowlarrIndexerIds?.length ? config.prowlarrIndexerIds : undefined));
  if (indexerIds?.length) params.indexerIds = indexerIds.join(",");
  const limit = opts?.limit ?? (Number.isFinite(config.prowlarrSearchLimit) ? config.prowlarrSearchLimit : undefined);
  if (limit) params.limit = limit;

  const maskedKey = config.prowlarrApiKey ? `${config.prowlarrApiKey.slice(0, 4)}…` : "unset";
  const started = Date.now();
  console.log(`[${new Date().toISOString()}][prowlarr] GET ${url.toString()}`, {
    query,
    categories,
    indexerIds,
    limit,
    apikey: maskedKey,
    timeoutMs: config.prowlarrTimeoutMs,
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

  const data = Array.isArray(res.data) ? res.data : [];
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

