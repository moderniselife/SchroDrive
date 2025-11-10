import axios from "axios";
import { config, requireEnv } from "./config";
import { searchProwlarr, pickBestResult, getMagnet } from "./prowlarr";
import { addMagnetToTorbox } from "./torbox";

interface MediaLike {
  title?: string;
  name?: string;
  year?: number;
  releaseYear?: number;
  mediaType?: string;
  type?: string;
  tmdbId?: number | string;
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
  const res = await axios.get(url, {
    params: { filter: "approved", sort: "modified", take: 50, skip: 0 },
    headers: { "X-Api-Key": config.overseerrApiKey },
    timeout: 30000,
  });
  const results = res?.data?.results || [];
  return Array.isArray(results) ? results : [];
}

export function startOverseerrPoller() {
  requireEnv("prowlarrUrl", "prowlarrApiKey", "torboxApiKey");
  requireEnv("overseerrUrl", "overseerrApiKey");

  const processed = new Set<string>();
  const intervalMs = Math.max(5, Number(config.pollIntervalSeconds || 30)) * 1000;

  const runOnce = async () => {
    try {
      const items = await fetchApprovedRequests();
      for (const r of items) {
        const id = String(r?.id ?? `${r?.mediaId ?? ""}:${r?.is4k ? "4k" : "hd"}`);
        if (!id) continue;
        if (processed.has(id)) continue;

        const built = buildSearchFromRequest(r);
        if (!built) {
          continue;
        }

        try {
          const results = await searchProwlarr(built.query, { categories: built.categories });
          const best = pickBestResult(results);
          const magnet = getMagnet(best);
          if (!magnet) {
            console.warn("Poller: no magnet found", { query: built.query, id, best });
            processed.add(id);
            continue;
          }
          await addMagnetToTorbox(magnet, (best as any)?.title);
          console.log("Poller: added to TorBox", { query: built.query, id, title: (best as any)?.title });
          processed.add(id);
          if (processed.size > 1000) {
            // Trim processed set
            const first = processed.values().next().value as string | undefined;
            if (typeof first === "string") {
              processed.delete(first);
            }
          }
        } catch (err: any) {
          console.error("Poller: processing error", err?.message || String(err));
        }
      }
    } catch (e: any) {
      console.error("Poller: fetch error", e?.message || String(e));
    }
  };

  // Start immediately and then on interval
  runOnce();
  setInterval(runOnce, intervalMs);
  console.log(`Overseerr poller started (every ${Math.round(intervalMs / 1000)}s)`);
}
