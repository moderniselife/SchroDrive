/**
 * SchroDrive — Unified Media Server Watchlist Poller
 *
 * Polls watchlists from all configured media servers (Plex, Jellyfin, Emby)
 * at a configurable interval. When new items are detected, they are searched
 * via the indexer (Prowlarr/Jackett) and the best torrent is added to the
 * configured debrid providers (RealDebrid/TorBox).
 *
 * After a successful torrent add, the relevant media server library is
 * refreshed to pick up the new content.
 *
 * @module mediaServerWatchlist
 */

import { config } from "./config";
import { getPlexWatchlist, extractTmdbId, refreshPlexLibrary, type PlexWatchlistItem } from "./plex";
import { getJellyfinWatchlist, refreshJellyfinLibrary, type JellyfinWatchlistItem } from "./jellyfin";
import { getEmbyWatchlist, refreshEmbyLibrary, type EmbyWatchlistItem } from "./emby";
import { searchIndexer, pickBestResult, getMagnet, getMagnetOrResolve, getProviderName, isIndexerConfigured } from "./indexer";
import { addMagnetToTorbox, checkExistingTorrents } from "./torbox";
import { addMagnetToRD } from "./realdebrid";

// =============================================================================
// Types
// =============================================================================

/** Normalised watchlist item from any media server. */
interface UnifiedWatchlistItem {
  /** Unique key for deduplication (source:id). */
  key: string;
  /** Source media server. */
  source: "plex" | "jellyfin" | "emby";
  /** Title of the media item. */
  title: string;
  /** Release year. */
  year?: number;
  /** Media type. */
  type: "movie" | "show";
  /** TMDB ID if available. */
  tmdbId?: number;
}

// =============================================================================
// Normalisation
// =============================================================================

/**
 * Normalises watchlist items from all configured media servers into a
 * unified format for processing.
 */
async function fetchAllWatchlists(): Promise<UnifiedWatchlistItem[]> {
  const items: UnifiedWatchlistItem[] = [];

  // Plex
  if (config.plexToken) {
    try {
      const plexItems = await getPlexWatchlist();
      for (const item of plexItems) {
        items.push({
          key: `plex:${item.ratingKey}`,
          source: "plex",
          title: item.title,
          year: item.year,
          type: item.type,
          tmdbId: extractTmdbId(item),
        });
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist] Plex fetch error:`, err?.message || String(err));
    }
  }

  // Jellyfin
  if (config.jellyfinUrl && config.jellyfinApiKey) {
    try {
      const jfItems = await getJellyfinWatchlist();
      for (const item of jfItems) {
        items.push({
          key: `jellyfin:${item.id}`,
          source: "jellyfin",
          title: item.title,
          year: item.year,
          type: item.type,
          tmdbId: item.tmdbId,
        });
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist] Jellyfin fetch error:`, err?.message || String(err));
    }
  }

  // Emby
  if (config.embyUrl && config.embyApiKey) {
    try {
      const embyItems = await getEmbyWatchlist();
      for (const item of embyItems) {
        items.push({
          key: `emby:${item.id}`,
          source: "emby",
          title: item.title,
          year: item.year,
          type: item.type,
          tmdbId: item.tmdbId,
        });
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist] Emby fetch error:`, err?.message || String(err));
    }
  }

  return items;
}

// =============================================================================
// Poller
// =============================================================================

/** Set of already-processed watchlist item keys to avoid re-processing. */
const processed = new Set<string>();

/**
 * Builds a search query string from a watchlist item.
 *
 * @param item - Normalised watchlist item
 * @returns Search query string or undefined if not enough info
 */
function buildSearchQuery(item: UnifiedWatchlistItem): string | undefined {
  let query = item.title;
  if (item.year) query += ` ${item.year}`;
  if (item.tmdbId) query += ` TMDB${item.tmdbId}`;
  return query || undefined;
}

/**
 * Determines the best torrent categories for the media type.
 */
function categoriesForType(type: "movie" | "show"): string[] {
  // Category 5000 covers both movies and TV on most indexers
  return ["5000"];
}

/**
 * Refreshes the library for the media server that sourced this item.
 */
async function refreshSourceLibrary(source: "plex" | "jellyfin" | "emby"): Promise<void> {
  switch (source) {
    case "plex":
      await refreshPlexLibrary();
      break;
    case "jellyfin":
      await refreshJellyfinLibrary();
      break;
    case "emby":
      await refreshEmbyLibrary();
      break;
  }
}

/**
 * Processes a single watchlist item — searches, adds to debrid, refreshes library.
 *
 * @param item - Normalised watchlist item to process
 * @returns true if the item was successfully processed (torrent added)
 */
async function processWatchlistItem(item: UnifiedWatchlistItem): Promise<boolean> {
  const query = buildSearchQuery(item);
  if (!query) {
    console.warn(`[${new Date().toISOString()}][watchlist] Cannot build query for: ${item.key}`);
    return false;
  }

  const categories = categoriesForType(item.type);
  const indexerName = getProviderName();

  console.log(`[${new Date().toISOString()}][watchlist→${indexerName}] Searching: "${query}"`);
  const t0 = Date.now();
  const results = await searchIndexer(query, { categories });
  console.log(`[${new Date().toISOString()}][watchlist→${indexerName}] ${results.length} results (${Date.now() - t0}ms)`);

  const best = pickBestResult(results);
  if (!best) {
    console.warn(`[${new Date().toISOString()}][watchlist] No results for: "${query}"`);
    return false;
  }

  // Try to get a magnet URI — try best first, then scan other candidates
  let magnet: string | undefined = undefined;
  let chosenTitle: string = (best as any)?.title || query;
  const sorted = results
    .slice()
    .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));

  for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
    magnet = getMagnet(cand);
    if (!magnet) {
      try {
        magnet = await getMagnetOrResolve(cand);
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][watchlist] Magnet resolve failed:`, e?.message || String(e));
      }
    }
    if (magnet) {
      chosenTitle = (cand as any)?.title || chosenTitle;
      break;
    }
  }

  if (!magnet) {
    console.warn(`[${new Date().toISOString()}][watchlist] No magnet found for: "${query}"`);
    return false;
  }

  // Check for duplicates
  const hasExisting = await checkExistingTorrents(chosenTitle);
  if (hasExisting) {
    console.log(`[${new Date().toISOString()}][watchlist] Skipping duplicate: "${chosenTitle}"`);
    return true; // Mark as processed since it already exists
  }

  // Add to configured debrid providers
  const providers = config.providers;
  let added = false;

  if (providers.includes("torbox") && config.torboxApiKey) {
    try {
      console.log(`[${new Date().toISOString()}][watchlist→torbox] Adding: "${chosenTitle}"`);
      await addMagnetToTorbox(magnet, chosenTitle);
      added = true;
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist→torbox] Add failed:`, err?.message || String(err));
    }
  }

  if (providers.includes("realdebrid") && config.rdAccessToken) {
    try {
      console.log(`[${new Date().toISOString()}][watchlist→realdebrid] Adding: "${chosenTitle}"`);
      await addMagnetToRD(magnet);
      added = true;
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist→realdebrid] Add failed:`, err?.message || String(err));
    }
  }

  // Refresh the source media server library after successful add
  if (added) {
    try {
      await refreshSourceLibrary(item.source);
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][watchlist] Library refresh failed:`, err?.message || String(err));
    }
  }

  return added;
}

/**
 * Single tick of the watchlist poller — fetches all watchlists,
 * processes new items, and adds torrents.
 */
async function pollOnce(): Promise<void> {
  try {
    console.log(`[${new Date().toISOString()}][watchlist] Polling all configured media servers...`);
    const items = await fetchAllWatchlists();
    console.log(`[${new Date().toISOString()}][watchlist] Total watchlist items: ${items.length}`);

    let newCount = 0;
    for (const item of items) {
      if (processed.has(item.key)) continue;

      try {
        const success = await processWatchlistItem(item);
        if (success) {
          processed.add(item.key);
          newCount++;
        } else {
          // Still mark as processed to avoid hammering the indexer
          // Item will be retried if the user re-adds or if we restart
          processed.add(item.key);
        }
      } catch (err: any) {
        console.error(`[${new Date().toISOString()}][watchlist] Error processing ${item.key}:`, err?.message || String(err));
        // Don't add to processed — will retry next tick
      }

      // Trim processed set to avoid memory growth
      if (processed.size > 2000) {
        const first = processed.values().next().value as string | undefined;
        if (typeof first === "string") {
          processed.delete(first);
        }
      }
    }

    if (newCount > 0) {
      console.log(`[${new Date().toISOString()}][watchlist] Processed ${newCount} new item(s)`);
    }
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][watchlist] Poll error:`, err?.message || String(err));
  }
}

/**
 * Starts the unified media server watchlist poller.
 *
 * Checks if at least one media server and one indexer are configured,
 * then polls at the configured interval.
 *
 * @throws Error if no indexer or media server is configured
 */
export function startWatchlistPoller(): void {
  // Verify at least one media server is configured
  const hasMediaServer =
    !!config.plexToken ||
    (!!config.jellyfinUrl && !!config.jellyfinApiKey) ||
    (!!config.embyUrl && !!config.embyApiKey);

  if (!hasMediaServer) {
    console.warn(`[${new Date().toISOString()}][watchlist] No media server configured — watchlist poller disabled`);
    console.warn(`[${new Date().toISOString()}][watchlist] Set PLEX_TOKEN, JELLYFIN_URL+JELLYFIN_API_KEY, or EMBY_URL+EMBY_API_KEY`);
    return;
  }

  if (!isIndexerConfigured()) {
    console.warn(`[${new Date().toISOString()}][watchlist] No indexer configured — watchlist poller disabled`);
    return;
  }

  const intervalMs = Math.max(30, config.watchlistPollIntervalSeconds) * 1000;

  const servers: string[] = [];
  if (config.plexToken) servers.push("Plex");
  if (config.jellyfinUrl) servers.push("Jellyfin");
  if (config.embyUrl) servers.push("Emby");

  console.log(`[${new Date().toISOString()}][watchlist] Starting poller — servers: ${servers.join(", ")}, interval: ${Math.round(intervalMs / 1000)}s`);

  // Initial poll after a short delay to let mounts stabilise
  setTimeout(() => {
    pollOnce();
    setInterval(pollOnce, intervalMs);
  }, 10000);
}
