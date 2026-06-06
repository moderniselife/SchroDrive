/**
 * SchroDrive — TorBox API Client
 *
 * Provides functions for interacting with the TorBox debrid service API.
 * Handles listing torrents, adding magnets, checking for existing torrents,
 * listing web/usenet downloads, and detecting plan limitation errors.
 *
 * Uses the `node-torbox-api` SDK client for torrent operations and falls
 * back to direct Axios requests for web/usenet download endpoints.
 * All requests are rate-limited via the shared {@link rateLimiter} singleton.
 *
 * @module torbox
 */

import { TorboxClient } from "node-torbox-api";
import axios from "axios";
import { config, requireEnv } from "./config";
import { rateLimiter } from "./rateLimiter";

// ===========================================================================
// Client Initialisation
// ===========================================================================

/** Lazily-initialised TorBox SDK client singleton. */
let client: TorboxClient | null = null as any;

/**
 * Returns the TorBox SDK client, initialising it on first use.
 * Requires the `torboxApiKey` environment variable to be set.
 *
 * The API key is partially masked in log output for security.
 *
 * @returns The initialised TorboxClient instance.
 * @throws {Error} If `torboxApiKey` is not configured.
 */
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

// ===========================================================================
// Plan Limitation Tracking
// ===========================================================================

/** Flag indicating the API has been disabled due to plan limitations (e.g. free tier). */
let apiDisabled = false;
/** Human-readable reason the API was disabled. */
let apiDisabledReason = "";

/**
 * Checks whether TorBox API access has been disabled due to plan limitations.
 *
 * @returns `true` if the API is disabled (user needs to upgrade their plan).
 */
export function isTorboxApiDisabled(): boolean {
  return apiDisabled;
}

/**
 * Returns the human-readable reason the TorBox API was disabled.
 *
 * @returns The disabled reason string, or empty if not disabled.
 */
export function getTorboxApiDisabledReason(): string {
  return apiDisabledReason;
}

/**
 * Inspects an error to determine if it indicates a plan limitation (HTTP 403
 * with "plan" or "upgrade" in the message). If so, permanently disables
 * further API calls until the application is restarted.
 *
 * @param err - The error object to inspect.
 * @returns `true` if the error was a plan limitation error.
 */
function checkPlanError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  if (msg.includes("403") && (msg.includes("plan") || msg.includes("upgrade"))) {
    apiDisabled = true;
    apiDisabledReason = "TorBox API requires a paid plan. Please upgrade at torbox.app";
    console.error(`[${new Date().toISOString()}][torbox] API DISABLED: ${apiDisabledReason}`);
    return true;
  }
  return false;
}

// ===========================================================================
// Rate Limit Status
// ===========================================================================

/**
 * Checks whether TorBox API requests are currently rate-limited.
 *
 * @returns `true` if the provider is in a backoff period.
 */
export function isTorboxRateLimited(): boolean {
  return rateLimiter.isRateLimited(PROVIDER_NAME);
}

/**
 * Returns the remaining wait time (in seconds) before TorBox requests
 * can resume after a rate limit.
 *
 * @returns Remaining wait time in seconds, or 0 if not rate-limited.
 */
export function getTorboxWaitTime(): number {
  return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}

// ===========================================================================
// Torrent Operations
// ===========================================================================

/**
 * Checks whether a torrent with a matching title already exists in TorBox.
 *
 * Fetches the current torrent list and performs a case-insensitive
 * substring match in both directions (search ⊂ torrent name or
 * torrent name ⊂ search) to catch partial matches.
 *
 * @param searchTitle - The title to search for among existing torrents.
 * @returns `true` if a matching torrent already exists.
 */
export async function checkExistingTorrents(searchTitle: string): Promise<boolean> {
  // Check if API is disabled due to plan limitations
  if (apiDisabled) {
    return false;
  }
  
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
    // Bi-directional case-insensitive substring match
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
    
    // Check if this is a plan limitation error
    if (checkPlanError(err)) {
      return false;
    }
    
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

/**
 * Adds a magnet link to TorBox for downloading.
 *
 * Throws if the API is disabled (plan limitation), rate-limited,
 * or if the SDK request fails.
 *
 * @param magnet - The magnet URI to add.
 * @param name - Optional human-readable name for the torrent.
 * @returns The response from the TorBox `createTorrent` API call.
 * @throws {Error} If the API is disabled, rate-limited, or the request fails.
 */
export async function addMagnetToTorbox(magnet: string, name?: string) {
  // Check if API is disabled due to plan limitations
  if (apiDisabled) {
    throw new Error(apiDisabledReason);
  }
  
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
    
    // Check if this is a plan limitation error
    checkPlanError(err);
    
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

/**
 * Fetches the list of torrents from TorBox. Returns cached data when
 * rate-limited or on error.
 *
 * @returns An array of torrent objects from the TorBox API.
 */
export async function listTorboxTorrents(): Promise<any[]> {
  // Check if API is disabled due to plan limitations
  if (apiDisabled) {
    return [];
  }
  
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
    // API may return a single object or an array — normalise to array
    const list = Array.isArray(res?.data) ? res.data : [res?.data].filter(Boolean);
    // Cache the successful result
    rateLimiter.setCache(TORRENT_LIST_CACHE_KEY, list);
    return list as any[];
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    const isNetworkError = err?.code === 'ECONNREFUSED' || err?.code === 'ENOTFOUND' || 
                           err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' ||
                           errorMsg.includes('timeout') || errorMsg.includes('network');
    
    // Check if this is a plan limitation error
    if (checkPlanError(err)) {
      return [];
    }
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] list torrents failed`, {
      error: errorMsg,
      code: err?.code,
      status: err?.response?.status,
      statusText: err?.response?.statusText,
      isNetworkError,
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

/**
 * Determines whether a TorBox torrent is considered "dead" (failed, stalled, or inactive).
 *
 * A torrent is NOT dead if its progress has reached 100%. Otherwise, it is
 * considered dead if its status contains "failed", "stalled", or "inactive".
 *
 * @param t - The torrent object from the TorBox API.
 * @returns `true` if the torrent is dead/failed.
 */
export function isTorboxTorrentDead(t: any): boolean {
  const status = String(t?.status || t?.state || "").toLowerCase();
  // Completed torrents are never dead, regardless of status string
  if (typeof t?.progress === "number" && t.progress >= 100) return false;
  if (status.includes("failed")) return true;
  if (status.includes("stalled")) return true;
  if (status.includes("inactive")) return true;
  return false;
}

// ===========================================================================
// Download Operations
// ===========================================================================

/**
 * Builds the authorisation headers required for direct TorBox API requests
 * (used for endpoints not covered by the SDK client).
 *
 * @returns A headers object containing the Bearer token.
 */
function torboxHeaders() {
  return { Authorization: `Bearer ${config.torboxApiKey}` };
}

const WEB_DOWNLOADS_CACHE_KEY = "torbox_webdownloads";
const USENET_DOWNLOADS_CACHE_KEY = "torbox_usenetdownloads";

/**
 * Fetches the list of web downloads from TorBox.
 * Uses the direct REST API (not the SDK) as this endpoint isn't
 * covered by the `node-torbox-api` package.
 *
 * Returns cached data when rate-limited or on error.
 *
 * @returns An array of web download objects from the TorBox API.
 */
export async function listTorboxWebDownloads(): Promise<any[]> {
  if (!config.torboxApiKey) return [];
  
  // Check if API is disabled due to plan limitations
  if (apiDisabled) {
    return [];
  }
  
  // Check rate limit before making request - return cached data if available
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const cached = rateLimiter.getCache<any[]>(WEB_DOWNLOADS_CACHE_KEY);
    if (cached) {
      console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached web downloads (${cached.length} items, wait ${waitTime}s)`);
      return cached;
    }
    console.warn(`[${new Date().toISOString()}][torbox] rate limited, no web downloads cache (wait ${waitTime}s)`);
    return [];
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");
  const url = `${base}/v1/api/webdl/mylist`;
  
  try {
    const res = await axios.get(url, { headers: torboxHeaders(), timeout: 20000 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    // TorBox wraps the list in a nested `data.data` structure
    const list = Array.isArray(res?.data?.data) ? res.data.data : [];
    rateLimiter.setCache(WEB_DOWNLOADS_CACHE_KEY, list);
    return list;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a plan limitation error
    if (checkPlanError(err)) {
      return [];
    }
    
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] list web downloads failed`, {
      error: errorMsg,
      status: err?.response?.status,
    });
    
    const cached = rateLimiter.getCache<any[]>(WEB_DOWNLOADS_CACHE_KEY);
    if (cached) return cached;
    return [];
  }
}

/**
 * Fetches the list of Usenet downloads from TorBox.
 * Uses the direct REST API (not the SDK) as this endpoint isn't
 * covered by the `node-torbox-api` package.
 *
 * Returns cached data when rate-limited or on error.
 *
 * @returns An array of Usenet download objects from the TorBox API.
 */
export async function listTorboxUsenetDownloads(): Promise<any[]> {
  if (!config.torboxApiKey) return [];
  
  // Check if API is disabled due to plan limitations
  if (apiDisabled) {
    return [];
  }
  
  // Check rate limit before making request - return cached data if available
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const cached = rateLimiter.getCache<any[]>(USENET_DOWNLOADS_CACHE_KEY);
    if (cached) {
      console.warn(`[${new Date().toISOString()}][torbox] rate limited, returning cached usenet downloads (${cached.length} items, wait ${waitTime}s)`);
      return cached;
    }
    console.warn(`[${new Date().toISOString()}][torbox] rate limited, no usenet downloads cache (wait ${waitTime}s)`);
    return [];
  }

  // Throttle to prevent hammering API
  await rateLimiter.throttle(PROVIDER_NAME);

  const base = (config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");
  const url = `${base}/v1/api/usenet/mylist`;
  
  try {
    const res = await axios.get(url, { headers: torboxHeaders(), timeout: 20000 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    // TorBox wraps the list in a nested `data.data` structure
    const list = Array.isArray(res?.data?.data) ? res.data.data : [];
    rateLimiter.setCache(USENET_DOWNLOADS_CACHE_KEY, list);
    return list;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a plan limitation error
    if (checkPlanError(err)) {
      return [];
    }
    
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][torbox] list usenet downloads failed`, {
      error: errorMsg,
      status: err?.response?.status,
    });
    
    const cached = rateLimiter.getCache<any[]>(USENET_DOWNLOADS_CACHE_KEY);
    if (cached) return cached;
    return [];
  }
}
