/**
 * SchroDrive — WebDAV Translation Bridge
 *
 * A built-in WebDAV server that translates debrid provider REST APIs into a
 * virtual filesystem that rclone can mount. Each provider gets its own server
 * instance on a dedicated port.
 *
 * Architecture:
 * - RealDebrid: `http://localhost:9115`
 * - TorBox: `http://localhost:9116`
 *
 * The bridge implements only the WebDAV methods rclone requires:
 * OPTIONS, PROPFIND, GET, and HEAD. File downloads are served as 302 redirects
 * to the provider's CDN URLs, keeping bandwidth off the local machine.
 *
 * Caching strategy:
 * - Torrent/directory listing: cached for 30s (configurable)
 * - Download URLs: cached for 5min (configurable) since CDN URLs expire
 *
 * @module webdavBridge
 */

import express, { type Request, type Response, type NextFunction } from "express";
import http from "http";
import https from "https";
import axios from "axios";
import { config } from "../core/config";
import { rateLimiter } from "../core/rateLimiter";
import { registry } from "../providers";
import {
  upsertDeadTorrent,
  removeDeadTorrent as removeDeadTorrentFromDb,
  getAllDeadTorrents,
  getDeadTorrent,
} from "../core/db";

// ===========================================================================
// HTTP Client (IPv4 forced — matches realdebrid.ts pattern)
// ===========================================================================

const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosIPv4 = axios.create({ httpAgent, httpsAgent });

// ===========================================================================
// Types & Interfaces
// ===========================================================================

/** Configuration options for a WebDAV bridge instance. */
export interface WebDAVBridgeOptions {
  /** Which debrid provider this bridge serves. */
  provider: string;
  /** Local port to listen on. */
  port: number;
  /** How long (seconds) to cache the torrent/directory listing. Default: 30. */
  cacheTtlS?: number;
  /** How long (seconds) to cache resolved download URLs. Default: 300 (5 min). */
  downloadCacheTtlS?: number;
}

/** Runtime status snapshot for a bridge instance. */
export interface BridgeStatus {
  /** Provider name this bridge serves. */
  provider: string;
  /** Whether the HTTP server is currently listening. */
  running: boolean;
  /** Port the server is bound to. */
  port: number;
  /** Number of torrents currently cached in the directory listing. */
  cachedTorrents: number;
  /** Total number of individual files cached across all torrents. */
  cachedFiles: number;
  /** Number of download URLs currently cached. */
  cachedUrls: number;
  /** ISO timestamp of the last successful directory refresh, or null. */
  lastRefresh: string | null;
}

/** A virtual directory representing a single torrent. */
interface VirtualDirectory {
  /** Unique torrent identifier from the provider. */
  id: string;
  /** Sanitised torrent name, safe for filesystem paths. */
  name: string;
  /** Original unsanitised torrent name. */
  originalName: string;
  /** Files within this torrent. */
  files: VirtualFile[];
}

/** A virtual file within a torrent directory. */
interface VirtualFile {
  /** File identifier (provider-specific). */
  id: string;
  /** Sanitised filename, safe for filesystem paths. */
  name: string;
  /** File size in bytes. */
  size: number;
  /** Index of this file's corresponding link in the torrent's `links[]` array (RD only). */
  linkIndex?: number;
}

/** Generic cache entry with expiry tracking. */
interface CacheEntry<T> {
  /** The cached data. */
  data: T;
  /** Timestamp (ms since epoch) when this entry expires. */
  expiresAt: number;
}

/** Information about a torrent flagged as dead due to persistent download failures. */
export interface DeadTorrentInfo {
  /** Provider-side torrent identifier. */
  id: string;
  /** Original torrent name. */
  name: string;
  /** Which provider this torrent belongs to. */
  provider: string;
  /** Number of consecutive download failures. */
  failureCount: number;
  /** ISO timestamp when the torrent was flagged. */
  flaggedAt: string;
}

/**
 * Number of consecutive download failures before a torrent is flagged as dead.
 * Once flagged, the dead scanner can delete it from the provider, blacklist
 * the hash, and queue a replacement search.
 */
const DEAD_TORRENT_THRESHOLD = 10;

// ===========================================================================
// Logging Helper
// ===========================================================================

const LOG_PREFIX = "webdav-bridge";

/**
 * Emits a timestamped log message in the same format as other SchroDrive modules.
 *
 * @param provider - The provider identifier (appended to the prefix).
 * @param message - The log message.
 * @param data - Optional structured data to include.
 */
function log(provider: string, message: string, data?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}][${LOG_PREFIX}][${provider}]`;
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

/**
 * Emits a timestamped warning message.
 *
 * @param provider - The provider identifier.
 * @param message - The warning message.
 * @param data - Optional structured data.
 */
function logWarn(provider: string, message: string, data?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}][${LOG_PREFIX}][${provider}]`;
  if (data) {
    console.warn(`${prefix} ${message}`, data);
  } else {
    console.warn(`${prefix} ${message}`);
  }
}

/**
 * Emits a timestamped error message.
 *
 * @param provider - The provider identifier.
 * @param message - The error message.
 * @param data - Optional structured data.
 */
function logError(provider: string, message: string, data?: Record<string, unknown>): void {
  const prefix = `[${new Date().toISOString()}][${LOG_PREFIX}][${provider}]`;
  if (data) {
    console.error(`${prefix} ${message}`, data);
  } else {
    console.error(`${prefix} ${message}`);
  }
}

// ===========================================================================
// Filesystem Name Sanitisation
// ===========================================================================

/**
 * Sanitises a string for use as a filesystem path component.
 * Removes or replaces characters that are problematic on common filesystems
 * (Windows NTFS, macOS HFS+, Linux ext4).
 *
 * @param name - The raw name to sanitise.
 * @returns A filesystem-safe string.
 */
function sanitiseName(name: string): string {
  return name
    // Remove control characters
    .replace(/[\x00-\x1F\x7F]/g, "")
    // Replace characters illegal on Windows/macOS
    .replace(/[<>:"/\\|?*]/g, "_")
    // Collapse multiple underscores/spaces
    .replace(/_+/g, "_")
    .replace(/\s+/g, " ")
    // Trim leading/trailing dots and spaces (Windows restriction)
    .replace(/^[.\s]+|[.\s]+$/g, "")
    // Fallback if the name is now empty
    || "unnamed";
}

// ===========================================================================
// Retry Utility
// ===========================================================================

/**
 * Retries an async operation with exponential backoff.
 * Used to handle transient provider errors (423 Locked, 429 Rate Limit,
 * 503 Service Unavailable) that would otherwise cascade through rclone
 * and break FUSE mounts.
 *
 * @param fn - The async function to retry.
 * @param maxRetries - Maximum number of retry attempts.
 * @param baseDelayMs - Initial delay in milliseconds (doubles each retry).
 * @param label - Label for log messages.
 * @returns The result of the function, or null if all retries failed.
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T | null>,
  maxRetries: number,
  baseDelayMs: number,
  label: string,
): Promise<T | null> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (result !== null) return result;
      lastError = "returned null";
    } catch (err: any) {
      lastError = err?.message || String(err);
    }

    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt);
      logWarn("retry", `${label} attempt ${attempt + 1}/${maxRetries + 1} failed (${lastError}), retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  logError("retry", `${label} failed after ${maxRetries + 1} attempts: ${lastError}`);
  return null;
}

// ===========================================================================
// WebDAV XML Builders
// ===========================================================================

/**
 * Escapes special characters for safe inclusion in XML text content.
 *
 * @param str - The raw string to escape.
 * @returns The XML-safe string.
 */
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Builds a WebDAV `<D:response>` element for a collection (directory).
 *
 * @param href - The URI path for this resource.
 * @param displayName - The human-readable directory name.
 * @returns An XML string representing the directory response.
 */
function buildCollectionResponse(href: string, displayName: string): string {
  return `  <D:response>
    <D:href>${xmlEscape(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/></D:resourcetype>
        <D:displayname>${xmlEscape(displayName)}</D:displayname>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

/**
 * Builds a WebDAV `<D:response>` element for a file resource.
 *
 * @param href - The URI path for this resource.
 * @param displayName - The human-readable filename.
 * @param size - The file size in bytes.
 * @param lastModified - The last-modified date string (RFC 2822 format).
 * @returns An XML string representing the file response.
 */
function buildFileResponse(href: string, displayName: string, size: number, lastModified: string): string {
  return `  <D:response>
    <D:href>${xmlEscape(href)}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:displayname>${xmlEscape(displayName)}</D:displayname>
        <D:getcontentlength>${size}</D:getcontentlength>
        <D:getlastmodified>${lastModified}</D:getlastmodified>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

/**
 * Wraps an array of `<D:response>` elements in a `<D:multistatus>` envelope.
 *
 * @param responses - Array of XML response strings.
 * @returns The complete WebDAV multistatus XML document.
 */
function buildMultistatus(responses: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
${responses.join("\n")}
</D:multistatus>`;
}

// ===========================================================================
// Bridge Cache
// ===========================================================================

/**
 * In-memory cache for the WebDAV bridge.
 * Separates torrent listing, per-torrent file details, and download URLs
 * with independent TTLs to balance freshness against API rate limits.
 */
class BridgeCache {
  /** Cached virtual directory listing (all torrents). */
  private torrentListCache: CacheEntry<VirtualDirectory[]> | null = null;

  /** Per-torrent file details, keyed by torrent ID. */
  private torrentInfoCache: Map<string, CacheEntry<VirtualFile[]>> = new Map();

  /** Resolved download URLs, keyed by `{torrentId}:{fileId}`. */
  private downloadUrlCache: Map<string, CacheEntry<string>> = new Map();

  /**
   * Stale download URL cache — keeps expired URLs as a fallback.
   * RealDebrid CDN URLs typically live 6-12 hours, so expired cache entries
   * are very likely still valid. Used as a last resort when fresh resolution
   * fails (423 Locked, rate limited, network error).
   *
   * This is the "serve stale while locked" strategy.
   */
  private staleDownloadUrls: Map<string, string> = new Map();

  /** TTL for torrent/directory listing in milliseconds. */
  private readonly listTtlMs: number;

  /** TTL for download URLs in milliseconds. */
  private readonly urlTtlMs: number;

  /**
   * Creates a new BridgeCache instance.
   *
   * @param listTtlS - Torrent listing cache TTL in seconds.
   * @param urlTtlS - Download URL cache TTL in seconds.
   */
  constructor(listTtlS: number, urlTtlS: number) {
    this.listTtlMs = listTtlS * 1000;
    this.urlTtlMs = urlTtlS * 1000;
  }

  // -------------------------------------------------------------------------
  // Torrent List
  // -------------------------------------------------------------------------

  /**
   * Retrieves the cached torrent list if it hasn't expired.
   *
   * @returns The cached directories, or null if expired/missing.
   */
  getTorrentList(): VirtualDirectory[] | null {
    if (!this.torrentListCache) return null;
    if (Date.now() >= this.torrentListCache.expiresAt) {
      this.torrentListCache = null;
      return null;
    }
    return this.torrentListCache.data;
  }

  /**
   * Stores a torrent list in the cache.
   *
   * @param dirs - The virtual directory listing to cache.
   */
  setTorrentList(dirs: VirtualDirectory[]): void {
    this.torrentListCache = {
      data: dirs,
      expiresAt: Date.now() + this.listTtlMs,
    };
  }

  // -------------------------------------------------------------------------
  // Torrent File Info
  // -------------------------------------------------------------------------

  /**
   * Retrieves cached file details for a specific torrent.
   *
   * @param torrentId - The torrent identifier.
   * @returns The cached files, or null if expired/missing.
   */
  getTorrentInfo(torrentId: string): VirtualFile[] | null {
    const entry = this.torrentInfoCache.get(torrentId);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.torrentInfoCache.delete(torrentId);
      return null;
    }
    return entry.data;
  }

  /**
   * Stores file details for a specific torrent.
   *
   * @param torrentId - The torrent identifier.
   * @param files - The virtual file listing to cache.
   */
  setTorrentInfo(torrentId: string, files: VirtualFile[]): void {
    this.torrentInfoCache.set(torrentId, {
      data: files,
      expiresAt: Date.now() + this.listTtlMs,
    });
  }

  // -------------------------------------------------------------------------
  // Download URLs
  // -------------------------------------------------------------------------

  /**
   * Retrieves a cached download URL.
   *
   * @param key - The cache key (`{torrentId}:{fileId}`).
   * @returns The cached URL, or null if expired/missing.
   */
  getDownloadUrl(key: string): string | null {
    const entry = this.downloadUrlCache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      // Move to stale cache instead of deleting — CDN URLs often live 6-12h
      this.staleDownloadUrls.set(key, entry.data);
      this.downloadUrlCache.delete(key);
      return null;
    }
    return entry.data;
  }

  /**
   * Retrieves a stale (expired) download URL as a fallback.
   * Used when fresh resolution fails due to provider lock/rate limit.
   * CDN URLs typically outlive our cache TTL by hours.
   *
   * @param key - The cache key (`{torrentId}:{fileId}`).
   * @returns The stale URL, or null if none available.
   */
  getStaleDownloadUrl(key: string): string | null {
    return this.staleDownloadUrls.get(key) ?? null;
  }

  /**
   * Stores a download URL in the cache.
   *
   * @param key - The cache key (`{torrentId}:{fileId}`).
   * @param url - The resolved download URL.
   */
  setDownloadUrl(key: string, url: string): void {
    this.downloadUrlCache.set(key, {
      data: url,
      expiresAt: Date.now() + this.urlTtlMs,
    });
  }

  // -------------------------------------------------------------------------
  // Statistics
  // -------------------------------------------------------------------------

  /** Returns the number of torrents in the listing cache, or 0. */
  get cachedTorrentCount(): number {
    return this.torrentListCache?.data?.length ?? 0;
  }

  /** Returns the total number of cached file entries across all torrents. */
  get cachedFileCount(): number {
    let count = 0;
    for (const entry of this.torrentInfoCache.values()) {
      if (Date.now() < entry.expiresAt) {
        count += entry.data.length;
      }
    }
    return count;
  }

  /** Returns the number of cached download URLs. */
  get cachedUrlCount(): number {
    let count = 0;
    for (const entry of this.downloadUrlCache.values()) {
      if (Date.now() < entry.expiresAt) {
        count++;
      }
    }
    return count;
  }

  /** Clears all cached data. */
  clear(): void {
    this.torrentListCache = null;
    this.torrentInfoCache.clear();
    this.downloadUrlCache.clear();
  }
}

// ===========================================================================
// Provider-Specific API Methods
// ===========================================================================

// ---------------------------------------------------------------------------
// RealDebrid Helpers
// ---------------------------------------------------------------------------

/**
 * Builds authorisation headers for the Real-Debrid API.
 *
 * @returns Headers object with Bearer token.
 */
function rdHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.rdAccessToken}` };
}

/**
 * Fetches the complete torrent list from Real-Debrid and converts it
 * into virtual directories. Only includes fully downloaded torrents
 * (progress >= 100).
 *
 * @returns Array of virtual directories representing completed RD torrents.
 */
async function fetchRDDirectories(): Promise<VirtualDirectory[]> {
  const providerName = "realdebrid";

  if (!config.rdAccessToken) return [];

  if (rateLimiter.isRateLimited(providerName)) {
    logWarn(providerName, "Rate limited, skipping directory fetch");
    return [];
  }

  await rateLimiter.throttle(providerName);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const allTorrents: any[] = [];
  let page = 1;
  const limit = 2500;

  try {
    while (true) {
      const url = `${base}/torrents?limit=${limit}&page=${page}`;
      const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
      rateLimiter.recordSuccess(providerName);

      const arr = Array.isArray(res?.data) ? res.data : [];
      allTorrents.push(...arr);

      if (arr.length < limit) break;
      page++;
      await rateLimiter.throttle(providerName);
    }

    // Only include fully downloaded torrents
    const completed = allTorrents.filter((t) => {
      const progress = typeof t.progress === "number" ? t.progress : 0;
      return progress >= 100;
    });

    log(providerName, `Fetched ${completed.length} completed torrents out of ${allTorrents.length} total`);

    return completed.map((t) => ({
      id: String(t.id),
      name: sanitiseName(t.filename || t.id),
      originalName: t.filename || t.id,
      files: [], // Files are fetched lazily via torrent info endpoint
    }));
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(providerName, errorMsg);
    }
    logError(providerName, "Failed to fetch torrent list", { error: errorMsg });
    return [];
  }
}

/**
 * Fetches detailed file information for a single Real-Debrid torrent.
 * Uses the `/torrents/info/{id}` endpoint which returns file paths, sizes,
 * and selection state.
 *
 * @param torrentId - The RD torrent ID.
 * @returns Array of virtual files within the torrent.
 */
async function fetchRDTorrentFiles(torrentId: string): Promise<VirtualFile[]> {
  const providerName = "realdebrid";

  if (rateLimiter.isRateLimited(providerName)) {
    logWarn(providerName, `Rate limited, skipping file fetch for torrent ${torrentId}`);
    return [];
  }

  await rateLimiter.throttle(providerName);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");

  try {
    const url = `${base}/torrents/info/${encodeURIComponent(torrentId)}`;
    const res = await axiosIPv4.get(url, { headers: rdHeaders(), timeout: 30000 });
    rateLimiter.recordSuccess(providerName);

    const files: any[] = Array.isArray(res?.data?.files) ? res.data.files : [];
    const links: string[] = Array.isArray(res?.data?.links) ? res.data.links : [];

    // Build the virtual file list from selected files
    // The links[] array maps 1:1 to selected files (files with selected === 1)
    const selectedFiles = files.filter((f) => f.selected === 1);
    let linkIdx = 0;

    return selectedFiles.map((f) => {
      // Extract just the filename from the path (RD paths look like "/dirname/file.mkv")
      const pathParts = String(f.path || "").split("/").filter(Boolean);
      const fileName = pathParts[pathParts.length - 1] || `file_${f.id}`;

      const vf: VirtualFile = {
        id: String(f.id),
        name: sanitiseName(fileName),
        size: typeof f.bytes === "number" ? f.bytes : 0,
        linkIndex: linkIdx,
      };
      linkIdx++;
      return vf;
    });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(providerName, errorMsg);
    }
    logError(providerName, `Failed to fetch files for torrent ${torrentId}`, { error: errorMsg });
    return [];
  }
}

/**
 * Resolves a download URL for a Real-Debrid file by unrestricting the
 * corresponding link from the torrent's `links[]` array.
 *
 * @param torrentId - The RD torrent ID.
 * @param linkIndex - The index into the torrent's `links[]` array.
 * @returns The direct download URL, or null on failure.
 */
async function resolveRDDownloadUrl(torrentId: string, linkIndex: number): Promise<string | null> {
  const providerName = "realdebrid";

  if (rateLimiter.isRateLimited(providerName)) {
    logWarn(providerName, `Rate limited, cannot resolve download URL for torrent ${torrentId}`);
    return null;
  }

  await rateLimiter.throttle(providerName);

  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");

  try {
    // First, get the torrent info to retrieve the link
    const infoUrl = `${base}/torrents/info/${encodeURIComponent(torrentId)}`;
    const infoRes = await axiosIPv4.get(infoUrl, { headers: rdHeaders(), timeout: 30000 });
    rateLimiter.recordSuccess(providerName);

    const links: string[] = Array.isArray(infoRes?.data?.links) ? infoRes.data.links : [];
    if (linkIndex < 0 || linkIndex >= links.length) {
      logError(providerName, `Link index ${linkIndex} out of range (${links.length} links) for torrent ${torrentId}`);
      return null;
    }

    const link = links[linkIndex];

    // Unrestrict the link to get the direct download URL
    await rateLimiter.throttle(providerName);
    const unrestrictUrl = `${base}/unrestrict/link`;
    const params = new URLSearchParams();
    params.set("link", link);

    const unrestrictRes = await axiosIPv4.post(unrestrictUrl, params, {
      headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" },
      timeout: 20000,
    });
    rateLimiter.recordSuccess(providerName);

    const downloadUrl = unrestrictRes?.data?.download;
    if (!downloadUrl) {
      logError(providerName, `Unrestrict returned no download URL for torrent ${torrentId}, link ${linkIndex}`);
      return null;
    }

    return downloadUrl;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(providerName, errorMsg);
    }
    logError(providerName, `Failed to resolve download URL for torrent ${torrentId}`, { error: errorMsg });
    return null;
  }
}

// ---------------------------------------------------------------------------
// TorBox Helpers
// ---------------------------------------------------------------------------

/**
 * Fetches the complete torrent list from TorBox and converts it into
 * virtual directories. Only includes torrents where `download_finished === true`.
 * TorBox embeds file details directly in the torrent listing, so no
 * additional API call is needed for file info.
 *
 * @returns Array of virtual directories representing completed TorBox torrents.
 */
async function fetchTBDirectories(): Promise<VirtualDirectory[]> {
  const providerName = "torbox";

  if (!config.torboxApiKey) return [];

  if (rateLimiter.isRateLimited(providerName)) {
    logWarn(providerName, "Rate limited, skipping directory fetch");
    return [];
  }

  await rateLimiter.throttle(providerName);

  const base = (config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");

  try {
    const url = `${base}/v1/api/torrents/mylist`;
    const res = await axiosIPv4.get(url, {
      headers: { Authorization: `Bearer ${config.torboxApiKey}` },
      timeout: 30000,
    });
    rateLimiter.recordSuccess(providerName);

    // TorBox wraps data in { data: [...] }
    const rawList = Array.isArray(res?.data?.data) ? res.data.data : [];

    // Only include torrents that have finished downloading
    const completed = rawList.filter((t: any) => t.download_finished === true);

    log(providerName, `Fetched ${completed.length} completed torrents out of ${rawList.length} total`);

    return completed.map((t: any) => {
      const files: any[] = Array.isArray(t.files) ? t.files : [];
      return {
        id: String(t.id),
        name: sanitiseName(t.name || String(t.id)),
        originalName: t.name || String(t.id),
        files: files.map((f: any) => ({
          id: String(f.id),
          name: sanitiseName(f.short_name || f.name || `file_${f.id}`),
          size: typeof f.size === "number" ? f.size : 0,
        })),
      };
    });
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(providerName, errorMsg);
    }
    logError(providerName, "Failed to fetch torrent list", { error: errorMsg });
    return [];
  }
}

/**
 * Resolves a download URL for a TorBox file using the `requestdl` endpoint.
 *
 * @param torrentId - The TorBox torrent ID.
 * @param fileId - The file ID within the torrent.
 * @returns The direct download URL, or null on failure.
 */
async function resolveTBDownloadUrl(torrentId: string, fileId: string): Promise<string | null> {
  const providerName = "torbox";

  if (rateLimiter.isRateLimited(providerName)) {
    logWarn(providerName, `Rate limited, cannot resolve download URL for torrent ${torrentId}`);
    return null;
  }

  await rateLimiter.throttle(providerName);

  const base = (config.torboxBaseUrl || "https://api.torbox.app").replace(/\/$/, "");

  try {
    const params = new URLSearchParams({
      token: config.torboxApiKey,
      torrent_id: torrentId,
      file_id: fileId,
      zip_link: "false",
    });
    const url = `${base}/v1/api/torrents/requestdl?${params.toString()}`;
    const res = await axiosIPv4.get(url, { timeout: 30000 });
    rateLimiter.recordSuccess(providerName);

    const downloadUrl = res?.data?.data;
    if (!downloadUrl || typeof downloadUrl !== "string") {
      logError(providerName, `requestdl returned no URL for torrent ${torrentId}, file ${fileId}`);
      return null;
    }

    return downloadUrl;
  } catch (err: any) {
    const errorMsg = err?.message || String(err);
    if (rateLimiter.isRateLimitError(err) || err?.response?.status === 429) {
      rateLimiter.recordRateLimit(providerName, errorMsg);
    }
    logError(providerName, `Failed to resolve download URL for torrent ${torrentId}, file ${fileId}`, {
      error: errorMsg,
    });
    return null;
  }
}

// ===========================================================================
// WebDAVBridge Class
// ===========================================================================

/**
 * WebDAV translation bridge that exposes debrid provider content as a
 * read-only WebDAV filesystem suitable for rclone mounting.
 *
 * Each instance manages one provider and runs its own HTTP server.
 * The virtual filesystem presents torrents as directories containing
 * their constituent files. File downloads are served as 302 redirects
 * to the provider's CDN.
 *
 * @example
 * ```typescript
 * const bridge = new WebDAVBridge({
 *   provider: 'realdebrid',
 *   port: 9115,
 * });
 * await bridge.start();
 * // rclone can now mount http://localhost:9115 as a WebDAV remote
 * ```
 */
export class WebDAVBridge {
  private readonly provider: string;
  private readonly port: number;
  private readonly cache: BridgeCache;
  private server: http.Server | null = null;
  private lastRefresh: string | null = null;

  /** Per-torrent consecutive failure counter for dead torrent detection. */
  private torrentFailures: Map<string, number> = new Map();

  /** Torrents flagged as dead due to persistent download failures. */
  private deadTorrents: Map<string, DeadTorrentInfo> = new Map();

  /**
   * Creates a new WebDAVBridge instance.
   *
   * @param options - Configuration for this bridge instance.
   */
  constructor(options: WebDAVBridgeOptions) {
    this.provider = options.provider;
    this.port = options.port;
    this.cache = new BridgeCache(
      options.cacheTtlS ?? 30,
      options.downloadCacheTtlS ?? 300,
    );

    // Restore dead torrent state from SQLite
    this.restoreDeadTorrentsFromDb();
  }

  /**
   * Restores dead torrent records and failure counters from the database.
   * Called during construction to rehydrate state across restarts.
   */
  private restoreDeadTorrentsFromDb(): void {
    try {
      const records = getAllDeadTorrents();
      let restored = 0;
      for (const record of records) {
        if (record.provider !== this.provider) continue;

        this.torrentFailures.set(record.torrentKey, record.failureCount);

        if (record.flaggedAt) {
          this.deadTorrents.set(record.torrentKey, {
            id: record.torrentId,
            name: record.torrentName || record.torrentId,
            provider: record.provider,
            failureCount: record.failureCount,
            flaggedAt: new Date(record.flaggedAt).toISOString(),
          });
        }
        restored++;
      }
      if (restored > 0) {
        log(this.provider, `Restored ${restored} dead torrent record(s) from database`);
      }
    } catch (err: any) {
      logWarn(this.provider, `Failed to restore dead torrents from database: ${err?.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Starts the WebDAV server and begins listening on the configured port.
   * The server is ready to accept rclone connections once this resolves.
   *
   * @throws {Error} If the server fails to bind to the port.
   */
  async start(): Promise<void> {
    if (this.server) {
      logWarn(this.provider, "Bridge already running, ignoring start()");
      return;
    }

    const app = this.createExpressApp();

    return new Promise<void>((resolve, reject) => {
      this.server = app.listen(this.port, () => {
        log(this.provider, `Starting ${this.provider} bridge on port ${this.port}`);
        resolve();
      });

      this.server.on("error", (err: Error) => {
        logError(this.provider, `Failed to start bridge on port ${this.port}`, { error: err.message });
        this.server = null;
        reject(err);
      });
    });
  }

  /**
   * Stops the WebDAV server and clears all cached data.
   */
  async stop(): Promise<void> {
    if (!this.server) {
      logWarn(this.provider, "Bridge not running, ignoring stop()");
      return;
    }

    return new Promise<void>((resolve, reject) => {
      this.server!.close((err) => {
        if (err) {
          logError(this.provider, "Error stopping bridge", { error: err.message });
          reject(err);
        } else {
          log(this.provider, "Bridge stopped");
          resolve();
        }
        this.server = null;
        this.cache.clear();
      });
    });
  }

  /**
   * Forces a refresh of the cached torrent/directory listing by clearing
   * the cache and immediately re-fetching from the provider API.
   */
  async refresh(): Promise<void> {
    log(this.provider, "Forcing cache refresh");
    this.cache.clear();
    await this.getDirectories();
  }

  /**
   * Returns a snapshot of the bridge's current runtime status.
   *
   * @returns The current bridge status.
   */
  getStatus(): BridgeStatus {
    return {
      provider: this.provider,
      running: this.server !== null,
      port: this.port,
      cachedTorrents: this.cache.cachedTorrentCount,
      cachedFiles: this.cache.cachedFileCount,
      cachedUrls: this.cache.cachedUrlCount,
      lastRefresh: this.lastRefresh,
    };
  }

  // -------------------------------------------------------------------------
  // Express App Construction
  // -------------------------------------------------------------------------

  /**
   * Creates and configures the Express application with WebDAV method handlers.
   * Implements OPTIONS, PROPFIND, GET, and HEAD — the four methods rclone needs.
   *
   * @returns The configured Express application.
   */
  private createExpressApp(): express.Application {
    const app = express();

    // Consume request body for PROPFIND (rclone sends XML body)
    app.use(express.raw({ type: "*/*", limit: "1mb" }));

    // ------ OPTIONS ------
    app.options("/{*splat}", (_req: Request, res: Response) => {
      res.setHeader("DAV", "1");
      res.setHeader("Allow", "OPTIONS, GET, HEAD, PROPFIND");
      res.status(200).end();
    });

    // ------ PROPFIND ------
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== "PROPFIND") {
        next();
        return;
      }
      // Handle PROPFIND asynchronously
      this.handlePropfind(req, res).catch((err) => {
        logError(this.provider, "PROPFIND handler error", { error: err?.message });
        res.status(500).end();
      });
    });

    // ------ HEAD ------
    app.head("/{*splat}", async (req: Request, res: Response) => {
      try {
        await this.handleHead(req, res);
      } catch (err: any) {
        logError(this.provider, "HEAD handler error", { error: err?.message });
        res.status(500).end();
      }
    });

    // ------ GET ------
    app.get("/{*splat}", async (req: Request, res: Response) => {
      try {
        await this.handleGet(req, res);
      } catch (err: any) {
        logError(this.provider, "GET handler error", { error: err?.message });
        res.status(500).end();
      }
    });

    return app;
  }

  // -------------------------------------------------------------------------
  // WebDAV Method Handlers
  // -------------------------------------------------------------------------

  /**
   * Handles PROPFIND requests — the core of WebDAV directory listing.
   * rclone uses Depth: 0 for stat and Depth: 1 for listing children.
   *
   * Routes:
   * - `/` → list all torrent directories
   * - `/{torrentName}/` → list files in a torrent
   * - `/{torrentName}/{fileName}` → stat a single file
   */
  private async handlePropfind(req: Request, res: Response): Promise<void> {
    const path = decodeURIComponent(req.path).replace(/\/+$/, "") || "/";
    const depth = req.headers["depth"] || "1";
    const lastModified = new Date().toUTCString();

    log(this.provider, `PROPFIND ${path} (depth: ${depth})`);

    // Root directory
    if (path === "/" || path === "") {
      const dirs = await this.getDirectories();
      const responses: string[] = [];

      // Always include the root collection itself
      responses.push(buildCollectionResponse("/", ""));

      // If depth > 0, include children (torrent directories)
      if (depth !== "0") {
        for (const dir of dirs) {
          const href = `/${encodeURIComponent(dir.name)}/`;
          responses.push(buildCollectionResponse(href, dir.name));
        }
      }

      res.status(207);
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.send(buildMultistatus(responses));
      return;
    }

    // Parse path segments: /{torrentName} or /{torrentName}/{fileName}
    const segments = path.split("/").filter(Boolean);
    const torrentName = segments[0];
    const fileName = segments.length > 1 ? segments.slice(1).join("/") : null;

    const dirs = await this.getDirectories();
    const dir = dirs.find((d) => d.name === torrentName);

    if (!dir) {
      res.status(404).end();
      return;
    }

    // Torrent directory listing
    if (!fileName) {
      const files = await this.getFilesForTorrent(dir);
      const responses: string[] = [];

      // Include the directory itself
      const dirHref = `/${encodeURIComponent(dir.name)}/`;
      responses.push(buildCollectionResponse(dirHref, dir.name));

      // If depth > 0, include files
      if (depth !== "0") {
        for (const file of files) {
          const fileHref = `/${encodeURIComponent(dir.name)}/${encodeURIComponent(file.name)}`;
          responses.push(buildFileResponse(fileHref, file.name, file.size, lastModified));
        }
      }

      res.status(207);
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.send(buildMultistatus(responses));
      return;
    }

    // Single file stat
    const files = await this.getFilesForTorrent(dir);
    const file = files.find((f) => f.name === fileName);

    if (!file) {
      res.status(404).end();
      return;
    }

    const fileHref = `/${encodeURIComponent(dir.name)}/${encodeURIComponent(file.name)}`;
    const responses = [buildFileResponse(fileHref, file.name, file.size, lastModified)];

    res.status(207);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.send(buildMultistatus(responses));
  }

  /**
   * Handles HEAD requests — returns file metadata without the body.
   * Used by rclone to check file existence and size before downloading.
   */
  private async handleHead(req: Request, res: Response): Promise<void> {
    const path = decodeURIComponent(req.path).replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);

    // Root or directory HEAD
    if (segments.length < 2) {
      res.status(200).end();
      return;
    }

    const torrentName = segments[0];
    const fileName = segments.slice(1).join("/");

    const dirs = await this.getDirectories();
    const dir = dirs.find((d) => d.name === torrentName);

    if (!dir) {
      res.status(404).end();
      return;
    }

    const files = await this.getFilesForTorrent(dir);
    const file = files.find((f) => f.name === fileName);

    if (!file) {
      res.status(404).end();
      return;
    }

    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Accept-Ranges", "bytes");
    res.status(200).end();
  }

  /**
   * Handles GET requests — resolves the download URL from the provider
   * and returns a 302 redirect to the CDN. This keeps file content
   * off the local machine entirely.
   */
  private async handleGet(req: Request, res: Response): Promise<void> {
    const path = decodeURIComponent(req.path).replace(/\/+$/, "") || "/";
    const segments = path.split("/").filter(Boolean);

    // Can't GET a directory
    if (segments.length < 2) {
      res.status(404).end();
      return;
    }

    const torrentName = segments[0];
    const fileName = segments.slice(1).join("/");

    const dirs = await this.getDirectories();
    const dir = dirs.find((d) => d.name === torrentName);

    if (!dir) {
      res.status(404).end();
      return;
    }

    const files = await this.getFilesForTorrent(dir);
    const file = files.find((f) => f.name === fileName);

    if (!file) {
      res.status(404).end();
      return;
    }

    // Resolve the download URL (with caching + retry)
    const downloadUrl = await this.resolveDownloadUrl(dir, file);

    if (!downloadUrl) {
      // Return 503 with Retry-After header instead of 502.
      // This tells rclone the file is temporarily unavailable and to retry,
      // rather than treating it as a permanent failure that breaks the mount.
      // This is the key fix for the "423 Locked" cascade that plagued pd_zurg.
      logWarn(this.provider, `Temporarily unavailable: ${dir.name}/${file.name} — returning 503 Retry-After`);
      res.setHeader("Retry-After", "5");
      res.status(503).send("File temporarily unavailable — provider returned an error. Retry shortly.");
      return;
    }

    log(this.provider, `GET ${path} → 302 redirect`);
    res.redirect(302, downloadUrl);
  }

  // -------------------------------------------------------------------------
  // Data Resolution (with caching)
  // -------------------------------------------------------------------------

  /**
   * Retrieves the virtual directory listing, using the cache when available.
   * On cache miss, fetches fresh data from the provider API.
   *
   * @returns Array of virtual directories.
   */
  private async getDirectories(): Promise<VirtualDirectory[]> {
    const cached = this.cache.getTorrentList();
    if (cached) return cached;

    let dirs: VirtualDirectory[];

    // Use the provider registry to fetch directories — provider-agnostic
    const providerImpl = registry.get(this.provider);
    if (providerImpl) {
      dirs = await providerImpl.fetchDirectories();
    } else if (this.provider === "realdebrid") {
      // Fallback to inline helpers for backwards compatibility
      dirs = await fetchRDDirectories();
    } else {
      dirs = await fetchTBDirectories();
    }

    this.cache.setTorrentList(dirs);
    this.lastRefresh = new Date().toISOString();
    return dirs;
  }

  /**
   * Retrieves file details for a specific torrent, using the cache when available.
   *
   * For TorBox, files are already embedded in the directory listing.
   * For RealDebrid, files are fetched lazily from the `/torrents/info/{id}` endpoint.
   *
   * @param dir - The virtual directory to get files for.
   * @returns Array of virtual files.
   */
  private async getFilesForTorrent(dir: VirtualDirectory): Promise<VirtualFile[]> {
    // If files are already embedded (TorBox, AllDebrid, Premiumize), return them
    if (dir.files.length > 0) {
      return dir.files;
    }

    // Otherwise fetch lazily (RealDebrid)
    const cached = this.cache.getTorrentInfo(dir.id);
    if (cached) return cached;

    // Use provider registry if available
    const providerImpl = registry.get(this.provider);
    let files: VirtualFile[];
    if (providerImpl?.fetchTorrentFiles) {
      files = await providerImpl.fetchTorrentFiles(dir.id);
    } else {
      files = await fetchRDTorrentFiles(dir.id);
    }

    if (files.length > 0) {
      this.cache.setTorrentInfo(dir.id, files);
    }
    return files;
  }

  /**
   * Resolves a direct download URL for a file, using the cache when available.
   * On cache miss, calls the provider API to generate a fresh CDN URL.
   *
   * Includes retry-with-backoff to handle transient provider errors
   * (423 Locked, 429 Rate Limit, network blips). This is the primary
   * defence against the cascade failures that plagued pd_zurg.
   *
   * Falls back to stale (expired) cached URLs when fresh resolution fails —
   * CDN URLs typically live 6-12 hours, so stale entries are very likely
   * still valid ("serve stale while locked" strategy).
   *
   * Tracks per-torrent failure counts. After DEAD_TORRENT_THRESHOLD
   * consecutive failures, marks the torrent as dead for the dead scanner
   * to replace.
   *
   * @param dir - The virtual directory containing the file.
   * @param file - The virtual file to resolve.
   * @returns The download URL, or null on failure.
   */
  private async resolveDownloadUrl(dir: VirtualDirectory, file: VirtualFile): Promise<string | null> {
    const cacheKey = `${dir.id}:${file.id}`;
    const cached = this.cache.getDownloadUrl(cacheKey);
    if (cached) {
      // Fresh cache hit — reset failure counter for this torrent
      this.torrentFailures.delete(dir.id);
      return cached;
    }

    const label = `${this.provider}:${dir.name}/${file.name}`;

    const url = await retryWithBackoff(
      async () => {
        // Use provider registry for provider-agnostic resolution
        const providerImpl = registry.get(this.provider);
        if (providerImpl && this.provider !== "realdebrid" && this.provider !== "torbox") {
          // New providers (AllDebrid, Premiumize, etc.) use the interface
          return providerImpl.resolveDownloadUrl(dir.id, file.id, file.linkIndex);
        }
        // Legacy inline helpers for RD/TB (proven, battle-tested)
        if (this.provider === "realdebrid") {
          if (typeof file.linkIndex !== "number") {
            logError(this.provider, `No link index for file ${file.name} in torrent ${dir.name}`);
            return null;
          }
          return resolveRDDownloadUrl(dir.id, file.linkIndex);
        } else {
          return resolveTBDownloadUrl(dir.id, file.id);
        }
      },
      2,    // 3 total attempts (initial + 2 retries)
      1000, // 1s → 2s → 4s backoff
      label,
    );

    if (url) {
      this.cache.setDownloadUrl(cacheKey, url);
      // Successful resolution — reset failure counter
      this.torrentFailures.delete(dir.id);
      return url;
    }

    // Fresh resolution failed — try stale cache ("serve stale while locked")
    const staleUrl = this.cache.getStaleDownloadUrl(cacheKey);
    if (staleUrl) {
      logWarn(this.provider, `Serving stale cached URL for ${dir.name}/${file.name} (fresh resolution failed)`);
      // Don't increment failure counter for stale hits — the file is still serving
      return staleUrl;
    }

    // Total failure — no fresh URL, no stale URL. Track for dead torrent detection.
    const currentFailures = (this.torrentFailures.get(dir.id) ?? 0) + 1;
    this.torrentFailures.set(dir.id, currentFailures);

    // Persist failure count to database
    try {
      upsertDeadTorrent(
        dir.id,
        this.provider,
        dir.id,
        dir.originalName || dir.name,
        currentFailures,
        undefined,
        `Download resolution failed after retries`,
      );
    } catch (dbErr: any) {
      // Non-critical — in-memory tracking still works
    }

    if (currentFailures >= DEAD_TORRENT_THRESHOLD) {
      logError(
        this.provider,
        `Torrent ${dir.name} (${dir.id}) reached ${currentFailures} consecutive failures — flagging as dead`
      );
      const flaggedAt = new Date().toISOString();
      this.deadTorrents.set(dir.id, {
        id: dir.id,
        name: dir.originalName || dir.name,
        provider: this.provider,
        failureCount: currentFailures,
        flaggedAt,
      });

      // Persist the dead flag to database
      try {
        upsertDeadTorrent(
          dir.id,
          this.provider,
          dir.id,
          dir.originalName || dir.name,
          currentFailures,
          Date.now(),
          `Flagged as dead after ${currentFailures} consecutive failures`,
        );
      } catch (dbErr: any) {
        // Non-critical
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Dead Torrent API
  // -------------------------------------------------------------------------

  /**
   * Returns torrents that have been flagged as dead due to persistent
   * download failures. External consumers (dead scanner) can use this
   * to delete them from the provider and search for replacements.
   *
   * @returns Map of torrent ID to dead torrent info.
   */
  getDeadTorrents(): Map<string, DeadTorrentInfo> {
    return new Map(this.deadTorrents);
  }

  /**
   * Clears a torrent from the dead list after it's been handled
   * (deleted from provider, replacement queued, etc.).
   *
   * @param torrentId - The torrent ID to clear.
   */
  clearDeadTorrent(torrentId: string): void {
    this.deadTorrents.delete(torrentId);
    this.torrentFailures.delete(torrentId);

    // Remove from database
    try {
      removeDeadTorrentFromDb(torrentId);
    } catch (err: any) {
      logWarn(this.provider, `Failed to remove dead torrent from database: ${err?.message}`);
    }

    log(this.provider, `Cleared dead torrent flag for ${torrentId}`);
  }
}
