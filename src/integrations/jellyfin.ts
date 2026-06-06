/**
 * SchroDrive — Jellyfin Media Server Integration
 *
 * Provides watchlist/favourites polling and library refresh for Jellyfin.
 * Jellyfin doesn't have a native "watchlist" — instead we poll the user's
 * favourites list which serves the same purpose.
 *
 * @module jellyfin
 */

import axios from "axios";
import { config } from "../core/config";

// =============================================================================
// Types
// =============================================================================

/** A media item from Jellyfin's favourites/library. */
export interface JellyfinWatchlistItem {
  /** Jellyfin item ID. */
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
// Jellyfin API Client
// =============================================================================

/**
 * Fetches the current user's Jellyfin favourites (used as watchlist).
 *
 * Requires JELLYFIN_URL, JELLYFIN_API_KEY, and JELLYFIN_USER_ID.
 * Jellyfin uses favourites as its watchlist equivalent.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
export async function getJellyfinWatchlist(): Promise<JellyfinWatchlistItem[]> {
  const baseUrl = config.jellyfinUrl;
  const apiKey = config.jellyfinApiKey;
  const userId = config.jellyfinUserId;

  if (!baseUrl || !apiKey || !userId) {
    return [];
  }

  // Fetch both movies and series that are marked as favourites
  const url = `${baseUrl}/Users/${userId}/Items`;
  console.log(`[${new Date().toISOString()}][jellyfin] GET ${url} (favourites)`);

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
        "X-Emby-Authorization": `MediaBrowser Token="${apiKey}"`,
      },
      timeout: 15000,
    });

    const items = res.data?.Items || [];
    const mapped: JellyfinWatchlistItem[] = items.map((item: any) => {
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

    console.log(`[${new Date().toISOString()}][jellyfin] Watchlist (favourites): ${mapped.length} items`);
    return mapped;
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][jellyfin] Watchlist fetch failed:`, err?.message || String(err));
    return [];
  }
}

/**
 * Triggers a library scan on the Jellyfin server.
 *
 * Uses the POST /Library/Refresh endpoint to trigger a full scan.
 */
export async function refreshJellyfinLibrary(): Promise<void> {
  const baseUrl = config.jellyfinUrl;
  const apiKey = config.jellyfinApiKey;

  if (!baseUrl || !apiKey) return;

  const url = `${baseUrl}/Library/Refresh`;
  console.log(`[${new Date().toISOString()}][jellyfin] POST ${url}`);

  try {
    await axios.post(url, null, {
      headers: {
        "X-Emby-Authorization": `MediaBrowser Token="${apiKey}"`,
      },
      timeout: 10000,
    });
    console.log(`[${new Date().toISOString()}][jellyfin] Library refresh triggered`);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][jellyfin] Library refresh failed:`, err?.message || String(err));
  }
}

/**
 * Checks if there are any active playing sessions on the Jellyfin server.
 *
 * @returns `true` if Jellyfin has active playing sessions.
 */
export async function isJellyfinStreaming(): Promise<boolean> {
  const baseUrl = config.jellyfinUrl;
  const apiKey = config.jellyfinApiKey;
  if (!baseUrl || !apiKey) return false;

  const url = `${baseUrl.replace(/\/$/, "")}/Sessions`;
  try {
    const res = await axios.get(url, {
      headers: {
        "X-Emby-Authorization": `MediaBrowser Token="${apiKey}"`,
        Accept: "application/json",
      },
      timeout: 5000,
    });

    const sessions = Array.isArray(res.data) ? res.data : [];
    // Check if any session is currently playing media (i.e. has NowPlayingItem)
    return sessions.some((s: any) => s.NowPlayingItem);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][jellyfin] Failed to check Jellyfin streaming sessions:`, err?.message || String(err));
    return false;
  }
}

