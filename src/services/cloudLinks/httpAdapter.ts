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
 * Rate limits: Varies by server. Some open directories (e.g. 10.0.0.100)
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

export class HttpAdapter implements CloudLinkAdapter {
  readonly type: CloudLinkProvider = 'http' as CloudLinkProvider;
  readonly name: string;

  private baseUrl: string;
  private initialised = false;

  /** Cache of folder contents: url → entries. */
  private folderCache = new Map<string, { files: CloudFile[]; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (aggressive for rate-limited servers)

  /** Optional custom headers (e.g. for auth). */
  private headers: Record<string, string>;

  /**
   * Creates a new HTTP directory adapter.
   *
   * @param url - Base URL of the HTTP directory listing.
   * @param name - Display name for the mount directory.
   * @param headers - Optional custom HTTP headers (e.g. auth).
   */
  constructor(url: string, name: string, headers?: Record<string, string>) {
    this.name = name;
    // Ensure trailing slash
    this.baseUrl = url.endsWith('/') ? url : url + '/';
    this.headers = headers || {};
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
    } catch (err: any) {
      throw new Error(`HTTP directory verification failed for "${this.name}": ${err?.message}`);
    }
  }

  /**
   * Lists files and directories at the given sub-path.
   */
  async listFolder(subPath?: string): Promise<CloudFile[]> {
    if (!this.initialised) await this.init();

    const targetUrl = subPath
      ? new URL(subPath.endsWith('/') ? subPath : subPath + '/', this.baseUrl).toString()
      : this.baseUrl;

    // Check cache
    const cached = this.folderCache.get(targetUrl);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.files;
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; SchroDrive/1.0)',
          ...this.headers,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        console.warn(`[${new Date().toISOString()}][cloud-links][http] ${targetUrl} returned HTTP ${response.status}`);
        return [];
      }

      const html = await response.text();
      const entries = parseDirectoryListing(html, targetUrl);

      const files: CloudFile[] = [];
      for (const entry of entries) {
        try {
          files.push({
            // Use the full URL as the ID for direct download
            id: new URL(entry.href, targetUrl).toString(),
            name: safeDecodeURIComponent(entry.name),
            size: entry.size,
            isDirectory: entry.isDirectory,
            mimeType: entry.isDirectory ? 'application/directory' : guessMimeType(entry.name),
          });
        } catch (entryErr: any) {
          // Skip individual broken entries instead of killing the whole listing
          console.warn(`[${new Date().toISOString()}][cloud-links][http] Skipping entry "${entry.name}": ${entryErr?.message}`);
        }
      }

      // Cache the results
      this.folderCache.set(targetUrl, {
        files,
        expiresAt: Date.now() + HttpAdapter.CACHE_TTL_MS,
      });

      return files;
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][cloud-links][http] List folder failed for ${targetUrl}: ${err?.message}`);
      return [];
    }
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
