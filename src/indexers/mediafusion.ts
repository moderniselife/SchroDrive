/**
 * mediafusion.ts — Mediafusion Stremio addon scraper.
 *
 * Queries the Mediafusion addon using the standard Stremio stream protocol
 * and returns normalised ScraperResult objects for downstream processing.
 */

import axios from "axios";
import { config } from "../core/config";
import {
  type ScraperResult,
  type StremioResponse,
  buildStremioUrl,
  parseStremioStreams,
} from "./stremioScraper";

const SOURCE = "mediafusion";
const TIMEOUT_MS = 15_000;

/**
 * Returns `true` when Mediafusion scraping is both enabled and minimally
 * configured (a base URL must be present).
 */
export function isMediafusionConfigured(): boolean {
  return config.mediafusionEnabled && !!config.mediafusionUrl;
}

/**
 * Search Mediafusion for streams matching the given IMDB ID.
 *
 * @param imdbId   — IMDB title ID, e.g. "tt1234567"
 * @param type     — "movie" or "series"
 * @param season   — Season number (series only)
 * @param episode  — Episode number (series only)
 * @returns Array of normalised ScraperResult objects
 */
export async function searchMediafusion(
  imdbId: string,
  type: "movie" | "series",
  season?: number,
  episode?: number,
): Promise<ScraperResult[]> {
  if (!isMediafusionConfigured()) {
    console.warn(
      `[${new Date().toISOString()}][${SOURCE}] skipped — not configured or disabled`,
    );
    return [];
  }

  const url = buildStremioUrl(
    config.mediafusionUrl,
    config.mediafusionConfig,
    type,
    imdbId,
    season,
    episode,
  );

  const started = Date.now();
  console.log(`[${new Date().toISOString()}][${SOURCE}] GET ${url}`, {
    imdbId,
    type,
    season,
    episode,
    timeoutMs: TIMEOUT_MS,
  });

  try {
    const res = await axios.get<StremioResponse>(url, { timeout: TIMEOUT_MS });

    const streams = res.data?.streams ?? [];
    console.log(`[${new Date().toISOString()}][${SOURCE}] response`, {
      count: streams.length,
      ms: Date.now() - started,
      sample: streams.slice(0, 3).map((s) => ({
        name: s.name?.slice(0, 60),
        hasHash: !!s.infoHash,
      })),
    });

    return parseStremioStreams(streams, SOURCE);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][${SOURCE}] request failed`, {
      url,
      error: err?.message || String(err),
      code: err?.code,
      status: err?.response?.status,
      ms: Date.now() - started,
    });
    return [];
  }
}
