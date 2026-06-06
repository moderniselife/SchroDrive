/**
 * SchroDrive — Plex Media Server Integration
 *
 * Provides watchlist polling and library refresh for Plex Media Server.
 * Polls the user's Plex watchlist at a configurable interval and triggers
 * torrent searches for new items via the indexer (Prowlarr/Jackett).
 *
 * @module plex
 */

import axios from "axios";
import { config } from "./config";

// =============================================================================
// Types
// =============================================================================

/** A single item from a Plex watchlist or library section. */
export interface PlexWatchlistItem {
  /** Plex rating key (unique identifier). */
  ratingKey: string;
  /** Title of the media item. */
  title: string;
  /** Release year (may be undefined for upcoming content). */
  year?: number;
  /** Media type: 'movie' or 'show'. */
  type: "movie" | "show";
  /** GUID string from Plex (e.g. 'tmdb://12345' or 'tvdb://67890'). */
  guid?: string;
  /** Alternative GUIDs provided by Plex. */
  guids?: Array<{ id: string }>;
  /** Poster thumbnail URL. */
  thumb?: string;
}

/** A Plex library section (e.g. "Movies", "TV Shows"). */
export interface PlexLibrarySection {
  /** Section key identifier. */
  key: string;
  /** Section title. */
  title: string;
  /** Section type (e.g. 'movie', 'show'). */
  type: string;
}

// =============================================================================
// Plex API Client
// =============================================================================

const PLEX_METADATA_URL = "https://metadata.provider.plex.tv";

/**
 * Fetches the current user's Plex watchlist.
 *
 * Uses the Plex metadata API at metadata.provider.plex.tv which
 * requires a valid Plex authentication token.
 *
 * @returns Array of watchlist items with title, year, type, and GUID info
 */
export async function getPlexWatchlist(): Promise<PlexWatchlistItem[]> {
  const token = config.plexToken;
  if (!token) {
    console.warn(`[${new Date().toISOString()}][plex] No PLEX_TOKEN configured — skipping watchlist fetch`);
    return [];
  }

  const url = `${PLEX_METADATA_URL}/library/sections/watchlist/all`;
  console.log(`[${new Date().toISOString()}][plex] GET ${url}`);

  try {
    const res = await axios.get(url, {
      headers: {
        "X-Plex-Token": token,
        Accept: "application/json",
      },
      timeout: 15000,
    });

    const items = res.data?.MediaContainer?.Metadata || [];
    const mapped: PlexWatchlistItem[] = items.map((item: any) => ({
      ratingKey: item.ratingKey,
      title: item.title,
      year: item.year ?? undefined,
      type: item.type === "movie" ? "movie" : "show",
      guid: item.guid,
      guids: item.Guid || [],
      thumb: item.thumb,
    }));

    console.log(`[${new Date().toISOString()}][plex] Watchlist: ${mapped.length} items`);
    return mapped;
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][plex] Watchlist fetch failed:`, err?.message || String(err));
    return [];
  }
}

/**
 * Lists all library sections from the configured Plex server.
 *
 * @returns Array of library sections with key, title, and type
 */
export async function getPlexLibrarySections(): Promise<PlexLibrarySection[]> {
  const plexUrl = config.plexUrl;
  const token = config.plexToken;
  if (!plexUrl || !token) return [];

  const url = `${plexUrl}/library/sections`;
  console.log(`[${new Date().toISOString()}][plex] GET ${url}`);

  try {
    const res = await axios.get(url, {
      headers: {
        "X-Plex-Token": token,
        Accept: "application/json",
      },
      timeout: 10000,
    });

    const sections = res.data?.MediaContainer?.Directory || [];
    return sections.map((s: any) => ({
      key: s.key,
      title: s.title,
      type: s.type,
    }));
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][plex] Library sections fetch failed:`, err?.message || String(err));
    return [];
  }
}

/**
 * Triggers a library scan/refresh on the Plex server.
 *
 * If a section key is provided, only that section is refreshed.
 * Otherwise, all sections are refreshed.
 *
 * @param sectionKey - Optional specific library section to refresh
 */
export async function refreshPlexLibrary(sectionKey?: string): Promise<void> {
  const plexUrl = config.plexUrl;
  const token = config.plexToken;
  if (!plexUrl || !token) return;

  const sections = sectionKey
    ? [{ key: sectionKey }]
    : await getPlexLibrarySections();

  for (const section of sections) {
    const url = `${plexUrl}/library/sections/${section.key}/refresh`;
    console.log(`[${new Date().toISOString()}][plex] POST ${url}`);
    try {
      await axios.get(url, {
        headers: { "X-Plex-Token": token },
        timeout: 10000,
      });
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][plex] Refresh failed for section ${section.key}:`, err?.message || String(err));
    }
  }
}

/**
 * Extracts a TMDB ID from Plex GUID strings.
 *
 * Plex provides GUIDs like 'tmdb://12345' or 'com.plexapp.agents.themoviedb://12345'.
 *
 * @param item - Plex watchlist item with guid/guids fields
 * @returns TMDB ID as a number, or undefined if not found
 */
export function extractTmdbId(item: PlexWatchlistItem): number | undefined {
  // Check the main guid field
  const tmdbMatch = item.guid?.match(/tmdb:\/\/(\d+)/);
  if (tmdbMatch) return Number(tmdbMatch[1]);

  // Check alternative guids array
  for (const g of item.guids || []) {
    const match = g.id?.match(/tmdb:\/\/(\d+)/);
    if (match) return Number(match[1]);
  }

  return undefined;
}

/**
 * Extracts a TVDB ID from Plex GUID strings.
 *
 * @param item - Plex watchlist item with guid/guids fields
 * @returns TVDB ID as a number, or undefined if not found
 */
export function extractTvdbId(item: PlexWatchlistItem): number | undefined {
  const tvdbMatch = item.guid?.match(/tvdb:\/\/(\d+)/);
  if (tvdbMatch) return Number(tvdbMatch[1]);

  for (const g of item.guids || []) {
    const match = g.id?.match(/tvdb:\/\/(\d+)/);
    if (match) return Number(match[1]);
  }

  return undefined;
}
