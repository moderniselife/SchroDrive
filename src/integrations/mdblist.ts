/**
 * SchroDrive — Mdblist Watchlist Integration
 *
 * Provides watchlist polling from mdblist.com. Supports two modes:
 *   - **Specific lists**: If mdblistListIds are configured, fetches items from
 *     those lists directly.
 *   - **All user lists**: If no list IDs are set, discovers the user's lists
 *     first and then fetches items from each.
 *
 * @module mdblist
 */

import axios from "axios";
import { config } from "../core/config";

// =============================================================================
// Types
// =============================================================================

/** A single item from an Mdblist watchlist. */
export interface MdblistWatchlistItem {
  /** Mdblist item ID. */
  id: string;
  /** Title of the media item. */
  title: string;
  /** Release year (may be undefined for upcoming content). */
  year?: number;
  /** Media type: 'movie' or 'show'. */
  type: "movie" | "show";
  /** TMDB provider ID if available. */
  tmdbId?: number;
  /** IMDB ID if available. */
  imdbId?: string;
}

// =============================================================================
// Mdblist API Client
// =============================================================================

const MDBLIST_BASE_URL = "https://mdblist.com/api";

/**
 * Fetches items from a single Mdblist list by its ID.
 *
 * @param listId - The Mdblist list ID to fetch items from
 * @returns Array of raw Mdblist list items
 */
async function fetchListItems(listId: string): Promise<any[]> {
  const url = `${MDBLIST_BASE_URL}/lists/${listId}/items`;
  console.log(`[${new Date().toISOString()}][mdblist] GET ${url}`);

  const res = await axios.get(url, {
    params: { apikey: config.mdblistApiKey },
    timeout: 15000,
  });

  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Discovers all lists belonging to the authenticated user.
 *
 * @returns Array of list objects containing at least an id field
 */
async function fetchUserLists(): Promise<Array<{ id: string }>> {
  const url = `${MDBLIST_BASE_URL}/lists/user`;
  console.log(`[${new Date().toISOString()}][mdblist] GET ${url} (user lists)`);

  const res = await axios.get(url, {
    params: { apikey: config.mdblistApiKey },
    timeout: 15000,
  });

  return Array.isArray(res.data) ? res.data : [];
}

/**
 * Maps a raw Mdblist API item to our normalised watchlist item shape.
 *
 * @param item - Raw item from the Mdblist API
 * @returns Normalised MdblistWatchlistItem
 */
function mapItem(item: any): MdblistWatchlistItem {
  return {
    id: String(item.id || ""),
    title: item.title || "",
    year: item.year ?? undefined,
    type: item.mediatype === "movie" ? "movie" : "show",
    tmdbId: item.tmdb_id ?? undefined,
    imdbId: item.imdb_id || undefined,
  };
}

/**
 * Fetches the user's Mdblist watchlist items.
 *
 * If mdblistListIds are configured, fetches items from those specific lists.
 * Otherwise, discovers the user's lists first and then fetches items from each.
 * Duplicate items (by id) are deduplicated across lists.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
export async function getMdblistWatchlist(): Promise<MdblistWatchlistItem[]> {
  if (!isMdblistConfigured()) {
    console.warn(
      `[${new Date().toISOString()}][mdblist] Not configured — skipping watchlist fetch (need MDBLIST_API_KEY)`
    );
    return [];
  }

  const seenIds = new Set<string>();
  const results: MdblistWatchlistItem[] = [];

  try {
    // Determine which list IDs to fetch
    let listIds: string[] = config.mdblistListIds;

    if (listIds.length === 0) {
      // No specific lists configured — discover user's lists
      const userLists = await fetchUserLists();
      listIds = userLists.map((l) => String(l.id));
      console.log(`[${new Date().toISOString()}][mdblist] Discovered ${listIds.length} user lists`);
    }

    // Fetch items from each list
    for (const listId of listIds) {
      try {
        const items = await fetchListItems(listId);
        for (const item of items) {
          const mapped = mapItem(item);
          if (!seenIds.has(mapped.id)) {
            seenIds.add(mapped.id);
            results.push(mapped);
          }
        }
      } catch (err: any) {
        console.error(
          `[${new Date().toISOString()}][mdblist] Failed to fetch list ${listId}:`,
          err?.message || String(err)
        );
      }
    }
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][mdblist] Watchlist fetch failed:`,
      err?.message || String(err)
    );
    return [];
  }

  console.log(`[${new Date().toISOString()}][mdblist] Watchlist: ${results.length} items`);
  return results;
}

/**
 * Checks whether Mdblist integration is configured.
 *
 * Requires mdblistApiKey to be set.
 *
 * @returns true if Mdblist can be used
 */
export function isMdblistConfigured(): boolean {
  return Boolean(config.mdblistApiKey);
}
