import axios from "axios";
import { config, requireEnv } from "./config";
import { searchProwlarr, pickBestResult, getMagnet, getMagnetOrResolve } from "./prowlarr";
import { addMagnetToTorbox, checkExistingTorrents } from "./torbox";
import { testProwlarrConnection } from "./prowlarr";

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
  requireEnv("prowlarrUrl", "prowlarrApiKey", "torboxApiKey");
  // Accept either Overseerr API key or Bearer token
  if (!config.overseerrUrl || (!config.overseerrApiKey && !config.overseerrAuth)) {
    throw new Error("Missing Overseerr credentials. Set OVERSEERR_URL and either OVERSEERR_API_KEY or OVERSEERR_AUTH.");
  }

  const processed = new Set<string>();
  const intervalMs = Math.max(5, Number(config.pollIntervalSeconds || 30)) * 1000;
  console.log(`[${new Date().toISOString()}][poller] starting`, { intervalSeconds: Math.round(intervalMs / 1000) });

  // Test Prowlarr connection on startup
  testProwlarrConnection().then(connected => {
    if (!connected) {
      console.warn(`[${new Date().toISOString()}][poller] WARNING: Prowlarr connection test failed. Searches may timeout.`);
    }
  }).catch(err => {
    console.error(`[${new Date().toISOString()}][poller] Prowlarr connection test error`, err?.message || String(err));
  });

  const runOnce = async () => {
    try {
      console.log(`[${new Date().toISOString()}][poller] tick`);
      const items = await fetchApprovedRequests();
      console.log(`[${new Date().toISOString()}][poller] approved requests fetched`, { count: items.length });
      for (const r of items) {
        const id = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
        if (!id) continue;
        if (processed.has(id)) {
          console.log(`[${new Date().toISOString()}][poller] skip already processed`, { id });
          continue;
        }

        let built = buildSearchFromRequest(r);
        if (!built) {
          console.warn(`[${new Date().toISOString()}][poller] could not build query from request`, { id, media: r?.media });
          // Try to enrich from Overseerr details
          const media = r?.media || {};
          const tmdbId = (media as any)?.tmdbId ?? r?.mediaId;
          const mediaType = (media as any)?.mediaType ?? (media as any)?.type;
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
          const media = r?.media || {};
          const tmdbId = (media as any)?.tmdbId ?? r?.mediaId;
          const mediaType = (media as any)?.mediaType ?? (media as any)?.type;
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
          console.log(`[${new Date().toISOString()}][poller->prowlarr] searching`, { id, query: built.query, categories: built.categories });
          const t0 = Date.now();
          const results = await searchProwlarr(built.query, { categories: built.categories });
          console.log(`[${new Date().toISOString()}][poller->prowlarr] results`, { id, count: results.length, ms: Date.now() - t0 });
          const best = pickBestResult(results);
          console.log(`[${new Date().toISOString()}][poller->prowlarr] chosen`, { id, title: (best as any)?.title, seeders: (best as any)?.seeders, size: (best as any)?.size });
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
          
          // Check for existing torrents before adding
          const torrentTitle = (chosenUsed as any)?.title || built.query;
          const hasExisting = await checkExistingTorrents(torrentTitle);
          if (hasExisting) {
            console.log(`[${new Date().toISOString()}][poller] skipping duplicate torrent`, { id, title: torrentTitle });
            processed.add(id);
            continue;
          }
          
          const teaser = magnet.slice(0, 80) + '...';
          console.log(`[${new Date().toISOString()}][poller->torbox] adding magnet`, { id, title: torrentTitle, teaser });
          await addMagnetToTorbox(magnet, torrentTitle);
          console.log(`[${new Date().toISOString()}][poller->torbox] added`, { id });
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

  // Start immediately and then on interval
  runOnce();
  setInterval(runOnce, intervalMs);
  console.log(`[${new Date().toISOString()}][poller] started`, { everySeconds: Math.round(intervalMs / 1000) });
}
