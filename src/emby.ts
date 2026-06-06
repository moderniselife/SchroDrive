/**
 * SchroDrive — Emby Media Server Integration
 *
 * Provides watchlist/favourites polling and library refresh for Emby.
 * Emby's API is largely compatible with Jellyfin (they share a common ancestor),
 * but uses different auth headers and some endpoint differences.
 *
 * @module emby
 */

import axios from "axios";
import { config } from "./config";

// =============================================================================
// Types
// =============================================================================

/** A media item from Emby's favourites/library. */
export interface EmbyWatchlistItem {
  /** Emby item ID. */
  id: string;
  /** Title of the media item. */
  title: string;
  /** Release year. */
  year?: number;
  /** Media type: 'movie' or 'show'. */
  type: "movie" | "show";
  /** TMDB provider ID if available. */
  tmdbId?: number;
  /** TVDB provider ID if available. */
  tvdbId?: number;
  /** IMDB ID if available. */
  imdbId?: string;
}

// =============================================================================
// Emby API Client
// =============================================================================

/**
 * Fetches the current user's Emby favourites (used as watchlist).
 *
 * Requires EMBY_URL, EMBY_API_KEY, and EMBY_USER_ID.
 * Emby uses favourites as its watchlist equivalent.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
export async function getEmbyWatchlist(): Promise<EmbyWatchlistItem[]> {
  const baseUrl = config.embyUrl;
  const apiKey = config.embyApiKey;
  const userId = config.embyUserId;

  if (!baseUrl || !apiKey || !userId) {
    return [];
  }

  const url = `${baseUrl}/Users/${userId}/Items`;
  console.log(`[${new Date().toISOString()}][emby] GET ${url} (favourites)`);

  try {
    const res = await axios.get(url, {
      params: {
        IsFavorite: true,
        IncludeItemTypes: "Movie,Series",
        Recursive: true,
        Fields: "ProviderIds",
        SortBy: "DateCreated",
        SortOrder: "Descending",
        Limit: 100,
      },
      headers: {
        "X-Emby-Token": apiKey,
      },
      timeout: 15000,
    });

    const items = res.data?.Items || [];
    const mapped: EmbyWatchlistItem[] = items.map((item: any) => {
      const providerIds = item.ProviderIds || {};
      return {
        id: item.Id,
        title: item.Name,
        year: item.ProductionYear ?? undefined,
        type: item.Type === "Movie" ? "movie" : "show",
        tmdbId: providerIds.Tmdb ? Number(providerIds.Tmdb) : undefined,
        tvdbId: providerIds.Tvdb ? Number(providerIds.Tvdb) : undefined,
        imdbId: providerIds.Imdb || undefined,
      };
    });

    console.log(`[${new Date().toISOString()}][emby] Watchlist (favourites): ${mapped.length} items`);
    return mapped;
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][emby] Watchlist fetch failed:`, err?.message || String(err));
    return [];
  }
}

/**
 * Triggers a library scan on the Emby server.
 *
 * Uses the POST /Library/Refresh endpoint to trigger a full scan.
 */
export async function refreshEmbyLibrary(): Promise<void> {
  const baseUrl = config.embyUrl;
  const apiKey = config.embyApiKey;

  if (!baseUrl || !apiKey) return;

  const url = `${baseUrl}/Library/Refresh`;
  console.log(`[${new Date().toISOString()}][emby] POST ${url}`);

  try {
    await axios.post(url, null, {
      headers: {
        "X-Emby-Token": apiKey,
      },
      timeout: 10000,
    });
    console.log(`[${new Date().toISOString()}][emby] Library refresh triggered`);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][emby] Library refresh failed:`, err?.message || String(err));
  }
}
