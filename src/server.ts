import express from "express";
import { config, requireEnv } from "./config";
import { searchProwlarr, pickBestResult, getMagnet } from "./prowlarr";
import { addMagnetToTorbox } from "./torbox";
import { startOverseerrPoller } from "./overseerr";

export function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  if (config.runWebhook) {
    app.post("/webhook/overseerr", async (req, res) => {
      try {
        // Check required environment variables early and return a helpful error
        const missing = ["prowlarrUrl", "prowlarrApiKey", "torboxApiKey"].filter(
          (key) => !String(config[key as keyof typeof config] || "").trim()
        );
        if (missing.length) {
          return res.status(503).json({
            ok: false,
            error: "Service not configured. Set the following environment variables:",
            missing,
            documentation: "See README.md for configuration instructions.",
          });
        }

        if (config.overseerrAuth && req.get("authorization") !== config.overseerrAuth) {
          return res.status(401).json({ ok: false, error: "Unauthorized" });
        }

        const payload = req.body || {};
        const built = buildQueryFromPayload(payload);

        if (!built || !built.query) {
          return res.status(400).json({ ok: false, error: "No query could be derived from payload." });
        }

        // Respond immediately to avoid Overseerr's 20s timeout; process in background
        res.status(202).json({ ok: true, accepted: true, query: built.query, categories: built.categories });

        (async () => {
          try {
            const results = await searchProwlarr(built.query, { categories: built.categories });
            const best = pickBestResult(results);
            const magnet = getMagnet(best);

            if (!magnet) {
              console.warn("No magnet found in search results.", { query: built.query, best });
              return;
            }

            await addMagnetToTorbox(magnet, best?.title);
          } catch (err: any) {
            console.error("Async webhook processing error:", err?.message || String(err));
          }
        })();
      } catch (e: any) {
        if (!res.headersSent) {
          if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
            res.status(504).json({ ok: false, error: "Request timed out while searching Prowlarr. Try again or check your indexer configuration." });
          } else {
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
