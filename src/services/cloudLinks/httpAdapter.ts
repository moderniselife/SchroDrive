/**
 * SchroDrive — HTTP Directory Cloud Link Adapter
 *
 * Handles open HTTP directory listings (Apache mod_autoindex, Nginx autoindex,
 * h5ai, etc.) by parsing the HTML and exposing files as a virtual filesystem.
 *
 * Supports:
 * - Nginx autoindex (`<pre>` block with `<a href>` links)
 * - Apache mod_autoindex (`<pre>` format and `<table>` format)
 * - Generic HTML pages with file links
 *
 * Files are served via 302 redirect to the direct download URL — no stream
 * proxying needed (unlike MEGA).
 *
 * Rate limits: Varies by server. Some open directories (e.g. public file servers)
 * are extremely rate-limited (1 concurrent connection per IP). We cache
 * folder listings aggressively to minimize requests.
 *
 * @module cloudLinks/httpAdapter
 */

import type { CloudLinkAdapter, CloudFile, CloudLinkProvider } from './types';

// ===========================================================================
// Types
// ===========================================================================

/** Extends CloudLinkProvider to include http type. */
export type HttpLinkProvider = CloudLinkProvider | 'http';

/** Parsed directory entry from HTML. */
interface ParsedEntry {
  name: string;
  href: string;
  isDirectory: boolean;
  size: number;
  date?: string;
}

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Safely decodes a URI component, falling back to the raw string if the
 * input contains malformed percent-encoding sequences (e.g. the TV show
 * "3%" produces "3%/" which is not valid percent-encoding).
 */
function safeDecodeURIComponent(str: string): string {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

/** Promise-based delay for rate-limiting. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ===========================================================================
// HTML Directory Listing Parsers
// ===========================================================================

/**
 * Parses a Nginx/Apache autoindex `<pre>` block.
 *
 * Format:
 * ```
 * <pre>
 * <a href="../">../</a>
 * <a href="Movies/">Movies/</a>                  30-May-2026 11:52       -
 * <a href="file.mkv">file.mkv</a>               30-May-2026 11:52    3027
 * </pre>
 * ```
 */
function parsePreBlock(html: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  // Extract content within <pre> tags
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const content = preMatch ? preMatch[1] : html;

  // Match each <a href="...">...</a> followed by optional date and size
  const linkRegex = /<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>\s*(?:(\d{2}-\w{3}-\d{4}\s+\d{2}:\d{2})\s+([\d.]+[KMGTPkmgtp]?|-))?\s*/gi;

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(content)) !== null) {
    const href = match[1];
    const name = match[2].trim();

    // Skip parent directory and self links
    if (name === '../' || name === './' || href === '../' || href === './') continue;

    const isDirectory = href.endsWith('/');
    const sizeStr = match[4] || '-';
    const size = parseSize(sizeStr);
    const date = match[3] || undefined;

    entries.push({
      name: isDirectory ? name.replace(/\/$/, '') : name,
      href: href,
      isDirectory,
      size,
      date,
    });
  }

  return entries;
}

/**
 * Parses an Apache mod_autoindex HTML table.
 *
 * Format:
 * ```html
 * <table>
 *   <tr><td><a href="file.mkv">file.mkv</a></td>
 *       <td>2026-05-30</td>
 *       <td>3.2G</td></tr>
 * </table>
 * ```
 */
function parseTableBlock(html: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];

  // Match table rows containing file links
  const rowRegex = /<tr[^>]*>[\s\S]*?<a\s+href="([^"]+)"[^>]*>([^<]+)<\/a>[\s\S]*?<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const href = match[1];
    const name = match[2].trim();

    // Skip parent directory, header rows, and sort links
    if (name === '../' || name === 'Parent Directory' || name === 'Name' || name === 'Last modified') continue;
    if (href === '../' || href.startsWith('?')) continue;

    const isDirectory = href.endsWith('/');

    // Try to extract size from the row
    const sizeMatch = match[0].match(/<td[^>]*>\s*([\d.]+\s*[KMGTPkmgtp]?)\s*<\/td>/i);
    const size = sizeMatch ? parseSize(sizeMatch[1]) : 0;

    entries.push({
      name: isDirectory ? name.replace(/\/$/, '') : name,
      href,
      isDirectory,
      size,
    });
  }

  return entries;
}

/**
 * Generic fallback parser — extracts all <a href> links and uses
 * heuristics to determine if they're files or directories.
 */
function parseGenericLinks(html: string, baseUrl: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const seenHrefs = new Set<string>();

  const linkRegex = /<a\s+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    let href = match[1];
    const name = match[2].trim();

    // Skip navigation, anchors, external, javascript, and query links
    if (!href || href === '../' || href === './' || href.startsWith('#') ||
        href.startsWith('javascript:') || href.startsWith('?') ||
        href.startsWith('mailto:')) continue;

    // Skip if it points to a completely different domain
    try {
      const resolved = new URL(href, baseUrl);
      const base = new URL(baseUrl);
      if (resolved.hostname !== base.hostname) continue;
      // Normalise href to be relative
      href = resolved.pathname.replace(base.pathname, '').replace(/^\//, '') || href;
    } catch {
      // Keep as-is if URL parsing fails
    }

    if (seenHrefs.has(href)) continue;
    seenHrefs.add(href);

    // Skip common non-file links
    if (name.length === 0 || name === 'Parent Directory') continue;

    const isDirectory = href.endsWith('/');

    entries.push({
      name: isDirectory ? name.replace(/\/$/, '') : name || href,
      href,
      isDirectory,
      size: 0,
    });
  }

  return entries;
}

/**
 * Auto-detects the listing format and parses the HTML accordingly.
 */
function parseDirectoryListing(html: string, baseUrl: string): ParsedEntry[] {
  // Try Nginx/Apache <pre> format first (most common for open directories)
  if (/<pre/i.test(html)) {
    const results = parsePreBlock(html);
    if (results.length > 0) return results;
  }

  // Try Apache <table> format
  if (/<table/i.test(html) && /indexcol|<th/i.test(html)) {
    const results = parseTableBlock(html);
    if (results.length > 0) return results;
  }

  // Fallback: generic link extraction
  return parseGenericLinks(html, baseUrl);
}

// ===========================================================================
// Size Parsing
// ===========================================================================

/**
 * Parses a human-readable size string into bytes.
 * Handles: "3027", "3.2G", "1.5M", "256K", "-" (directory)
 */
function parseSize(sizeStr: string): number {
  if (!sizeStr || sizeStr === '-') return 0;

  const trimmed = sizeStr.trim();
  const match = trimmed.match(/^([\d.]+)\s*([KMGTPkmgtp])?$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();

  switch (unit) {
    case 'K': return Math.round(value * 1024);
    case 'M': return Math.round(value * 1048576);
    case 'G': return Math.round(value * 1073741824);
    case 'T': return Math.round(value * 1099511627776);
    case 'P': return Math.round(value * 1125899906842624);
    default:  return Math.round(value);
  }
}

// ===========================================================================
// Adapter
// ===========================================================================

/** Default milliseconds to wait between crawl requests. */
const DEFAULT_CRAWL_DELAY_MS = 500;

/** Maximum directory depth to crawl (prevents infinite recursion). */
const CRAWL_MAX_DEPTH = 10;

/**
 * Maximum number of entries to persist to disk.
 * Keeps the JSON file small enough to parse/serialise without OOM.
 * The full in-memory cache can be much larger — we have RAM to spare.
 */
const MAX_DISK_CACHE_SIZE = 3000;

export class HttpAdapter implements CloudLinkAdapter {
  readonly type: CloudLinkProvider = 'http' as CloudLinkProvider;
  readonly name: string;

  private baseUrl: string;
  private initialised = false;

  /** Whether a background deep crawl is currently running. */
  private crawling = false;
  /** Number of directories fetched during the current crawl. */
  private crawlFetched = 0;
  /** Milliseconds to wait between crawl/fetch requests (rate limiting). */
  private crawlDelayMs: number;

  /** In-memory cache of folder contents: url → entries. */
  private folderCache = new Map<string, { files: CloudFile[]; fetchedAt: number }>();

  /** Debounce timer for disk cache saves. */
  private diskSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Fresh TTL — serve from cache without any background refresh.
   * After this, we still serve the cached copy but trigger a background refresh.
   */
  private static readonly FRESH_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  /**
   * Stale TTL — maximum age before we MUST refetch before serving.
   * Between FRESH and STALE, we serve the cached copy and refresh in background.
   */
  private static readonly STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /** Set of URLs currently being refreshed in the background (dedup). */
  private refreshingUrls = new Set<string>();

  /** Path to persistent disk cache file. */
  private diskCachePath: string | null = null;

  /** Timestamp of last 429 log line (suppress spam). */
  private _last429LogTime = 0;
  /** Total 429 hits since adapter creation. */
  private _rateLimitHitCount = 0;

  /** Optional custom headers (e.g. for auth). */
  private headers: Record<string, string>;

  /**
   * Creates a new HTTP directory adapter.
   *
   * @param url - Base URL of the HTTP directory listing.
   * @param name - Display name for the mount directory.
   * @param headers - Optional custom HTTP headers (e.g. auth).
   * @param rateLimitMs - Optional delay between requests in ms (default: 500).
   */
  constructor(url: string, name: string, headers?: Record<string, string>, rateLimitMs?: number) {
    this.name = name;
    // Ensure trailing slash
    this.baseUrl = url.endsWith('/') ? url : url + '/';
    this.headers = headers || {};
    this.crawlDelayMs = rateLimitMs ?? DEFAULT_CRAWL_DELAY_MS;

    if (rateLimitMs) {
      console.log(`[cloud-links][http] "${name}" rate limit: ${rateLimitMs}ms between requests`);
    }

    // Set up persistent disk cache path
    const dataDir = process.env.DATA_DIR || './data';
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    this.diskCachePath = `${dataDir}/http_cache_${safeName}.json`;

    // Load existing disk cache on construction
    this.loadDiskCache();
  }

  /**
   * Loads cached folder listings from disk (survives restarts).
   */
  private loadDiskCache(): void {
    if (!this.diskCachePath) return;
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.diskCachePath)) return;

      const raw = fs.readFileSync(this.diskCachePath, 'utf-8');
      const data: Record<string, { files: CloudFile[]; fetchedAt: number }> = JSON.parse(raw);

      let loaded = 0;
      for (const [url, entry] of Object.entries(data)) {
        // Only load entries that haven't exceeded the stale TTL
        if (Date.now() - entry.fetchedAt < HttpAdapter.STALE_TTL_MS) {
          this.folderCache.set(url, entry);
          loaded++;
        }
      }

      if (loaded > 0) {
        console.log(`[${new Date().toISOString()}][cloud-links][http] Restored ${loaded} cached folder(s) for "${this.name}" from disk`);
      }
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][cloud-links][http] Failed to load disk cache for "${this.name}": ${err?.message}`);
    }
  }

  /**
   * Persists the current in-memory cache to disk (debounced).
   * Only saves the most recent MAX_DISK_CACHE_SIZE entries to avoid OOM
   * when serialising massive caches (31k+ entries) to JSON.
   */
  private saveDiskCache(): void {
    if (!this.diskCachePath) return;

    // Debounce: wait 5 seconds after the last call before actually writing.
    // This prevents hammering the disk during rapid-fire cache updates.
    if (this.diskSaveTimer) clearTimeout(this.diskSaveTimer);
    this.diskSaveTimer = setTimeout(() => this.saveDiskCacheNow(), 5000);
  }

  /** Actually writes the disk cache (called by the debounce timer). */
  private saveDiskCacheNow(): void {
    if (!this.diskCachePath) return;
    try {
      const fs = require('fs');
      const path = require('path');
      const dir = path.dirname(this.diskCachePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Sort by fetchedAt descending (most recent first) and cap the count
      const entries = Array.from(this.folderCache.entries())
        .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
        .slice(0, MAX_DISK_CACHE_SIZE);

      const data: Record<string, { files: CloudFile[]; fetchedAt: number }> = {};
      for (const [url, entry] of entries) {
        data[url] = entry;
      }

      fs.writeFileSync(this.diskCachePath, JSON.stringify(data), 'utf-8');
    } catch (err: any) {
      console.warn(`[${new Date().toISOString()}][cloud-links][http] Failed to save disk cache for "${this.name}": ${err?.message}`);
    }
  }

  /**
   * Validates the URL is accessible and returns a directory listing.
   */
  async init(): Promise<void> {
    if (this.initialised) return;

    console.log(`[${new Date().toISOString()}][cloud-links][http] Initialising "${this.name}" (${this.baseUrl})...`);

    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SchroDrive/1.0)',
          ...this.headers,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const html = await response.text();
      const entries = parseDirectoryListing(html, this.baseUrl);

      console.log(`[${new Date().toISOString()}][cloud-links][http] Verified "${this.name}" — ${entries.length} entries in root`);
      this.initialised = true;

      // Kick off background deep crawl to pre-warm cache
      this.startDeepCrawl();
    } catch (err: any) {
      throw new Error(`HTTP directory verification failed for "${this.name}": ${err?.message}`);
    }
  }

  /**
   * Launches a background deep crawl of the entire directory tree.
   * Uses BFS with rate-limiting to avoid hammering the server.
   * Skips directories that are already fresh in cache.
   */
  private startDeepCrawl(): void {
    if (this.crawling) return;

    // If we already have a substantial disk cache, skip crawling
    // (the stale-while-revalidate will handle refreshes on-demand)
    const cachedCount = this.folderCache.size;
    if (cachedCount > 20) {
      console.log(`[${new Date().toISOString()}][cloud-links][http] "${this.name}" — ${cachedCount} folders already cached, skipping deep crawl`);
      return;
    }

    this.crawling = true;
    this.crawlFetched = 0;

    console.log(`[${new Date().toISOString()}][cloud-links][http] "${this.name}" — starting background deep crawl...`);

    this.crawlDirectory(this.baseUrl, 0)
      .then(() => {
        // Final save
        this.saveDiskCache();
        console.log(
          `[${new Date().toISOString()}][cloud-links][http] "${this.name}" — deep crawl complete. ` +
          `Fetched ${this.crawlFetched} new dirs, ${this.folderCache.size} total cached.`
        );
      })
      .catch((err) => {
        console.error(`[${new Date().toISOString()}][cloud-links][http] "${this.name}" — deep crawl failed: ${err?.message}`);
      })
      .finally(() => {
        this.crawling = false;
      });
  }

  /**
   * Recursively crawls a directory and all its subdirectories (BFS).
   * Rate-limited with CRAWL_DELAY_MS between requests.
   */
  private async crawlDirectory(url: string, depth: number): Promise<void> {
    if (depth > CRAWL_MAX_DEPTH) return;

    // Check if we already have a fresh cache for this URL
    const cached = this.folderCache.get(url);
    let files: CloudFile[];

    if (cached && (Date.now() - cached.fetchedAt) < HttpAdapter.FRESH_TTL_MS) {
      // Already fresh — use cached data to discover subdirs without fetching
      files = cached.files;
    } else {
      // Need to fetch
      await sleep(this.crawlDelayMs);
      const fetched = await this.fetchRemoteListing(url);
      if (!fetched) return; // Failed — skip this branch

      files = fetched;
      this.folderCache.set(url, { files, fetchedAt: Date.now() });
      this.crawlFetched++;

      // Save to disk periodically (every 50 fetches)
      if (this.crawlFetched % 50 === 0) {
        this.saveDiskCache();
        console.log(
          `[${new Date().toISOString()}][cloud-links][http] "${this.name}" — crawl progress: ` +
          `${this.crawlFetched} fetched, ${this.folderCache.size} total cached`
        );
      }
    }

    // Recurse into subdirectories
    const subdirs = files.filter((f) => f.isDirectory);
    for (const subdir of subdirs) {
      const subUrl = subdir.id.endsWith('/') ? subdir.id : subdir.id + '/';
      await this.crawlDirectory(subUrl, depth + 1);
    }
  }

  /**
   * Fetches and parses a directory listing from the remote server.
   * Returns the parsed CloudFile array, or null on failure.
   */
  private async fetchRemoteListing(targetUrl: string): Promise<CloudFile[] | null> {
    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SchroDrive/1.0)',
          ...this.headers,
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        if (response.status === 429) {
          // Suppress per-request 429 logs — log a summary periodically
          const now = Date.now();
          if (!this._last429LogTime || now - this._last429LogTime > 30000) {
            this._rateLimitHitCount = (this._rateLimitHitCount ?? 0) + 1;
            console.warn(`[${new Date().toISOString()}][cloud-links][http] ${this.name}: rate limited (429) — ${this._rateLimitHitCount} hits since startup`);
            this._last429LogTime = now;
          }
          // Throw so callers (background refresh queue) can detect and back off
          throw new Error(`429 Too Many Requests: ${targetUrl}`);
        }
        console.warn(`[${new Date().toISOString()}][cloud-links][http] ${targetUrl} returned HTTP ${response.status}`);
        return null;
      }

      const html = await response.text();
      const entries = parseDirectoryListing(html, targetUrl);

      const files: CloudFile[] = [];
      for (const entry of entries) {
        try {
          files.push({
            id: new URL(entry.href, targetUrl).toString(),
            name: safeDecodeURIComponent(entry.name),
            size: entry.size,
            isDirectory: entry.isDirectory,
            mimeType: entry.isDirectory ? 'application/directory' : guessMimeType(entry.name),
          });
        } catch (entryErr: any) {
          console.warn(`[${new Date().toISOString()}][cloud-links][http] Skipping entry "${entry.name}": ${entryErr?.message}`);
        }
      }

      return files;
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][cloud-links][http] Fetch failed for ${targetUrl}: ${err?.message}`);
      return null;
    }
  }

  /**
   * Refreshes a URL's cache in the background (stale-while-revalidate).
   * Won't duplicate if already refreshing the same URL.
   */
  private backgroundRefresh(targetUrl: string): void {
    if (this.refreshingUrls.has(targetUrl)) return;
    this.refreshingUrls.add(targetUrl);

    this.fetchRemoteListing(targetUrl)
      .then((files) => {
        if (files) {
          this.folderCache.set(targetUrl, { files, fetchedAt: Date.now() });
          this.saveDiskCache();
          console.log(`[${new Date().toISOString()}][cloud-links][http] Background refresh complete for ${targetUrl} (${files.length} entries)`);
        }
      })
      .catch(() => { /* already logged in fetchRemoteListing */ })
      .finally(() => {
        this.refreshingUrls.delete(targetUrl);
      });
  }

  /**
   * Exposes the adapter's rate limit delay for external consumers
   * (e.g. the pre-warm function).
   */
  get rateLimitMs(): number {
    return this.crawlDelayMs;
  }

  /**
   * Checks if the given sub-path is already in the adapter's internal
   * folder cache. Used by the pre-warm to skip rate-limit delays for
   * paths that will be served from cache without network requests.
   */
  isCached(subPath?: string): boolean {
    const targetUrl = subPath
      ? new URL(subPath.endsWith('/') ? subPath : subPath + '/', this.baseUrl).toString()
      : this.baseUrl;
    return this.folderCache.has(targetUrl);
  }

  /**
   * Lists files and directories at the given sub-path.
   *
   * Cache strategy (stale-while-revalidate):
   * - < 6h old: serve from cache (fresh)
   * - 6h–24h old: serve from cache + trigger background refresh (stale)
   * - > 24h old: must fetch fresh (expired)
   */
  async listFolder(subPath?: string): Promise<CloudFile[]> {
    if (!this.initialised) await this.init();

    const targetUrl = subPath
      ? new URL(subPath.endsWith('/') ? subPath : subPath + '/', this.baseUrl).toString()
      : this.baseUrl;

    const cached = this.folderCache.get(targetUrl);

    if (cached) {
      const age = Date.now() - cached.fetchedAt;

      // Fresh — serve directly
      if (age < HttpAdapter.FRESH_TTL_MS) {
        return cached.files;
      }

      // Stale — serve cached but trigger background refresh
      if (age < HttpAdapter.STALE_TTL_MS) {
        this.backgroundRefresh(targetUrl);
        return cached.files;
      }
    }

    // Expired or no cache — must fetch fresh
    const files = await this.fetchRemoteListing(targetUrl);
    if (files) {
      this.folderCache.set(targetUrl, { files, fetchedAt: Date.now() });
      this.saveDiskCache();
      return files;
    }

    // Fetch failed — return stale cache if we have one (better than nothing)
    if (cached) {
      console.warn(`[${new Date().toISOString()}][cloud-links][http] Serving expired cache for ${targetUrl} (fetch failed)`);
      return cached.files;
    }

    return [];
  }

  /**
   * Returns a readable stream of the file content.
   * Fallback for when the media player doesn't follow 302 redirects.
   */
  async getStream(fileId: string): Promise<NodeJS.ReadableStream> {
    console.log(`[${new Date().toISOString()}][cloud-links][http] Streaming: ${fileId}`);

    const response = await fetch(fileId, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; SchroDrive/1.0)',
        ...this.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching ${fileId}`);
    }

    // Convert web ReadableStream to Node.js ReadableStream
    const { Readable } = await import('stream');
    return Readable.fromWeb(response.body as any);
  }

  /**
   * Returns a direct download URL for the file.
   * HTTP directories serve files directly — just use the URL!
   */
  async getDirectUrl(fileId: string): Promise<string | null> {
    return fileId; // The file ID IS the direct download URL
  }

  /**
   * Returns the size of a specific file.
   * Tries a HEAD request to get Content-Length.
   */
  async getFileSize(fileId: string): Promise<number> {
    try {
      const response = await fetch(fileId, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SchroDrive/1.0)',
          ...this.headers,
        },
        signal: AbortSignal.timeout(10000),
      });

      const contentLength = response.headers.get('content-length');
      return contentLength ? parseInt(contentLength, 10) : 0;
    } catch {
      return 0;
    }
  }
}

// ===========================================================================
// MIME Type Guesser
// ===========================================================================

function guessMimeType(filename: string): string {
  const ext = (filename || '').split('.').pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    mkv: 'video/x-matroska',
    mp4: 'video/mp4',
    avi: 'video/x-msvideo',
    wmv: 'video/x-ms-wmv',
    mov: 'video/quicktime',
    flv: 'video/x-flv',
    ts: 'video/mp2t',
    m4v: 'video/x-m4v',
    webm: 'video/webm',
    srt: 'application/x-subrip',
    ass: 'text/x-ssa',
    sub: 'text/x-sub',
    nfo: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    mp3: 'audio/mpeg',
    flac: 'audio/flac',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
  };
  return mimeMap[ext || ''] || 'application/octet-stream';
}
