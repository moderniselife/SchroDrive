import express from "express";
import { config, requireEnv } from "./config";
import { searchIndexer, pickBestResult, getMagnet, getProviderName, isIndexerConfigured } from "./indexer";
import { addMagnetToTorbox } from "./torbox";
import { startOverseerrPoller } from "./overseerr";
import { startAutoUpdater } from "./autoUpdate";

export function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (config.runWebhook) {
    app.post("/webhook/overseerr", async (req, res) => {
      try {
        console.log(`[${new Date().toISOString()}][webhook] hit /webhook/overseerr`);
        // Check required environment variables early and return a helpful error
        if (!isIndexerConfigured()) {
          console.warn(`[${new Date().toISOString()}][webhook] no indexer configured`);
          return res.status(503).json({
            ok: false,
            error: "No indexer configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.",
            documentation: "See README.md for configuration instructions.",
          });
        }
        if (!config.torboxApiKey) {
          console.warn(`[${new Date().toISOString()}][webhook] missing TORBOX_API_KEY`);
          return res.status(503).json({
            ok: false,
            error: "TORBOX_API_KEY not configured.",
            documentation: "See README.md for configuration instructions.",
          });
        }

        if (config.overseerrAuth && req.get("authorization") !== config.overseerrAuth) {
          console.warn(`[${new Date().toISOString()}][webhook] unauthorized request (bad auth header)`);
          return res.status(401).json({ ok: false, error: "Unauthorized" });
        }

        const payload = req.body || {};
        const built = buildQueryFromPayload(payload);

        if (!built || !built.query) {
          console.warn(`[${new Date().toISOString()}][webhook] could not derive query from payload`, { subject: payload?.subject, media: payload?.media });
          return res.status(400).json({ ok: false, error: "No query could be derived from payload." });
        }

        console.log(`[${new Date().toISOString()}][webhook] built query`, { query: built.query, categories: built.categories });
        // Respond immediately to avoid Overseerr's 20s timeout; process in background
        res.status(202).json({ ok: true, accepted: true, query: built.query, categories: built.categories });
        console.log(`[${new Date().toISOString()}][webhook] responded 202, processing async...`);

        (async () => {
          try {
            const provider = getProviderName();
            console.log(`[${new Date().toISOString()}][webhook->${provider}] searching`, { query: built.query, categories: built.categories });
            const started = Date.now();
            const results = await searchIndexer(built.query, { categories: built.categories });
            console.log(`[${new Date().toISOString()}][webhook->${provider}] results`, { count: results.length, ms: Date.now() - started });
            const best = pickBestResult(results);
            console.log(`[${new Date().toISOString()}][webhook->${provider}] chosen`, { title: best?.title, seeders: best?.seeders, size: best?.size });
            const magnet = getMagnet(best);

            if (!magnet) {
              console.warn(`[${new Date().toISOString()}][webhook] no magnet found in search results`, { query: built.query });
              return;
            }

            const teaser = typeof magnet === 'string' ? magnet.slice(0, 80) + '...' : undefined;
            console.log(`[${new Date().toISOString()}][webhook->torbox] adding magnet`, { title: best?.title, teaser });
            await addMagnetToTorbox(magnet, best?.title);
            console.log(`[${new Date().toISOString()}][webhook->torbox] added`);
          } catch (err: any) {
            console.error(`[${new Date().toISOString()}][webhook] async processing error`, err?.message || String(err));
          }
        })();
      } catch (e: any) {
        if (!res.headersSent) {
          if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
            console.error(`[${new Date().toISOString()}][webhook] timeout while searching indexer`);
            res.status(504).json({ ok: false, error: "Request timed out while searching indexer. Try again or check your indexer configuration." });
          } else {
            console.error(`[${new Date().toISOString()}][webhook] unexpected error`, e?.message || String(e));
            res.status(500).json({ ok: false, error: e?.message || String(e) });
          }
        }
      }
    });
  }

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  // Optional: start Overseerr API poller
  if (config.runPoller) {
    startOverseerrPoller();
  }

  // Optional: start auto-updater
  startAutoUpdater();
}

export function buildQueryFromPayload(payload: any): { query: string; categories?: string[] } | undefined {
  const subject: string | undefined = payload?.subject;
  const media = payload?.media || {};
  const title = media?.title || media?.name;
  const year = media?.year || media?.releaseYear;
  const mediaType = media?.media_type; // 'movie' or 'tv'
  const tmdbId = media?.tmdbId;

  let query = "";
  if (subject && subject.trim().length > 0) {
    query = subject.trim();
  } else if (title) {
    query = year ? `${title} ${year}` : title;
    if (tmdbId && Number.isInteger(Number(tmdbId))) {
      query += ` TMDB${tmdbId}`;
    }
  }

  if (!query) return undefined;

  const result: { query: string; categories?: string[] } = { query };

  // Map media_type to Prowlarr categories if configured
  const defaultCategories = {
    movie: ["5000"], // Movies
    tv: ["5000"], // TV (adjust as needed)
  };
  if (mediaType && defaultCategories[mediaType as keyof typeof defaultCategories]) {
    result.categories = defaultCategories[mediaType as keyof typeof defaultCategories];
  }

  return result;
}
