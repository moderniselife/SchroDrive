import axios from "axios";
import { config } from "./config";
import { rateLimiter } from "./rateLimiter";

const PROVIDER_NAME = "realdebrid";

export function isRDConfigured(): boolean {
  return !!config.rdAccessToken;
}

export function isRDRateLimited(): boolean {
  return rateLimiter.isRateLimited(PROVIDER_NAME);
}

export function getRDWaitTime(): number {
  return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
}

function rdHeaders() {
  return { Authorization: `Bearer ${config.rdAccessToken}` } as Record<string, string>;
}

export async function listRDTorrents(): Promise<any[]> {
  if (!isRDConfigured()) return [];
  
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    console.warn(`[${new Date().toISOString()}][rd] rate limited, returning empty list (wait ${waitTime}s)`);
    return [];
  }

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents`;
  
  try {
    const res = await axios.get(url, { headers: rdHeaders(), timeout: 20000 });
    rateLimiter.recordSuccess(PROVIDER_NAME);
    const arr = Array.isArray(res?.data) ? res?.data : [];
    return arr;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    
    // Check if this is a rate limit error
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(PROVIDER_NAME, errorMsg);
    }
    
    console.error(`[${new Date().toISOString()}][rd] list torrents failed`, {
      error: errorMsg,
      status: err?.response?.status,
      rateLimited: rateLimiter.isRateLimited(PROVIDER_NAME),
    });
    return [];
  }
}

export async function addMagnetToRD(magnet: string): Promise<{ id?: string; uri?: string }> {
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    const error = new Error(`Real-Debrid rate limited, retry in ${waitTime}s`);
    console.warn(`[${new Date().toISOString()}][rd] rate limited, cannot add magnet (wait ${waitTime}s)`);
    throw error;
  }

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/addMagnet`;
  const params = new URLSearchParams();
  params.set("magnet", magnet);
  
  try {
    const res = await axios.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
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

export async function selectAllFilesRD(id: string): Promise<void> {
  if (!id) return;
  
  // Check rate limit before making request
  if (rateLimiter.isRateLimited(PROVIDER_NAME)) {
    const waitTime = rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
    console.warn(`[${new Date().toISOString()}][rd] rate limited, skipping select files (wait ${waitTime}s)`);
    return;
  }

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
  const params = new URLSearchParams();
  params.set("files", "all");
  
  try {
    await axios.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
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

export function isRDTorrentDead(t: any): boolean {
  const s = String(t?.status || "").toLowerCase();
  if (typeof t?.progress === "number" && t.progress >= 100) return false;
  if (s.includes("error") || s.includes("dead")) return true;
  return false;
}
