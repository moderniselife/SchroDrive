import axios from "axios";
import { config, requireEnv } from "../core/config";
import { searchIndexer, pickBestResult, getMagnet, getMagnetOrResolve, testIndexerConnection, getProviderName, isIndexerConfigured } from "../indexers/index";
import { registry } from "../providers";
import { upsertOverseerrRequest, getAllOverseerrRequests } from "../core/db";
import { isPlexStreaming } from "../integrations/plex";


interface MediaLike {
  title?: string;
  name?: string;
  year?: number;
  releaseYear?: number;
  mediaType?: string;
  type?: string;
  tmdbId?: number | string;
}

function defaultCategoriesFor(mediaType: any): string[] | undefined {
  const map: Record<string, string[]> = {
    movie: ["5000"],
    tv: ["5000"],
  };
  const key = String(mediaType || '').toLowerCase();
  return map[key];
}

async function fetchTitleYearFromOverseerr(mediaType: string, tmdbId: number): Promise<{ title: string; year?: number } | undefined> {
  if (!config.overseerrUrl || (!config.overseerrApiKey && !config.overseerrAuth)) return undefined;
  const base = config.overseerrUrl.replace(/\/$/, "");
  const path = mediaType?.toLowerCase() === 'movie' ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const url = `${base}${path}`;
  console.log(`[${new Date().toISOString()}][poller->overseerr] GET ${url} (details)`);
  const headers: any = {};
  if (config.overseerrApiKey) headers["X-Api-Key"] = config.overseerrApiKey;
  if (config.overseerrAuth) headers["Authorization"] = config.overseerrAuth.startsWith("Bearer ") ? config.overseerrAuth : `Bearer ${config.overseerrAuth}`;
  const res = await axios.get(url, { headers, timeout: 15000 });
  const data = res?.data || {};
  const title = (data as any)?.title || (data as any)?.name;
  const dateStr = (data as any)?.releaseDate || (data as any)?.firstAirDate || (data as any)?.first_air_date || (data as any)?.release_date;
  const year = dateStr ? Number(String(dateStr).slice(0, 4)) : undefined;
  if (title) return { title, year: Number.isFinite(year) ? year : undefined };
  return undefined;
}

interface MediaRequestLike {
  id?: number;
  mediaId?: number;
  createdAt?: string;
  updatedAt?: string;
  status?: string;
  is4k?: boolean;
  media?: MediaLike;
}

function buildSearchFromRequest(r: MediaRequestLike): { query: string; categories?: string[] } | undefined {
  const media = r?.media || {};
  const title = media.title || media.name;
  const year = (media.year as any) || (media.releaseYear as any);
  const mediaType = (media.mediaType as any) || (media.type as any);
  const tmdbId = (media.tmdbId as any) || (r.mediaId as any);

  let query = "";
  if (title) {
    query = year ? `${title} ${year}` : String(title);
    if (tmdbId && Number.isInteger(Number(tmdbId))) {
      query += ` TMDB${tmdbId}`;
    }
  }

  // Fallback: if no title available, still allow TMDB-only queries
  if (!query && tmdbId && Number.isInteger(Number(tmdbId))) {
    query = `TMDB${tmdbId}`;
  }

  if (!query) return undefined;

  const result: { query: string; categories?: string[] } = { query };
  const defaultCategories: Record<string, string[]> = {
    movie: ["5000"],
    tv: ["5000"],
  };
  const key = (mediaType || "").toString().toLowerCase() as keyof typeof defaultCategories;
  if (key && defaultCategories[key]) {
    result.categories = defaultCategories[key];
  }
  return result;
}

async function fetchApprovedRequests(): Promise<MediaRequestLike[]> {
  const base = config.overseerrUrl.replace(/\/$/, "");
  const url = `${base}/request`;
  const started = Date.now();
  console.log(`[${new Date().toISOString()}][poller->overseerr] GET ${url}`, {
    params: { filter: "approved", sort: "modified", take: 50, skip: 0 },
  });
  const headers: any = {};
  if (config.overseerrApiKey) headers["X-Api-Key"] = config.overseerrApiKey;
  if (config.overseerrAuth) headers["Authorization"] = config.overseerrAuth.startsWith("Bearer ") ? config.overseerrAuth : `Bearer ${config.overseerrAuth}`;
  const res = await axios.get(url, {
    params: { filter: "approved", sort: "modified", take: 50, skip: 0 },
    headers,
    timeout: 30000,
  });
  const results = res?.data?.results || [];
  console.log(`[${new Date().toISOString()}][poller->overseerr] response`, { count: Array.isArray(results) ? results.length : 0, ms: Date.now() - started });
  return Array.isArray(results) ? results : [];
}

export function startOverseerrPoller() {
  // Validate indexer is configured
  if (!isIndexerConfigured()) {
    throw new Error("No indexer configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
  }
  // Accept either Overseerr API key or Bearer token
  if (!config.overseerrUrl || (!config.overseerrApiKey && !config.overseerrAuth)) {
    throw new Error("Missing Overseerr credentials. Set OVERSEERR_URL and either OVERSEERR_API_KEY or OVERSEERR_AUTH.");
  }

  // Ensure at least one provider is configured
  const providers = registry.configured();
  if (providers.length === 0) {
    throw new Error("No debrid provider configured. Set TORBOX_API_KEY and/or RD_ACCESS_TOKEN.");
  }
  console.log(`[${new Date().toISOString()}][poller] providers configured`, { 
    providers: providers.map(p => p.id),
    order: registry.ordered().map(p => p.id),
  });

  const processed = new Set<string>();
  const intervalMs = Math.max(5, Number(config.pollIntervalSeconds || 30)) * 1000;
  console.log(`[${new Date().toISOString()}][poller] starting`, { intervalSeconds: Math.round(intervalMs / 1000) });

  // Test indexer connection on startup
  const provider = getProviderName();
  testIndexerConnection().then(connected => {
    if (!connected) {
      console.warn(`[${new Date().toISOString()}][poller] WARNING: ${provider} connection test failed. Searches may timeout.`);
    }
  }).catch(err => {
    console.error(`[${new Date().toISOString()}][poller] ${provider} connection test error`, err?.message || String(err));
  });

  const runOnce = async () => {
    try {
      const isStreaming = await isPlexStreaming();
      if (isStreaming) {
        console.log(`[${new Date().toISOString()}][poller] Active Plex stream detected. Skipping poller tick to avoid debrid rate limits.`);
        return;
      }

      const configuredProviders = registry.configured();
      const allRateLimited = configuredProviders.every(p => p.isRateLimited());
      if (allRateLimited && configuredProviders.length > 0) {
        const minWait = Math.min(...configuredProviders.map(p => p.getWaitTime()));
        console.warn(`[${new Date().toISOString()}][poller] All debrid providers are rate-limited. Skipping tick to avoid API spam. Resuming in ${minWait}s.`);
        return;
      }

      console.log(`[${new Date().toISOString()}][poller] tick`);
      const items = await fetchApprovedRequests();
      console.log(`[${new Date().toISOString()}][poller] approved requests fetched`, { count: items.length });
      for (const r of items) {
        const currentProviders = registry.configured();
        if (currentProviders.every(p => p.isRateLimited()) && currentProviders.length > 0) {
          console.warn(`[${new Date().toISOString()}][poller] All debrid providers became rate-limited. Aborting tick.`);
          break;
        }

        const id = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
        if (!id) continue;


        // Persist to local database for historical request tracking
        const media = r?.media || {};
        const title = media.title || media.name;
        const mediaType = (media as any)?.mediaType ?? (media as any)?.type;
        const tmdbId = (media as any)?.tmdbId ?? r?.mediaId;
        if (title && mediaType) {
          try {
            upsertOverseerrRequest({
              requestId: id,
              title,
              mediaType,
              tmdbId: tmdbId ? Number(tmdbId) : undefined,
              status: r.status || "approved",
            });
          } catch (dbErr: any) {
            console.error(`[${new Date().toISOString()}][poller] failed to persist request ${id} to database`, dbErr?.message);
          }
        }

        if (processed.has(id)) {
          console.log(`[${new Date().toISOString()}][poller] skip already processed`, { id });
          continue;
        }

        let built = buildSearchFromRequest(r);
        if (!built) {
          console.warn(`[${new Date().toISOString()}][poller] could not build query from request`, { id, media: r?.media });
          // Try to enrich from Overseerr details
          if (tmdbId) {
            try {
              const enriched = await fetchTitleYearFromOverseerr(String(mediaType || ''), Number(tmdbId));
              if (enriched?.title) {
                const year = enriched.year ? ` ${enriched.year}` : '';
                built = { query: `${enriched.title}${year} TMDB${tmdbId}`, categories: mediaType ? defaultCategoriesFor(mediaType) : undefined };
                console.log(`[${new Date().toISOString()}][poller] enriched query from Overseerr`, { id, query: built.query });
              }
            } catch (e: any) {
              console.warn(`[${new Date().toISOString()}][poller] enrich failed`, { id, err: e?.message || String(e) });
            }
          }
          if (!built) {
            continue;
          }
        }

        // If query is TMDB-only, attempt to enrich with title/year for better search
        try {
          if (tmdbId && built.query.trim() === `TMDB${tmdbId}`) {
            const enriched = await fetchTitleYearFromOverseerr(String(mediaType || ''), Number(tmdbId));
            if (enriched?.title) {
              const year = enriched.year ? ` ${enriched.year}` : '';
              built = { query: `${enriched.title}${year} TMDB${tmdbId}`, categories: mediaType ? defaultCategoriesFor(mediaType) : undefined };
              console.log(`[${new Date().toISOString()}][poller] upgraded TMDB-only query`, { id, query: built.query });
            }
          }
        } catch (e: any) {
          console.warn(`[${new Date().toISOString()}][poller] upgrade TMDB-only failed`, { err: e?.message || String(e) });
        }

        try {
          const indexerName = getProviderName();
          console.log(`[${new Date().toISOString()}][poller->${indexerName}] searching`, { id, query: built.query, categories: built.categories });
          const t0 = Date.now();
          const results = await searchIndexer(built.query, { categories: built.categories });
          console.log(`[${new Date().toISOString()}][poller->${indexerName}] results`, { id, count: results.length, ms: Date.now() - t0 });
          const best = pickBestResult(results);
          console.log(`[${new Date().toISOString()}][poller->${indexerName}] chosen`, { id, title: (best as any)?.title, seeders: (best as any)?.seeders, size: (best as any)?.size });
          // Try best first, then scan other candidates until a magnet is found
          let magnet: string | undefined = undefined;
          let chosenUsed: any = best;
          const sorted = results
            .slice()
            .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));
          for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
            magnet = getMagnet(cand);
            if (!magnet) {
              try {
                magnet = await getMagnetOrResolve(cand);
              } catch (e: any) {
                console.warn(`[${new Date().toISOString()}][poller] magnet resolve failed`, { id, err: e?.message || String(e) });
              }
            }
            if (magnet) {
              chosenUsed = cand;
              break;
            }
          }
          if (!magnet) {
            console.warn(`[${new Date().toISOString()}][poller] no magnet found`, { id, query: built.query });
            processed.add(id);
            continue;
          }
          
          // -----------------------------------------------------------------
          // Check for existing torrents across ALL configured providers
          // -----------------------------------------------------------------
          const torrentTitle = (chosenUsed as any)?.title || built.query;
          const { exists: hasExisting, provider: existingProvider } = await registry.checkExistingAcrossAll(torrentTitle);

          if (hasExisting) {
            console.log(`[${new Date().toISOString()}][poller] skipping duplicate torrent`, { id, title: torrentTitle, existingProvider });
            processed.add(id);
            continue;
          }
          
          // -----------------------------------------------------------------
          // Add magnet to providers using configured strategy
          // -----------------------------------------------------------------
          const addStrategy = (config as any).addStrategy || 'all';
          const { results: addResults } = await registry.addMagnetWithStrategy(magnet, torrentTitle, addStrategy);
          
          const anySuccess = addResults.some(r => r.success);
          if (!anySuccess) {
            console.error(`[${new Date().toISOString()}][poller] ❌ failed to add to ANY provider`, { id, title: torrentTitle });
          }

          processed.add(id);
          if (processed.size > 1000) {
            // Trim processed set
            const first = processed.values().next().value as string | undefined;
            if (typeof first === "string") {
              processed.delete(first);
            }
          }
        } catch (err: any) {
          console.error(`[${new Date().toISOString()}][poller] processing error`, { id, query: built.query, error: err?.message || String(err), stack: err?.stack });
          // Don't add to processed set on error so it will be retried
        }
      }
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][poller] fetch error`, e?.message || String(e));
    }
  };

  // Start poller tick immediately and then on interval
  runOnce();
  setInterval(runOnce, intervalMs);
  console.log(`[${new Date().toISOString()}][poller] started`, { everySeconds: Math.round(intervalMs / 1000) });

  // Start background Overseerr requests sync and missing requests recovery scanner
  const runBackgroundSyncAndRecovery = async () => {
    try {
      await syncAllApprovedRequests();
      await checkAndReaddMissingRequests();
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][poller-sync] Background sync/recovery error`, e?.message || String(e));
    }
  };

  // Run on startup
  runBackgroundSyncAndRecovery();

  // Schedule background historical sync (every 6 hours) and missing requests scanner (every 1 hour)
  setInterval(async () => {
    try {
      await syncAllApprovedRequests();
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][poller-sync] Periodic sync error`, e?.message || String(e));
    }
  }, 6 * 60 * 60 * 1000);

  setInterval(async () => {
    try {
      await checkAndReaddMissingRequests();
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][poller-sync] Periodic recovery check error`, e?.message || String(e));
    }
  }, 60 * 60 * 1000);
}

/**
 * Pages through all approved requests from Overseerr and syncs them to SQLite database.
 */
async function syncAllApprovedRequests(): Promise<void> {
  if (!config.overseerrUrl || (!config.overseerrApiKey && !config.overseerrAuth)) return;
  const base = config.overseerrUrl.replace(/\/$/, "");
  const url = `${base}/request`;
  const headers: any = {};
  if (config.overseerrApiKey) headers["X-Api-Key"] = config.overseerrApiKey;
  if (config.overseerrAuth) headers["Authorization"] = config.overseerrAuth.startsWith("Bearer ") ? config.overseerrAuth : `Bearer ${config.overseerrAuth}`;

  let skip = 0;
  const take = 100;
  let total = 0;

  console.log(`[${new Date().toISOString()}][overseerr-sync] Starting historical requests sync...`);
  while (true) {
    try {
      const res = await axios.get(url, {
        params: { filter: "approved", sort: "modified", take, skip },
        headers,
        timeout: 30000,
      });
      const results = res?.data?.results || [];
      if (results.length === 0) break;

      for (const r of results) {
        const requestId = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
        const media = r?.media || {};
        const title = media.title || media.name;
        const tmdbId = (media as any)?.tmdbId ?? r?.mediaId;
        const mediaType = (media as any)?.mediaType ?? (media as any)?.type;
        
        if (requestId && title && mediaType) {
          upsertOverseerrRequest({
            requestId,
            title,
            mediaType,
            tmdbId: tmdbId ? Number(tmdbId) : undefined,
            status: r.status || "approved",
          });
        }
      }

      total += results.length;
      if (results.length < take) break;
      skip += take;
      // Sleep slightly to avoid spamming Overseerr API
      await new Promise(resolve => setTimeout(resolve, 200));
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][overseerr-sync] Historical sync failed at skip=${skip}: ${err?.message}`);
      break;
    }
  }
  console.log(`[${new Date().toISOString()}][overseerr-sync] Synced ${total} approved requests to local database.`);
}

/**
 * Checks all synced requests against active provider torrents. If a request has
 * no corresponding torrent on debrid providers, searches and re-adds it.
 */
async function checkAndReaddMissingRequests(): Promise<void> {
  const isStreaming = await isPlexStreaming();
  if (isStreaming) {
    console.log(`[${new Date().toISOString()}][poller-sync] Active Plex stream detected. Skipping recovery check.`);
    return;
  }

  const configuredProviders = registry.configured();
  const allRateLimited = configuredProviders.every(p => p.isRateLimited());
  if (allRateLimited && configuredProviders.length > 0) {
    console.warn(`[${new Date().toISOString()}][poller-sync] All providers are rate-limited. Skipping recovery check.`);
    return;
  }

  console.log(`[${new Date().toISOString()}][poller-sync] Checking for requests removed from debrid providers...`);
  const requests = getAllOverseerrRequests();
  const providers = registry.configured();
  if (providers.length === 0) {
    console.warn(`[${new Date().toISOString()}][poller-sync] No configured debrid providers, skipping missing requests check`);
    return;
  }

  let readdedCount = 0;

  for (const req of requests) {
    const currentProviders = registry.configured();
    if (currentProviders.every(p => p.isRateLimited()) && currentProviders.length > 0) {
      console.warn(`[${new Date().toISOString()}][poller-sync] All providers became rate-limited. Aborting recovery check.`);
      break;
    }

    try {

      // Check if a torrent for this request already exists on any provider
      const { exists } = await registry.checkExistingAcrossAll(req.title);
      if (exists) {
        // Already present, skip
        continue;
      }

      // Not present! Check search cooldown to avoid spamming indexers
      const now = Date.now();
      const lastSearch = req.lastSearchAt || 0;
      const cooldownMs = 6 * 60 * 60 * 1000; // 6 hours cooldown
      if (now - lastSearch < cooldownMs) {
        // Skipped due to cooldown
        continue;
      }

      // Update lastSearchAt immediately to prevent concurrent duplicate searches
      upsertOverseerrRequest({
        ...req,
        lastSearchAt: now,
      });

      // Build search query
      let query = req.title;
      if (req.tmdbId) {
        query += ` TMDB${req.tmdbId}`;
      }

      console.log(`[${new Date().toISOString()}][poller-sync] Request "${req.title}" is missing from providers. Re-searching...`);
      const categories = defaultCategoriesFor(req.mediaType);
      const results = await searchIndexer(query, { categories });
      if (results.length === 0) {
        console.log(`[${new Date().toISOString()}][poller-sync] No results found for missing request "${req.title}"`);
        continue;
      }

      const best = pickBestResult(results);
      let magnet: string | undefined = undefined;
      let chosenUsed: any = best;
      const sorted = results
        .slice()
        .sort((a, b) => (Number(b.seeders) || 0) - (Number(a.seeders) || 0) || (Number(b.size) || 0) - (Number(a.size) || 0));

      for (const cand of [best, ...sorted.filter((x) => x !== best)]) {
        magnet = getMagnet(cand);
        if (!magnet) {
          try {
            magnet = await getMagnetOrResolve(cand);
          } catch {}
        }
        if (magnet) {
          chosenUsed = cand;
          break;
        }
      }

      if (!magnet) {
        console.log(`[${new Date().toISOString()}][poller-sync] No magnet found for missing request "${req.title}"`);
        continue;
      }

      const torrentTitle = (chosenUsed as any)?.title || query;
      const addStrategy = (config as any).addStrategy || 'all';
      const { results: addResults } = await registry.addMagnetWithStrategy(magnet, torrentTitle, addStrategy);
      
      const anySuccess = addResults.some(r => r.success);
      if (anySuccess) {
        console.log(`[${new Date().toISOString()}][poller-sync] ✅ Successfully re-added missing request: "${req.title}"`);
        readdedCount++;
      } else {
        console.error(`[${new Date().toISOString()}][poller-sync] ❌ Failed to add re-added request to any provider: "${req.title}"`);
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][poller-sync] Error processing missing request "${req.title}": ${err?.message}`);
    }
  }
  console.log(`[${new Date().toISOString()}][poller-sync] Finished checking missing requests. Re-added ${readdedCount} shows/movies.`);
}
