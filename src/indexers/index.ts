/**
 * SchröDrive — Unified Indexer + Scraper Layer
 *
 * Provides a single entry point for torrent searching across two systems:
 * 1. **Indexers** (Prowlarr, Jackett) — text-based torrent search
 * 2. **Scrapers** (Torrentio, Comet, Zilean, Mediafusion) — Stremio addon searches
 *
 * The `SCRAPER_MODE` config controls how scrapers integrate:
 * - `merge`: Combine indexer + scraper results, deduplicate by infoHash
 * - `fallback`: Only use scrapers when indexer returns 0 results
 *
 * @module indexers
 */

import { config } from "../core/config";
import {
  searchProwlarr,
  pickBestResult as pickBestProwlarr,
  getMagnet as getMagnetProwlarr,
  getMagnetOrResolve as getMagnetOrResolveProwlarr,
  testProwlarrConnection,
  ProwlarrResult,
} from "./prowlarr";
import {
  searchJackett,
  pickBestResult as pickBestJackett,
  getMagnet as getMagnetJackett,
  getMagnetOrResolve as getMagnetOrResolveJackett,
  testJackettConnection,
  JackettResult,
} from "./jackett";
import { searchTorrentio, isTorrentioConfigured } from "./torrentio";
import { searchComet, isCometConfigured } from "./comet";
import { searchZilean, isZileanConfigured } from "./zilean";
import { searchMediafusion, isMediafusionConfigured } from "./mediafusion";
import type { ScraperResult } from "./stremioScraper";

export type IndexerResult = ProwlarrResult | JackettResult;

export type IndexerProvider = "prowlarr" | "jackett";

export interface SearchOptions {
  categories?: string[];
  indexerIds?: string[];
  limit?: number;
  /** IMDB ID for scraper searches (e.g. 'tt1234567'). */
  imdbId?: string;
  /** Media type for scraper searches. */
  mediaType?: "movie" | "series";
  /** Season number for series scraper searches. */
  season?: number;
  /** Episode number for series scraper searches. */
  episode?: number;
}

let cachedProvider: IndexerProvider | null = null;

function isJackettConfigured(): boolean {
  return !!(config.jackettUrl && config.jackettApiKey);
}

function isProwlarrConfigured(): boolean {
  return !!(config.prowlarrUrl && config.prowlarrApiKey);
}

export async function detectActiveProvider(): Promise<IndexerProvider | null> {
  if (cachedProvider) return cachedProvider;

  const provider = config.indexerProvider;

  if (provider === "jackett") {
    if (isJackettConfigured()) {
      cachedProvider = "jackett";
      return "jackett";
    }
    console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=jackett but Jackett not configured`);
    return null;
  }

  if (provider === "prowlarr") {
    if (isProwlarrConfigured()) {
      cachedProvider = "prowlarr";
      return "prowlarr";
    }
    console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=prowlarr but Prowlarr not configured`);
    return null;
  }

  // Auto mode: try Jackett first (if configured), then Prowlarr
  if (isJackettConfigured()) {
    console.log(`[${new Date().toISOString()}][indexer] auto-detected Jackett as indexer provider`);
    cachedProvider = "jackett";
    return "jackett";
  }

  if (isProwlarrConfigured()) {
    console.log(`[${new Date().toISOString()}][indexer] auto-detected Prowlarr as indexer provider`);
    cachedProvider = "prowlarr";
    return "prowlarr";
  }

  console.warn(`[${new Date().toISOString()}][indexer] no indexer provider configured`);
  return null;
}

export function getActiveProvider(): IndexerProvider | null {
  if (cachedProvider) return cachedProvider;

  const provider = config.indexerProvider;

  if (provider === "jackett" && isJackettConfigured()) {
    cachedProvider = "jackett";
    return "jackett";
  }

  if (provider === "prowlarr" && isProwlarrConfigured()) {
    cachedProvider = "prowlarr";
    return "prowlarr";
  }

  // Auto mode
  if (provider === "auto") {
    if (isJackettConfigured()) {
      cachedProvider = "jackett";
      return "jackett";
    }
    if (isProwlarrConfigured()) {
      cachedProvider = "prowlarr";
      return "prowlarr";
    }
  }

  return null;
}

export function clearProviderCache(): void {
  cachedProvider = null;
}

export async function testIndexerConnection(): Promise<boolean> {
  const provider = getActiveProvider();

  if (provider === "jackett") {
    return testJackettConnection();
  }

  if (provider === "prowlarr") {
    return testProwlarrConnection();
  }

  console.warn(`[${new Date().toISOString()}][indexer] no provider configured for connection test`);
  return false;
}

// =============================================================================
// Indexer Search (Prowlarr / Jackett)
// =============================================================================

export async function searchIndexer(query: string, opts?: SearchOptions): Promise<IndexerResult[]> {
  const provider = getActiveProvider();

  if (provider === "jackett") {
    return searchJackett(query, opts);
  }

  if (provider === "prowlarr") {
    return searchProwlarr(query, opts);
  }

  throw new Error("No indexer provider configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
}

// =============================================================================
// Scraper Search (Torrentio, Comet, Zilean, Mediafusion)
// =============================================================================

/**
 * Returns true if at least one scraper is configured and enabled.
 */
export function isAnyScraperConfigured(): boolean {
  return isTorrentioConfigured() || isCometConfigured() || isZileanConfigured() || isMediafusionConfigured();
}

/**
 * Searches all configured and enabled scrapers in parallel.
 *
 * Stremio addon scrapers (Torrentio, Comet, Mediafusion) require an IMDB ID.
 * Zilean uses text search and does not require an IMDB ID.
 *
 * @param query - Text query (used by Zilean)
 * @param opts - Search options including IMDB ID for Stremio addon searches
 * @returns Merged, deduplicated scraper results
 */
export async function searchScrapers(query: string, opts?: SearchOptions): Promise<ScraperResult[]> {
  const promises: Promise<ScraperResult[]>[] = [];
  const imdbId = opts?.imdbId;
  const mediaType = opts?.mediaType || "movie";
  const season = opts?.season;
  const episode = opts?.episode;

  // Stremio addon scrapers require an IMDB ID
  if (imdbId) {
    if (isTorrentioConfigured()) {
      promises.push(searchTorrentio(imdbId, mediaType, season, episode).catch(err => {
        console.warn(`[${new Date().toISOString()}][scrapers] Torrentio failed:`, err?.message);
        return [];
      }));
    }
    if (isCometConfigured()) {
      promises.push(searchComet(imdbId, mediaType, season, episode).catch(err => {
        console.warn(`[${new Date().toISOString()}][scrapers] Comet failed:`, err?.message);
        return [];
      }));
    }
    if (isMediafusionConfigured()) {
      promises.push(searchMediafusion(imdbId, mediaType, season, episode).catch(err => {
        console.warn(`[${new Date().toISOString()}][scrapers] Mediafusion failed:`, err?.message);
        return [];
      }));
    }
  }

  // Zilean uses text search — no IMDB ID required
  if (isZileanConfigured()) {
    promises.push(searchZilean(query).catch(err => {
      console.warn(`[${new Date().toISOString()}][scrapers] Zilean failed:`, err?.message);
      return [];
    }));
  }

  if (promises.length === 0) return [];

  const results = await Promise.all(promises);
  const merged = results.flat();

  // Deduplicate by infoHash
  const seen = new Set<string>();
  const deduped: ScraperResult[] = [];
  for (const r of merged) {
    const key = r.infoHash?.toLowerCase() || r.magnetUrl || r.title;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  console.log(`[${new Date().toISOString()}][scrapers] total: ${merged.length}, deduped: ${deduped.length}`);
  return deduped;
}

// =============================================================================
// Unified Search (Indexer + Scrapers)
// =============================================================================

/**
 * Searches both indexers and scrapers according to the configured scraper mode.
 *
 * - `merge`: Runs indexer + scrapers in parallel, merges and deduplicates
 * - `fallback`: Runs indexer first; only runs scrapers if indexer returns 0
 *
 * @param query - Text search query
 * @param opts - Search options (categories, IMDB ID, etc.)
 * @returns Combined results from all sources
 */
export async function searchAll(query: string, opts?: SearchOptions): Promise<(IndexerResult | ScraperResult)[]> {
  const hasIndexer = isIndexerConfigured();
  const hasScrapers = isAnyScraperConfigured();

  if (!hasIndexer && !hasScrapers) {
    throw new Error("No indexer or scraper configured. Set up Prowlarr/Jackett or enable a scraper.");
  }

  const mode = config.scraperMode;

  if (mode === "merge") {
    // Run indexer + scrapers in parallel
    const [indexerResults, scraperResults] = await Promise.all([
      hasIndexer ? searchIndexer(query, opts).catch(() => [] as IndexerResult[]) : Promise.resolve([] as IndexerResult[]),
      hasScrapers ? searchScrapers(query, opts).catch(() => [] as ScraperResult[]) : Promise.resolve([] as ScraperResult[]),
    ]);

    // Merge with indexer results taking priority (they have richer metadata)
    const merged: (IndexerResult | ScraperResult)[] = [...indexerResults];
    const indexerHashes = new Set(
      indexerResults
        .map((r: any) => (r.infoHash || r.infohash || r.hash || "").toLowerCase())
        .filter(Boolean),
    );

    for (const sr of scraperResults) {
      const hash = sr.infoHash?.toLowerCase();
      if (!hash || !indexerHashes.has(hash)) {
        merged.push(sr);
      }
    }

    console.log(`[${new Date().toISOString()}][search] merge mode — indexer: ${indexerResults.length}, scrapers: ${scraperResults.length}, merged: ${merged.length}`);
    return merged;
  }

  // Fallback mode
  if (hasIndexer) {
    const indexerResults = await searchIndexer(query, opts);
    if (indexerResults.length > 0) {
      return indexerResults;
    }
    console.log(`[${new Date().toISOString()}][search] indexer returned 0, falling back to scrapers`);
  }

  if (hasScrapers) {
    return searchScrapers(query, opts);
  }

  return [];
}

// =============================================================================
// Helpers (backward-compatible exports)
// =============================================================================

export function pickBestResult(results: (IndexerResult | ScraperResult)[]): IndexerResult | ScraperResult | undefined {
  // Separate into indexer and scraper results
  const indexerResults = results.filter((r): r is IndexerResult => !('source' in r));
  const scraperResults = results.filter((r): r is ScraperResult => 'source' in r);

  const provider = getActiveProvider();

  // If we have indexer results, use the indexer's picker
  if (indexerResults.length > 0) {
    if (provider === "jackett") {
      return pickBestJackett(indexerResults as JackettResult[]);
    }
    return pickBestProwlarr(indexerResults as ProwlarrResult[]);
  }

  // For scraper results, sort by seeders desc, then size desc
  if (scraperResults.length > 0) {
    const sorted = scraperResults
      .slice()
      .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || (b.size || 0) - (a.size || 0));
    return sorted[0];
  }

  return undefined;
}

export function getMagnet(r: IndexerResult | ScraperResult | undefined): string | undefined {
  if (!r) return undefined;

  // Scraper results have magnetUrl directly
  if ('source' in r) {
    return (r as ScraperResult).magnetUrl;
  }

  const provider = getActiveProvider();

  if (provider === "jackett") {
    return getMagnetJackett(r as JackettResult);
  }

  return getMagnetProwlarr(r as ProwlarrResult);
}

export async function getMagnetOrResolve(r: IndexerResult | ScraperResult | undefined): Promise<string | undefined> {
  if (!r) return undefined;

  // Scraper results already have resolved magnets
  if ('source' in r) {
    return (r as ScraperResult).magnetUrl;
  }

  const provider = getActiveProvider();

  if (provider === "jackett") {
    return getMagnetOrResolveJackett(r as JackettResult);
  }

  return getMagnetOrResolveProwlarr(r as ProwlarrResult);
}

export function getProviderName(): string {
  const provider = getActiveProvider();
  const scrapers: string[] = [];
  if (isTorrentioConfigured()) scrapers.push("torrentio");
  if (isCometConfigured()) scrapers.push("comet");
  if (isZileanConfigured()) scrapers.push("zilean");
  if (isMediafusionConfigured()) scrapers.push("mediafusion");

  const parts = [provider || "none"];
  if (scrapers.length > 0) parts.push(`+${scrapers.join(",")}`);
  return parts.join("");
}

export function isIndexerConfigured(): boolean {
  return isJackettConfigured() || isProwlarrConfigured();
}

/**
 * Returns true if any search source is configured (indexer or scraper).
 */
export function isAnySearchConfigured(): boolean {
  return isIndexerConfigured() || isAnyScraperConfigured();
}
