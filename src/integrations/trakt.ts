/**
 * SchroDrive — Trakt Watchlist Integration
 *
 * Provides watchlist polling from Trakt.tv. Supports two authentication modes:
 *   - **OAuth2** (private lists): Uses traktClientId + traktAccessToken
 *   - **Public API key** (public lists): Uses traktClientId + traktUsername only
 *
 * If an OAuth access token is present and a request returns 401, an automatic
 * token refresh is attempted using the configured refresh token.
 *
 * @module trakt
 */

import axios from "axios";
import { config } from "../core/config";

// =============================================================================
// Types
// =============================================================================

/** A single item from a Trakt watchlist. */
export interface TraktWatchlistItem {
  /** Trakt slug identifier. */
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
// Trakt API Client
// =============================================================================

const TRAKT_BASE_URL = "https://api.trakt.tv";

/**
 * Builds the common headers required by the Trakt API.
 *
 * Always includes Content-Type, API version, and the client ID (API key).
 * If an OAuth access token is configured, the Authorization header is added.
 *
 * @returns Headers object for Trakt API requests
 */
function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": config.traktClientId,
  };

  if (config.traktAccessToken) {
    headers["Authorization"] = `Bearer ${config.traktAccessToken}`;
  }

  return headers;
}

/**
 * Attempts to refresh the Trakt OAuth access token using the refresh token.
 *
 * If successful, the new access token is logged to the console so the user
 * can update their environment variables. Note: the in-memory config is NOT
 * mutated — the refreshed token is only valid for the current request retry.
 *
 * @returns The new access token string, or undefined on failure
 */
async function refreshAccessToken(): Promise<string | undefined> {
  if (!config.traktRefreshToken || !config.traktClientId || !config.traktClientSecret) {
    console.warn(
      `[${new Date().toISOString()}][trakt] Cannot refresh token — missing traktRefreshToken or traktClientSecret`
    );
    return undefined;
  }

  const url = `${TRAKT_BASE_URL}/oauth/token`;
  console.log(`[${new Date().toISOString()}][trakt] POST ${url} (token refresh)`);

  try {
    const res = await axios.post(
      url,
      {
        refresh_token: config.traktRefreshToken,
        client_id: config.traktClientId,
        client_secret: config.traktClientSecret,
        redirect_uri: "urn:ietf:wg:oauth:2.0:oob",
        grant_type: "refresh_token",
      },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const newAccessToken: string = res.data?.access_token;
    const newRefreshToken: string = res.data?.refresh_token;

    if (newAccessToken) {
      console.log(
        `[${new Date().toISOString()}][trakt] Token refreshed successfully. Update your environment variables:`
      );
      console.log(`  TRAKT_ACCESS_TOKEN=${newAccessToken}`);
      if (newRefreshToken) {
        console.log(`  TRAKT_REFRESH_TOKEN=${newRefreshToken}`);
      }
      return newAccessToken;
    }

    console.warn(`[${new Date().toISOString()}][trakt] Token refresh response missing access_token`);
    return undefined;
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][trakt] Token refresh failed:`,
      err?.message || String(err)
    );
    return undefined;
  }
}

/**
 * Fetches a Trakt watchlist endpoint with automatic 401 retry via token refresh.
 *
 * @param url - Full URL to fetch
 * @param headers - Request headers
 * @returns Axios response data (array of watchlist entries)
 */
async function fetchWithRetry(url: string, headers: Record<string, string>): Promise<any[]> {
  try {
    const res = await axios.get(url, { headers, timeout: 15000 });
    return res.data || [];
  } catch (err: any) {
    // If 401 and we have a refresh token, attempt a token refresh and retry once
    if (err?.response?.status === 401 && config.traktRefreshToken) {
      console.warn(`[${new Date().toISOString()}][trakt] Received 401 — attempting token refresh`);
      const newToken = await refreshAccessToken();
      if (newToken) {
        const retryHeaders = { ...headers, Authorization: `Bearer ${newToken}` };
        const retryRes = await axios.get(url, { headers: retryHeaders, timeout: 15000 });
        return retryRes.data || [];
      }
    }
    throw err;
  }
}

/**
 * Fetches the configured user's Trakt watchlist (movies and shows).
 *
 * Requires at minimum traktClientId and traktUsername to be set.
 * If traktAccessToken is also set, private watchlists can be accessed.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
export async function getTraktWatchlist(): Promise<TraktWatchlistItem[]> {
  if (!isTraktConfigured()) {
    console.warn(
      `[${new Date().toISOString()}][trakt] Not configured — skipping watchlist fetch (need TRAKT_CLIENT_ID and TRAKT_USERNAME)`
    );
    return [];
  }

  const username = config.traktUsername;
  const headers = buildHeaders();
  const results: TraktWatchlistItem[] = [];

  // Fetch movies
  const moviesUrl = `${TRAKT_BASE_URL}/users/${username}/watchlist/movies?extended=full`;
  console.log(`[${new Date().toISOString()}][trakt] GET ${moviesUrl}`);

  try {
    const movies = await fetchWithRetry(moviesUrl, headers);
    for (const entry of movies) {
      const movie = entry?.movie;
      if (!movie) continue;
      results.push({
        id: movie.ids?.slug || String(movie.ids?.trakt || ""),
        title: movie.title,
        year: movie.year ?? undefined,
        type: "movie",
        tmdbId: movie.ids?.tmdb ?? undefined,
        imdbId: movie.ids?.imdb || undefined,
      });
    }
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][trakt] Movie watchlist fetch failed:`,
      err?.message || String(err)
    );
  }

  // Fetch shows
  const showsUrl = `${TRAKT_BASE_URL}/users/${username}/watchlist/shows?extended=full`;
  console.log(`[${new Date().toISOString()}][trakt] GET ${showsUrl}`);

  try {
    const shows = await fetchWithRetry(showsUrl, headers);
    for (const entry of shows) {
      const show = entry?.show;
      if (!show) continue;
      results.push({
        id: show.ids?.slug || String(show.ids?.trakt || ""),
        title: show.title,
        year: show.year ?? undefined,
        type: "show",
        tmdbId: show.ids?.tmdb ?? undefined,
        imdbId: show.ids?.imdb || undefined,
      });
    }
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][trakt] Show watchlist fetch failed:`,
      err?.message || String(err)
    );
  }

  console.log(`[${new Date().toISOString()}][trakt] Watchlist: ${results.length} items`);
  return results;
}

/**
 * Checks whether Trakt integration is configured.
 *
 * Requires both traktClientId and traktUsername to be set.
 *
 * @returns true if Trakt can be used
 */
export function isTraktConfigured(): boolean {
  return Boolean(config.traktClientId) && Boolean(config.traktUsername);
}
