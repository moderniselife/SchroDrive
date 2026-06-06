/**
 * SchroDrive — Real-Debrid API Client
 *
 * Provides functions for interacting with the Real-Debrid debrid service API.
 * Handles listing torrents (with pagination and streaming), adding magnets,
 * selecting files, listing downloads, and checking torrent status.
 *
 * All requests are rate-limited via the shared {@link rateLimiter} singleton,
 * with automatic caching of successful responses to serve during backoff periods.
 * HTTP agents are forced to IPv4 to avoid IPv6 timeout issues in Docker containers.
 *
 * @module realdebrid
 */

import axios from "axios";
import https from "https";
import http from "http";
import { config } from "./config";
import { rateLimiter } from "./rateLimiter";

// ===========================================================================
// Constants & HTTP Configuration
// ===========================================================================

const PROVIDER_NAME = "realdebrid";

// Force IPv4 to avoid IPv6 timeout issues in Docker containers
const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosIPv4 = axios.create({ httpAgent, httpsAgent });

// ===========================================================================
// Configuration & Status Helpers
// ===========================================================================

/**
 * Checks whether Real-Debrid is configured with a valid access token.
 *
 * @returns `true` if the RD access token is set in the configuration.
 */
export function isRDConfigured(): boolean {
  return !!config.rdAccessToken;
}

/**
 * Checks whether Real-Debrid API requests are currently rate-limited.
 *
 * @returns `true` if the provider is in a backoff period.
 */
export function isRDRateLimited(): boolean {
  return rateLimiter.isRateLimited(PROVIDER_NAME);
}

/**
 * Returns the remaining wait time (in seconds) before Real-Debrid requests
 * can resume after a rate limit.
 *
 * @returns Remaining wait time in seconds, or 0 if not rate-limited.
 */
export function getRDWaitTime(): number {
  return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}

/**
 * Builds the authorisation headers required for Real-Debrid API requests.
 *
 * @returns A headers object containing the Bearer token.
 */
function rdHeaders() {
  return { Authorization: `Bearer ${config.rdAccessToken}` } as Record<string, string>;
}

// ===========================================================================
// Torrent Operations
// ===========================================================================

const RD_TORRENT_LIST_CACHE_KEY = "realdebrid_torrents";

/**
 * Fetches the complete list of torrents from Real-Debrid, paginating
 * through all available results. Returns cached data when rate-limited
 * or on error.
 *
 * The RD API allows a maximum page size of 2500 items. Each page request
 * is throttled to respect rate limits.
 *
 * @returns An array of torrent objects from the RD API.
 */
export async function listRDTorrents(): Promise<any[]> {
  if (!isRDConfigured()) return [];
  
  // Check rate limit before making request - return cached data if available
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const cached = rateLimiter.getCache<any[]>(RD_TORRENT_LIST_CACHE_KEY);
    if (cached) {
      console.warn(`[${new Date().toISOString()}][rd] rate limited, returning cached list (${cached.length} items, wait ${waitTime}s)`);
      return cached;
    }
    console.warn(`[${new Date().toISOString()}][rd] rate limited, no cache available (wait ${waitTime}s)`);
    return [];
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const allTorrents: any[] = [];
  let page = 1;
  const limit = 2500; // Max allowed by RD API
  
  try {
    // Paginate through all results
    while (true) {
      const url = `${base}/torrents?limit=${limit}&page=${page}`;
      const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      
      const arr = Array.isArray(res?.data) ? res.data : [];
      allTorrents.push(...arr);
      
      // If we got less than the limit, we've reached the end
      if (arr.length < limit) {
        break;
      }
      
      page++;
      // Throttle between pages to avoid rate limits
      await rateLimiter.throttle(PROVIDER_NAME);
    }
    
    // Cache the successful result
    rateLimiter.setCache(RD_TORRENT_LIST_CACHE_KEY, allTorrents);
    console.log(`[${new Date().toISOString()}][rd] fetched ${allTorrents.length} torrents (${page} page(s))`);
    return allTorrents;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const isNetworkError = err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || 
                           err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
                           errorMsg.includes('timeout') || errorMsg.includes('network');
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][rd] list torrents failed`, {
      error: errorMsg,
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      isNetworkError,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    
    // Return cached data on error if available
    const cached = rateLimiter.getCache<any[]>(RD_TORRENT_LIST_CACHE_KEY);
    if (cached) {
      console.log(`[${new Date().toISOString()}][rd] returning cached list on error (${cached.length} items)`);
      return cached;
    }
    return [];
  }
}

/**
 * Async generator that yields torrent pages as they are fetched from Real-Debrid.
 * Uses smaller page sizes (100) for faster initial delivery in SSE streaming contexts.
 *
 * Falls back to cached data when rate-limited.
 *
 * @yields Arrays of torrent objects, one array per page.
 */
export async function* listRDTorrentsStream(): AsyncGenerator<any[], void, unknown> {
  if (!isRDConfigured()) return;
  
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const cached = rateLimiter.getCache<any[]>(RD_TORRENT_LIST_CACHE_KEY);
    if (cached) {
      yield cached;
    }
    return;
  }

  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  let page = 1;
  const limit = 100; // Use smaller pages for faster streaming
  
  try {
    while (true) {
      const url = `${base}/torrents?limit=${limit}&page=${page}`;
      const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      
      const arr = Array.isArray(res?.data) ? res.data : [];
      if (arr.length > 0) {
        yield arr;
      }
      
      if (arr.length < limit) break;
      page++;
      await rateLimiter.throttle(PROVIDER_NAME);
    }
  } catch (err: any) {
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, err?.message);
    }
    console.error(`[${new Date().toISOString()}][rd] list torrents stream failed`, err?.message);
  }
}

/**
 * Adds a magnet link to Real-Debrid for downloading.
 *
 * Sends the magnet as a URL-encoded form POST to the RD API.
 * Throws if rate-limited or if the API request fails.
 *
 * @param magnet - The magnet URI to add.
 * @returns An object containing the torrent `id` and `uri` from the RD response.
 * @throws {Error} If the provider is rate-limited or the request fails.
 */
export async function addMagnetToRD(magnet: string): Promise<{ id?: string; uri?: string }> {
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const error = new Error(`Real-Debrid rate limited, retry in ${waitTime}s`);
    console.warn(`[${new Date().toISOString()}][rd] rate limited, cannot add magnet (wait ${waitTime}s)`);
    throw error;
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/addMagnet`;
  const params = new URLSearchParams();
  params.set("magnet", magnet);
  
  try {
    const res = await axiosIPv4.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    return res.data || {};
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][rd] add magnet failed`, {
      error: errorMsg,
      status: err?.response?.status,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    throw err;
  }
}

/**
 * Selects all files within a Real-Debrid torrent for download.
 *
 * Called after adding a magnet to ensure all files in the torrent
 * are queued for retrieval by the debrid service.
 *
 * @param id - The Real-Debrid torrent ID to select files for.
 */
export async function selectAllFilesRD(id: string): Promise<void> {
  if (!id) return;
  
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping select files (wait ${waitTime}s)`);
    return;
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
  const params = new URLSearchParams();
  params.set("files", "all");
  
  try {
    await axiosIPv4.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.warn(`[${new Date().toISOString()}][rd] select all files failed`, {
      id,
      error: errorMsg,
      status: err?.response?.status,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
  }
}

/**
 * Determines whether a Real-Debrid torrent is considered "dead" (failed or errored).
 *
 * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
 * considered dead if its status contains "error" or "dead".
 *
 * @param t - The torrent object from the RD API.
 * @returns `true` if the torrent is dead/failed.
 */
export function isRDTorrentDead(t: any): boolean {
  const s = String(t?.status || "").toLowerCase();
  // Completed torrents are never dead, regardless of status string
  if (typeof t?.progress === "number" && t.progress >= 100) return false;
  if (s.includes("error") || s.includes("dead")) return true;
  return false;
}

// ===========================================================================
// Download Operations
// ===========================================================================

const RD_DOWNLOADS_CACHE_KEY = "realdebrid_downloads";

/**
 * Fetches the complete list of downloads from Real-Debrid, paginating
 * through all available results. Returns cached data when rate-limited
 * or on error.
 *
 * Downloads represent completed/unrestricted files available for direct
 * download from the RD CDN.
 *
 * @returns An array of download objects from the RD API.
 */
export async function listRDDownloads(): Promise<any[]> {
  if (!isRDConfigured()) return [];
  
  // Check rate limit before making request - return cached data if available
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const cached = rateLimiter.getCache<any[]>(RD_DOWNLOADS_CACHE_KEY);
    if (cached) {
      console.warn(`[${new Date().toISOString()}][rd] rate limited, returning cached downloads (${cached.length} items, wait ${waitTime}s)`);
      return cached;
    }
    console.warn(`[${new Date().toISOString()}][rd] rate limited, no cache available (wait ${waitTime}s)`);
    return [];
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const allDownloads: any[] = [];
  let page = 1;
  const limit = 2500; // Max allowed by RD API
  
  try {
    // Paginate through all results
    while (true) {
      const url = `${base}/downloads?limit=${limit}&page=${page}`;
      const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      
      const arr = Array.isArray(res?.data) ? res.data : [];
      allDownloads.push(...arr);
      
      // If we got less than the limit, we've reached the end
      if (arr.length < limit) {
        break;
      }
      
      page++;
      // Throttle between pages to avoid rate limits
      await rateLimiter.throttle(PROVIDER_NAME);
    }
    
    // Cache the successful result
    rateLimiter.setCache(RD_DOWNLOADS_CACHE_KEY, allDownloads);
    console.log(`[${new Date().toISOString()}][rd] fetched ${allDownloads.length} downloads (${page} page(s))`);
    return allDownloads;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const isNetworkError = err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || 
                           err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
                           errorMsg.includes('timeout') || errorMsg.includes('network');
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][rd] list downloads failed`, {
      error: errorMsg,
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      isNetworkError,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    
    // Return cached data on error if available
    const cached = rateLimiter.getCache<any[]>(RD_DOWNLOADS_CACHE_KEY);
    if (cached) {
      console.log(`[${new Date().toISOString()}][rd] returning cached downloads on error (${cached.length} items)`);
      return cached;
    }
    return [];
  }
}

/**
 * Async generator that yields download pages as they are fetched from Real-Debrid.
 * Uses smaller page sizes (100) for faster initial delivery in SSE streaming contexts.
 *
 * Falls back to cached data when rate-limited.
 *
 * @yields Arrays of download objects, one array per page.
 */
export async function* listRDDownloadsStream(): AsyncGenerator<any[], void, unknown> {
  if (!isRDConfigured()) return;
  
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const cached = rateLimiter.getCache<any[]>(RD_DOWNLOADS_CACHE_KEY);
    if (cached) {
      yield cached;
    }
    return;
  }

  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  let page = 1;
  const limit = 100; // Use smaller pages for faster streaming
  
  try {
    while (true) {
      const url = `${base}/downloads?limit=${limit}&page=${page}`;
      const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
      rateLimiter.recordSuccess(PROVIDER_NAME);
      
      const arr = Array.isArray(res?.data) ? res.data : [];
      if (arr.length > 0) {
        yield arr;
      }
      
      if (arr.length < limit) break;
      page++;
      await rateLimiter.throttle(PROVIDER_NAME);
    }
  } catch (err: any) {
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, err?.message);
    }
    console.error(`[${new Date().toISOString()}][rd] list downloads stream failed`, err?.message);
  }
}
