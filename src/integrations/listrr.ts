/**
 * SchroDrive — Listrr Watchlist Integration
 *
 * Provides watchlist polling from listrr.pro. Fetches the user's movie and
 * show lists via the Listrr API and normalises items into a unified format.
 *
 * @module listrr
 */

import axios from "axios";
import { config } from "../core/config";

// =============================================================================
// Types
// =============================================================================

/** A single item from a Listrr watchlist. */
export interface ListrrWatchlistItem {
  /** Stringified TMDB ID or Listrr identifier. */
  id: string;
  /** Title of the media item. */
  title: string;
  /** Release year (may be undefined for upcoming content). */
  year?: number;
  /** Media type: 'movie' or 'show'. */
  type: "movie" | "show";
  /** TMDB provider ID if available. */
  tmdbId?: number;
}

// =============================================================================
// Listrr API Client
// =============================================================================

const LISTRR_BASE_URL = "https://listrr.pro/api";

/**
 * Builds the common headers required by the Listrr API.
 *
 * @returns Headers object for Listrr API requests
 */
function buildHeaders(): Record<string, string> {
  return {
    "X-Api-Key": config.listrrApiKey,
    "Content-Type": "application/json",
  };
}

/**
 * Fetches all items from a Listrr endpoint and maps them to our
 * normalised watchlist item shape.
 *
 * @param endpoint - API endpoint path (e.g. '/List/Movie')
 * @param mediaType - The media type to assign: 'movie' or 'show'
 * @returns Array of normalised ListrrWatchlistItem entries
 */
async function fetchListItems(
  endpoint: string,
  mediaType: "movie" | "show"
): Promise<ListrrWatchlistItem[]> {
  const url = `${LISTRR_BASE_URL}${endpoint}`;
  console.log(`[${new Date().toISOString()}][listrr] GET ${url}`);

  const res = await axios.get(url, {
    headers: buildHeaders(),
    timeout: 15000,
  });

  const lists = Array.isArray(res.data) ? res.data : [];
  const results: ListrrWatchlistItem[] = [];
  const seenIds = new Set<string>();

  for (const list of lists) {
    const items = Array.isArray(list.items) ? list.items : [];
    for (const item of items) {
      const tmdbId = item.theMovieDbId ?? undefined;
      const id = tmdbId != null ? String(tmdbId) : String(item.id || "");

      if (seenIds.has(id)) continue;
      seenIds.add(id);

      results.push({
        id,
        title: item.title || "",
        year: item.year ?? undefined,
        type: mediaType,
        tmdbId: tmdbId != null ? Number(tmdbId) : undefined,
      });
    }
  }

  return results;
}

/**
 * Fetches the user's Listrr watchlist items (movies and shows).
 *
 * Queries both the movie and show list endpoints and merges the results.
 *
 * @returns Array of watchlist items with title, year, type, and TMDB ID
 */
export async function getListrrWatchlist(): Promise<ListrrWatchlistItem[]> {
  if (!isListrrConfigured()) {
    console.warn(
      `[${new Date().toISOString()}][listrr] Not configured — skipping watchlist fetch (need LISTRR_API_KEY)`
    );
    return [];
  }

  const results: ListrrWatchlistItem[] = [];

  // Fetch movies
  try {
    const movies = await fetchListItems("/List/Movie", "movie");
    results.push(...movies);
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][listrr] Movie list fetch failed:`,
      err?.message || String(err)
    );
  }

  // Fetch shows
  try {
    const shows = await fetchListItems("/List/Show", "show");
    results.push(...shows);
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][listrr] Show list fetch failed:`,
      err?.message || String(err)
    );
  }

  console.log(`[${new Date().toISOString()}][listrr] Watchlist: ${results.length} items`);
  return results;
}

/**
 * Checks whether Listrr integration is configured.
 *
 * Requires listrrApiKey to be set.
 *
 * @returns true if Listrr can be used
 */
export function isListrrConfigured(): boolean {
  return Boolean(config.listrrApiKey);
}
