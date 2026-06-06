/**
 * stremioScraper.ts — Shared utilities for all Stremio addon protocol scrapers.
 *
 * Provides common types, stream parsing, quality/size extraction, and URL
 * construction used by torrentio, comet, mediafusion, and any future
 * Stremio-compatible addon scrapers.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Raw stream object returned by a Stremio addon's /stream endpoint. */
export interface StremioStream {
  name: string;       // e.g. 'Torrentio\n1080p'
  title: string;      // e.g. 'Movie.Name.2024.1080p.WEB-DL'
  infoHash?: string;
  fileIdx?: number;
  behaviorHints?: { bingeGroup?: string; filename?: string };
  url?: string;       // Direct URL (some addons provide this instead of infoHash)
}

/** Wrapper for the JSON response from a Stremio addon /stream endpoint. */
export interface StremioResponse {
  streams: StremioStream[];
}

/** Normalised result used across all SchroDrive scraper modules. */
export interface ScraperResult {
  title: string;
  magnetUrl?: string;
  infoHash?: string;
  seeders?: number;
  size?: number;
  source: string;  // e.g. 'torrentio', 'comet', 'mediafusion'
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse quality, size and seeder count from the Stremio stream `name` field.
 *
 * Typical formats:
 *   "Torrentio\n1080p"
 *   "⚙️ 42\n💾 2.1 GB\n1080p"
 */
export function parseQualityFromName(name: string): {
  quality: string;
  size?: number;
  seeders?: number;
} {
  const quality = (name.match(/\b(2160p|1080p|720p|480p|360p|4K|UHD)\b/i)?.[1] ?? "unknown").toUpperCase();

  // Seeders — look for ⚙️ or "👤" followed by a number
  let seeders: number | undefined;
  const seederMatch = name.match(/[⚙👤]\s*(\d+)/);
  if (seederMatch) {
    seeders = parseInt(seederMatch[1], 10);
  }

  // Size — look for 💾 or a standalone size like "2.1 GB"
  let size: number | undefined;
  const sizeMatch = name.match(/💾?\s*([\d.]+)\s*(GB|MB|TB|KB)/i);
  if (sizeMatch) {
    const val = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    switch (unit) {
      case "TB": size = val * 1024 * 1024 * 1024 * 1024; break;
      case "GB": size = val * 1024 * 1024 * 1024; break;
      case "MB": size = val * 1024 * 1024; break;
      case "KB": size = val * 1024; break;
    }
    if (size !== undefined) size = Math.round(size);
  }

  return { quality, size, seeders };
}

/**
 * Build the full Stremio addon stream URL.
 *
 * Movies:  /{config}/stream/movie/{imdbId}.json
 * Series:  /{config}/stream/series/{imdbId}:{season}:{episode}.json
 */
export function buildStremioUrl(
  baseUrl: string,
  configStr: string,
  type: "movie" | "series",
  imdbId: string,
  season?: number,
  episode?: number,
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const cfgSegment = configStr ? `/${configStr.replace(/^\/+/, "").replace(/\/+$/, "")}` : "";

  if (type === "series" && season !== undefined && episode !== undefined) {
    return `${base}${cfgSegment}/stream/series/${imdbId}:${season}:${episode}.json`;
  }
  return `${base}${cfgSegment}/stream/movie/${imdbId}.json`;
}

/**
 * Build a magnet URI from a 40-hex or 32-base32 info hash.
 */
function buildMagnetFromHash(hash: string, title?: string): string | undefined {
  const trimmed = hash.trim();
  const hex40 = /^[a-fA-F0-9]{40}$/;
  const b32 = /^[A-Z2-7]{32,39}$/i;
  if (!hex40.test(trimmed) && !b32.test(trimmed)) return undefined;

  const hashUpper = trimmed.toUpperCase();
  const dn = title ? `&dn=${encodeURIComponent(title)}` : "";
  return `magnet:?xt=urn:btih:${hashUpper}${dn}`;
}

/**
 * Convert an array of raw Stremio streams into normalised ScraperResults.
 */
export function parseStremioStreams(
  streams: StremioStream[],
  source: string,
): ScraperResult[] {
  const results: ScraperResult[] = [];

  for (const s of streams) {
    const title = s.behaviorHints?.filename || s.title || s.name || "";
    const parsed = parseQualityFromName(s.name || "");

    let magnetUrl: string | undefined;
    let infoHash: string | undefined;

    if (s.infoHash) {
      infoHash = s.infoHash.toLowerCase();
      magnetUrl = buildMagnetFromHash(s.infoHash, title);
    }

    // If the addon only provides a direct URL (no hash), record it as magnetUrl
    // for downstream consumers that accept arbitrary URLs.
    if (!magnetUrl && s.url) {
      magnetUrl = s.url;
    }

    results.push({
      title,
      magnetUrl,
      infoHash,
      seeders: parsed.seeders,
      size: parsed.size,
      source,
    });
  }

  console.log(
    `[${new Date().toISOString()}][stremioScraper] parseStremioStreams`,
    { source, inputCount: streams.length, outputCount: results.length },
  );

  return results;
}
