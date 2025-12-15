import { TorboxClient } from "node-torbox-api";
import { config, requireEnv } from "./config";
import { rateLimiter } from "./rateLimiter";

let client: TorboxClient | null = null as any;

function getClient(): TorboxClient {
  requireEnv("torboxApiKey");
  if (!client) {
    const maskedKey = config.torboxApiKey ? `${config.torboxApiKey.slice(0, 4)}…` : "unset";
    console.log(`[${new Date().toISOString()}][torbox] init client`, { baseURL: config.torboxBaseUrl, apiKey: maskedKey });
    client = new TorboxClient({ apiKey: config.torboxApiKey, baseURL: config.torboxBaseUrl });
  }
  return client;
}

const PROVIDER_NAME = "torbox";

export function isTorboxRateLimited(): boolean {
  return rateLimiter.isRateLimited(PROVIDER_NAME);
}

export function getTorboxWaitTime(): number {
  return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}

export async function checkExistingTorrents(searchTitle: string): Promise<boolean> {
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    console.warn(`[${new Date().toISOString()}][torbox] rate limited, skipping check (wait ${waitTime}s)`);
    return false; // Assume doesn't exist to avoid blocking
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const c = getClient();
  console.log(`[${new Date().toISOString()}][torbox] checking existing torrents`, { searchTitle });
  const started = Date.now();
  
  try {
    // Get all torrents and filter them locally since the API doesn't support search
    const res = await c.torrents.getTorrentList({ 
      limit: 100 // Get more torrents to check against
    });
    
    // Record success
    rateLimiter.recordSuccess(PROVIDER_NAME);
    
    // Handle both single torrent and array responses
    const existingTorrents = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
    console.log(`[${new Date().toISOString()}][torbox] existing torrents check`, { 
      searchTitle, 
      count: existingTorrents.length,
      ms: Date.now() - started 
    });
    
    // Check if any existing torrent matches our search title
    // We'll do a case-insensitive contains check
    const normalizedSearch = searchTitle.toLowerCase();
    const hasExisting = existingTorrents.some((torrent: any) => {
      const torrentName = (torrent.name || '').toLowerCase();
      return torrentName.includes(normalizedSearch) || normalizedSearch.includes(torrentName);
    });
    
    if (hasExisting) {
      console.log(`[${new Date().toISOString()}][torbox] found existing torrent`, { 
        searchTitle,
        existingNames: existingTorrents.slice(0, 3).map((t: any) => t.name)
      });
    }
    
    return hasExisting;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err)) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] existing torrents check failed`, {
      searchTitle,
      error: errorMsg,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
    });
    // If we can't check existing torrents, assume it doesn't exist to avoid missing content
    return false;
  }
}

export async function addMagnetToTorbox(magnet: string, name?: string) {
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const error = new Error(`TorBox rate limited, retry in ${waitTime}s`);
    console.warn(`[${new Date().toISOString()}][torbox] rate limited, cannot add magnet (wait ${waitTime}s)`);
    throw error;
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const c = getClient();
  const teaser = magnet.slice(0, 80) + '...';
  console.log(`[${new Date().toISOString()}][torbox] createTorrent`, { name, teaser });
  const started = Date.now();
  
  try {
    const res = await c.torrents.createTorrent({ magnet, name });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    console.log(`[${new Date().toISOString()}][torbox] createTorrent done`, { ms: Date.now() - started });
    return res;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err)) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] createTorrent failed`, {
      name,
      teaser,
      error: errorMsg,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    throw err;
  }
}

const TORRENT_LIST_CACHE_KEY = "torbox_torrents";

export async function listTorboxTorrents(): Promise<any[]> {
  // Check rate limit before making request - return cached data if available
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
      return cached;
    }
    console.warn(`[${new Date().toISOString()}][torbox] rate limited, no cache available (wait ${waitTime}s)`);
    return [];
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const c = getClient();
  try {
    const res = await c.torrents.getTorrentList({ limit: 100 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
    // Cache the successful result
    rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, list);
    return list as any[];
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err)) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] list torrents failed`, {
      error: errorMsg,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    
    // Return cached data on error if available
    const cached = rateLimiter.getCache<any[]>(TORRENT_LIST_CACHE_KEY);
    if (cached) {
      console.log(`[${new Date().toISOString()}][torbox] returning cached list on error (${cached.length} items)`);
      return cached;
    }
    return [];
  }
}

export function isTorboxTorrentDead(t: any): boolean {
  const status = String(t?.status || t?.state || "").toLowerCase();
  if (typeof t?.progress === "number" && t.progress >= 100) return false;
  if (status.includes("failed")) return true;
  if (status.includes("stalled")) return true;
  if (status.includes("inactive")) return true;
  return false;
}
