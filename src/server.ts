/**
 * SchroDrive — HTTP API Server
 *
 * Defines the Express HTTP server with all REST API routes and SSE streaming
 * endpoints powering the SchroDrive web GUI. Provides endpoints for:
 *
 * - Health checks and system status
 * - Configuration management (read, update, restart)
 * - Provider connectivity and torrent/download listing
 * - SSE streaming for real-time torrent and download data
 * - Indexer search (Jackett/Prowlarr) and magnet submission
 * - Log viewing and streaming
 * - Overseerr webhook integration
 * - Mounted filesystem browsing
 *
 * @module server
 */

import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { config, requireEnv } from "./config";
import { searchIndexer, pickBestResult, getMagnet, getProviderName, isIndexerConfigured } from "./indexer";
import { addMagnetToTorbox, listTorboxTorrents, listTorboxWebDownloads, listTorboxUsenetDownloads } from "./torbox";
import { listRDTorrents, isRDConfigured, addMagnetToRD, selectAllFilesRD, listRDDownloads, listRDTorrentsStream, listRDDownloadsStream } from "./realdebrid";
import { startOverseerrPoller } from "./overseerr";
import { startAutoUpdater } from "./autoUpdate";
import { getConfigWithSources, saveConfigToFile, triggerRestart, isRunningInDocker, CONFIG_SCHEMA } from "./configApi";
import { logBuffer } from "./logger";
import { rateLimiter } from "./rateLimiter";
import { getBridgeStatuses, refreshBridges } from "./mount";

// ===========================================================================
// Server Initialisation
// ===========================================================================

/**
 * Initialises and starts the Express HTTP server with all API routes,
 * SSE streaming endpoints, and optional background services (Overseerr poller,
 * auto-updater).
 *
 * The server listens on the port specified in `config.port`.
 */
export function startServer() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(cors()); // Allow web GUI to connect

  // ===========================================================================
  // Health Check
  // ===========================================================================

  /** GET /health — Simple liveness probe. */
  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ===========================================================================
  // Configuration API
  // ===========================================================================

  /**
   * GET /api/config — Returns the current configuration with metadata.
   * Includes the env file path, Docker detection flag, and schema definition
   * for the web GUI's settings editor.
   */
  app.get("/api/config", (_req, res) => {
    try {
      const { config: configData, envPath } = getConfigWithSources();
      res.json({
        ok: true,
        config: configData,
        envPath,
        isDocker: isRunningInDocker(),
        schema: CONFIG_SCHEMA,
      });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * POST /api/config — Persists configuration updates to the env file.
   * Expects `{ config: { key: value, ... } }` in the request body.
   */
  app.post("/api/config", (req, res) => {
    try {
      const updates = req.body?.config || {};
      const result = saveConfigToFile(updates);
      if (result.success) {
        res.json({ ok: true, message: "Configuration saved", path: result.path });
      } else {
        res.status(500).json({ ok: false, error: result.error, path: result.path });
      }
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** POST /api/restart — Triggers a graceful process restart. */
  app.post("/api/restart", (_req, res) => {
    try {
      const result = triggerRestart();
      res.json({ ok: result.success, message: result.message });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * GET /api/status — Returns system status including active services
   * and indexer configuration.
   */
  app.get("/api/status", (_req, res) => {
    res.json({
      ok: true,
      isDocker: isRunningInDocker(),
      services: {
        webhook: config.runWebhook,
        poller: config.runPoller,
        mount: config.runMount,
        deadScanner: config.runDeadScanner,
        deadScannerWatch: config.runDeadScannerWatch,
        organizerWatch: config.runOrganizerWatch,
      },
      indexer: {
        configured: isIndexerConfigured(),
        provider: isIndexerConfigured() ? getProviderName() : null,
      },
      webdavBridges: getBridgeStatuses(),
    });
  });

  // ===========================================================================
  // WebDAV Bridge Management
  // ===========================================================================

  /** GET /api/webdav/status — Returns status of all active WebDAV bridge instances. */
  app.get("/api/webdav/status", (_req, res) => {
    res.json({ ok: true, bridges: getBridgeStatuses() });
  });

  /** POST /api/webdav/refresh — Forces a cache refresh on all active bridges. */
  app.post("/api/webdav/refresh", async (_req, res) => {
    try {
      await refreshBridges();
      res.json({ ok: true, message: "Cache refreshed", bridges: getBridgeStatuses() });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    }
  });

  // ===========================================================================
  // Provider Status
  // ===========================================================================

  /**
   * GET /api/providers — Returns connectivity and configuration status
   * for all active debrid providers (TorBox, Real-Debrid).
   * Attempts a live torrent list fetch to verify connectivity.
   */
  app.get("/api/providers", async (_req, res) => {
    try {
      const providers: any[] = [];
      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];

      // --- TorBox ---
      if (activeProviders.includes("torbox") && config.torboxApiKey) {
        try {
          const torrents = await listTorboxTorrents();
          providers.push({
            name: "TorBox",
            id: "torbox",
            configured: true,
            connected: true,
            torrentCount: torrents.length,
            webdav: {
              configured: !!(config.torboxWebdavUrl && config.torboxWebdavUsername),
              url: config.torboxWebdavUrl || null,
            },
          });
        } catch (err: any) {
          providers.push({
            name: "TorBox",
            id: "torbox",
            configured: true,
            connected: false,
            error: err.message,
            webdav: {
              configured: !!(config.torboxWebdavUrl && config.torboxWebdavUsername),
              url: config.torboxWebdavUrl || null,
            },
          });
        }
      } else if (activeProviders.includes("torbox")) {
        providers.push({
          name: "TorBox",
          id: "torbox",
          configured: false,
          connected: false,
          webdav: { configured: false, url: null },
        });
      }

      // --- Real-Debrid ---
      if (activeProviders.includes("realdebrid") && isRDConfigured()) {
        try {
          const torrents = await listRDTorrents();
          providers.push({
            name: "Real-Debrid",
            id: "realdebrid",
            configured: true,
            connected: true,
            torrentCount: torrents.length,
            webdav: {
              configured: !!(config.rdWebdavUrl && config.rdWebdavUsername),
              url: config.rdWebdavUrl || null,
            },
          });
        } catch (err: any) {
          providers.push({
            name: "Real-Debrid",
            id: "realdebrid",
            configured: true,
            connected: false,
            error: err.message,
            webdav: {
              configured: !!(config.rdWebdavUrl && config.rdWebdavUsername),
              url: config.rdWebdavUrl || null,
            },
          });
        }
      } else if (activeProviders.includes("realdebrid")) {
        providers.push({
          name: "Real-Debrid",
          id: "realdebrid",
          configured: false,
          connected: false,
          webdav: { configured: false, url: null },
        });
      }

      res.json({ ok: true, providers });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message, providers: [] });
    }
  });

  // ===========================================================================
  // Torrents API
  // ===========================================================================

  /**
   * GET /api/torrents — Returns a combined, sorted list of torrents from
   * all active providers. Each torrent is normalised to a consistent shape.
   */
  app.get("/api/torrents", async (_req, res) => {
    try {
      const allTorrents: any[] = [];
      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];

      // Get TorBox torrents
      if (activeProviders.includes("torbox") && config.torboxApiKey) {
        try {
          const torrents = await listTorboxTorrents();
          for (const t of torrents) {
            allTorrents.push({
              id: t.id || t.hash,
              name: t.name,
              status: t.download_state || t.status || "unknown",
              progress: typeof t.progress === "number" ? t.progress : 0,
              size: t.size || 0,
              provider: "torbox",
              addedAt: t.created_at || t.added,
              downloadSpeed: t.download_speed || 0,
              uploadSpeed: t.upload_speed || 0,
              seeds: t.seeds || 0,
              peers: t.peers || 0,
            });
          }
        } catch (err: any) {
          console.error("[api/torrents] TorBox error:", err.message);
        }
      }

      // Get Real-Debrid torrents
      if (activeProviders.includes("realdebrid") && isRDConfigured()) {
        try {
          const torrents = await listRDTorrents();
          for (const t of torrents) {
            allTorrents.push({
              id: t.id,
              name: t.filename || t.original_filename,
              status: t.status || "unknown",
              progress: typeof t.progress === "number" ? t.progress : 0,
              size: t.bytes || 0,
              provider: "realdebrid",
              addedAt: t.added,
              downloadSpeed: t.speed || 0,
              uploadSpeed: 0,
              seeds: t.seeders || 0,
              peers: 0,
            });
          }
        } catch (err: any) {
          console.error("[api/torrents] Real-Debrid error:", err.message);
        }
      }

      // Sort by added date descending (newest first)
      allTorrents.sort((a, b) => {
        const dateA = new Date(a.addedAt || 0).getTime();
        const dateB = new Date(b.addedAt || 0).getTime();
        return dateB - dateA;
      });

      res.json({ ok: true, torrents: allTorrents });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message, torrents: [] });
    }
  });

  // ===========================================================================
  // Downloads API
  // ===========================================================================

  /**
   * GET /api/downloads — Returns a combined, sorted list of downloads from
   * all active providers (RD downloads, TorBox web/usenet downloads).
   */
  app.get("/api/downloads", async (_req, res) => {
    try {
      const allDownloads: any[] = [];
      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];

      // Get Real-Debrid downloads
      if (activeProviders.includes("realdebrid") && isRDConfigured()) {
        try {
          const downloads = await listRDDownloads();
          for (const d of downloads) {
            allDownloads.push({
              id: d.id,
              name: d.filename,
              type: "download",
              status: "downloaded",
              progress: 100,
              size: d.filesize || 0,
              provider: "realdebrid",
              addedAt: d.generated,
              downloadUrl: d.download,
              host: d.host,
              link: d.link,
              streamable: d.streamable,
              mimeType: d.mimeType,
            });
          }
        } catch (err: any) {
          console.error("[api/downloads] Real-Debrid error:", err.message);
        }
      }

      // Get TorBox web downloads
      if (activeProviders.includes("torbox") && config.torboxApiKey) {
        try {
          const webDownloads = await listTorboxWebDownloads();
          for (const d of webDownloads) {
            allDownloads.push({
              id: d.id,
              name: d.name,
              type: "web",
              status: d.download_state || d.status || "unknown",
              progress: typeof d.progress === "number" ? d.progress : 100,
              size: d.size || 0,
              provider: "torbox",
              addedAt: d.created_at || d.added,
              downloadSpeed: d.download_speed || 0,
            });
          }
        } catch (err: any) {
          console.error("[api/downloads] TorBox web downloads error:", err.message);
        }

        // Get TorBox usenet downloads
        try {
          const usenetDownloads = await listTorboxUsenetDownloads();
          for (const d of usenetDownloads) {
            allDownloads.push({
              id: d.id,
              name: d.name,
              type: "usenet",
              status: d.download_state || d.status || "unknown",
              progress: typeof d.progress === "number" ? d.progress : 100,
              size: d.size || 0,
              provider: "torbox",
              addedAt: d.created_at || d.added,
              downloadSpeed: d.download_speed || 0,
            });
          }
        } catch (err: any) {
          console.error("[api/downloads] TorBox usenet downloads error:", err.message);
        }
      }

      // Sort by added date descending (newest first)
      allDownloads.sort((a, b) => {
        const dateA = new Date(a.addedAt || 0).getTime();
        const dateB = new Date(b.addedAt || 0).getTime();
        return dateB - dateA;
      });

      res.json({ ok: true, downloads: allDownloads });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message, downloads: [] });
    }
  });

  // ===========================================================================
  // SSE Streaming — Torrents
  // ===========================================================================

  /**
   * GET /api/torrents/stream — Server-Sent Events endpoint that streams
   * torrent data page-by-page as it's fetched from providers.
   *
   * Uses in-flight request locking to prevent duplicate concurrent fetches.
   * If another request is already in-flight, returns cached data immediately
   * or waits for the in-flight request to complete.
   *
   * Events emitted: `status`, `torrents`, `error`, `done`.
   */
  app.get("/api/torrents/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    /** Helper to emit a named SSE event with JSON data. */
    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Acquire an exclusive lock to prevent concurrent API requests
    const lockKey = "stream:torrents";
    let gotLock = await rateLimiter.acquireLock(lockKey);
    
    if (!gotLock) {
      // Another request is already in-flight — try serving from cache
      const cachedTorrents = rateLimiter.getCache<any[]>("realdebrid_torrents");
      if (cachedTorrents && cachedTorrents.length > 0) {
        send("status", { message: "Using cached data..." });
        const mapped = cachedTorrents.map((t: any) => ({
          id: t.id,
          name: t.filename || t.original_filename,
          status: t.status || "unknown",
          progress: typeof t.progress === "number" ? t.progress : 0,
          size: t.bytes || 0,
          provider: "realdebrid",
          addedAt: t.added,
          downloadSpeed: t.speed || 0,
          uploadSpeed: 0,
          seeds: t.seeders || 0,
          peers: 0,
        }));
        send("torrents", { provider: "realdebrid", torrents: mapped, count: mapped.length, total: mapped.length, cached: true });
        send("done", { message: "Returned cached data", cached: true });
        res.end();
        return;
      }
      // No cache available — wait for the in-flight request to finish
      send("status", { message: "Waiting for data..." });
      gotLock = await rateLimiter.acquireLock(lockKey, true); // wait for lock
    }

    try {
      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];
      send("status", { message: "Fetching torrents...", providers: activeProviders });
      let totalCount = 0;

      // Fetch TorBox torrents (not paginated, single call)
      if (activeProviders.includes("torbox") && config.torboxApiKey) {
        send("status", { message: "Fetching TorBox torrents..." });
        try {
          const torrents = await listTorboxTorrents();
          const mapped = torrents.map((t: any) => ({
            id: t.id || t.hash,
            name: t.name,
            status: t.download_state || t.status || "unknown",
            progress: typeof t.progress === "number" ? t.progress : 0,
            size: t.size || 0,
            provider: "torbox",
            addedAt: t.created_at || t.added,
            downloadSpeed: t.download_speed || 0,
            uploadSpeed: t.upload_speed || 0,
            seeds: t.seeds || 0,
            peers: t.peers || 0,
          }));
          totalCount += mapped.length;
          send("torrents", { provider: "torbox", torrents: mapped, count: mapped.length, total: totalCount });
        } catch (err: any) {
          send("error", { provider: "torbox", error: err.message });
        }
      }

      // Fetch Real-Debrid torrents — stream page by page via async generator
      if (activeProviders.includes("realdebrid") && isRDConfigured()) {
        send("status", { message: "Fetching Real-Debrid torrents..." });
        try {
          let pageNum = 0;
          for await (const page of listRDTorrentsStream()) {
            pageNum++;
            const mapped = page.map((t: any) => ({
              id: t.id,
              name: t.filename || t.original_filename,
              status: t.status || "unknown",
              progress: typeof t.progress === "number" ? t.progress : 0,
              size: t.bytes || 0,
              provider: "realdebrid",
              addedAt: t.added,
              downloadSpeed: t.speed || 0,
              uploadSpeed: 0,
              seeds: t.seeders || 0,
              peers: 0,
            }));
            totalCount += mapped.length;
            send("torrents", { provider: "realdebrid", torrents: mapped, count: mapped.length, total: totalCount, page: pageNum });
          }
        } catch (err: any) {
          send("error", { provider: "realdebrid", error: err.message });
        }
      }

      send("done", { message: "All providers fetched", total: totalCount });
      res.end();
    } catch (err: any) {
      send("error", { error: err.message });
      res.end();
    } finally {
      rateLimiter.releaseLock(lockKey);
    }
  });

  // ===========================================================================
  // SSE Streaming — Downloads
  // ===========================================================================

  /**
   * GET /api/downloads/stream — Server-Sent Events endpoint that streams
   * download data page-by-page as it's fetched from providers.
   *
   * Uses the same in-flight locking pattern as the torrents stream endpoint.
   *
   * Events emitted: `status`, `downloads`, `error`, `done`.
   */
  app.get("/api/downloads/stream", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    /** Helper to emit a named SSE event with JSON data. */
    const send = (event: string, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Acquire an exclusive lock to prevent concurrent API requests
    const lockKey = "stream:downloads";
    let gotLock = await rateLimiter.acquireLock(lockKey);
    
    if (!gotLock) {
      // Another request is already in-flight — try serving from cache
      const cachedDownloads = rateLimiter.getCache<any[]>("realdebrid_downloads");
      if (cachedDownloads && cachedDownloads.length > 0) {
        send("status", { message: "Using cached data..." });
        const mapped = cachedDownloads.map((d: any) => ({
          id: d.id,
          name: d.filename,
          type: "download",
          status: "downloaded",
          progress: 100,
          size: d.filesize || 0,
          provider: "realdebrid",
          addedAt: d.generated,
          downloadUrl: d.download,
          host: d.host,
        }));
        send("downloads", { provider: "realdebrid", type: "download", downloads: mapped, count: mapped.length, total: mapped.length, cached: true });
        send("done", { message: "Returned cached data", cached: true });
        res.end();
        return;
      }
      // No cache available — wait for the in-flight request to finish
      send("status", { message: "Waiting for data..." });
      gotLock = await rateLimiter.acquireLock(lockKey, true); // wait for lock
    }

    try {
      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];
      send("status", { message: "Fetching downloads...", providers: activeProviders });
      let totalCount = 0;

      // Fetch Real-Debrid downloads — stream page by page via async generator
      if (activeProviders.includes("realdebrid") && isRDConfigured()) {
        send("status", { message: "Fetching Real-Debrid downloads..." });
        try {
          let pageNum = 0;
          for await (const page of listRDDownloadsStream()) {
            pageNum++;
            const mapped = page.map((d: any) => ({
              id: d.id,
              name: d.filename,
              type: "download",
              status: "downloaded",
              progress: 100,
              size: d.filesize || 0,
              provider: "realdebrid",
              addedAt: d.generated,
              downloadUrl: d.download,
              host: d.host,
              link: d.link,
              streamable: d.streamable,
              mimeType: d.mimeType,
            }));
            totalCount += mapped.length;
            send("downloads", { provider: "realdebrid", type: "download", downloads: mapped, count: mapped.length, total: totalCount, page: pageNum });
          }
        } catch (err: any) {
          send("error", { provider: "realdebrid", error: err.message });
        }
      }

      // Fetch TorBox web downloads (not paginated)
      if (activeProviders.includes("torbox") && config.torboxApiKey) {
        send("status", { message: "Fetching TorBox web downloads..." });
        try {
          const webDownloads = await listTorboxWebDownloads();
          const mapped = webDownloads.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: "web",
            status: d.download_state || d.status || "unknown",
            progress: typeof d.progress === "number" ? d.progress : 100,
            size: d.size || 0,
            provider: "torbox",
            addedAt: d.created_at || d.added,
            downloadSpeed: d.download_speed || 0,
          }));
          totalCount += mapped.length;
          send("downloads", { provider: "torbox", type: "web", downloads: mapped, count: mapped.length, total: totalCount });
        } catch (err: any) {
          send("error", { provider: "torbox", type: "web", error: err.message });
        }

        // Fetch TorBox usenet downloads
        send("status", { message: "Fetching TorBox usenet downloads..." });
        try {
          const usenetDownloads = await listTorboxUsenetDownloads();
          const mapped = usenetDownloads.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: "usenet",
            status: d.download_state || d.status || "unknown",
            progress: typeof d.progress === "number" ? d.progress : 100,
            size: d.size || 0,
            provider: "torbox",
            addedAt: d.created_at || d.added,
            downloadSpeed: d.download_speed || 0,
          }));
          totalCount += mapped.length;
          send("downloads", { provider: "torbox", type: "usenet", downloads: mapped, count: mapped.length, total: totalCount });
        } catch (err: any) {
          send("error", { provider: "torbox", type: "usenet", error: err.message });
        }
      }

      send("done", { message: "All providers fetched", total: totalCount });
      res.end();
    } catch (err: any) {
      send("error", { error: err.message });
      res.end();
    } finally {
      rateLimiter.releaseLock(lockKey);
    }
  });

  // ===========================================================================
  // Search API
  // ===========================================================================

  /**
   * GET /api/search — Searches configured indexers (Jackett/Prowlarr)
   * for torrents matching the given query.
   *
   * Query params:
   * - `q` (required) — The search query string.
   * - `categories` (optional) — Comma-separated category IDs.
   */
  app.get("/api/search", async (req, res) => {
    try {
      const query = String(req.query.q || "").trim();
      const categories = req.query.categories ? String(req.query.categories).split(",") : undefined;

      if (!query) {
        return res.status(400).json({ ok: false, error: "Missing query parameter 'q'" });
      }

      if (!isIndexerConfigured()) {
        return res.status(503).json({ 
          ok: false, 
          error: "No indexer configured. Set Jackett or Prowlarr in settings.",
          results: [],
        });
      }

      console.log(`[${new Date().toISOString()}][api/search] searching`, { query, categories });
      const results = await searchIndexer(query, { categories });
      
      // Normalise results to a consistent shape regardless of indexer response format
      const mappedResults = results.map((r: any) => ({
        title: r.title || r.Title,
        size: r.size || r.Size || 0,
        seeders: r.seeders || r.Seeders || 0,
        leechers: r.leechers || r.Leechers || 0,
        magnetUrl: r.magnetUrl || r.MagnetUrl || r.downloadUrl || r.DownloadUrl,
        infoHash: r.infoHash || r.InfoHash,
        indexer: r.indexer || r.Indexer || "Unknown",
        publishDate: r.publishDate || r.PublishDate,
        categories: r.categories || r.Categories || [],
      }));

      res.json({ 
        ok: true, 
        results: mappedResults,
        provider: getProviderName(),
        count: mappedResults.length,
      });
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][api/search] error`, err.message);
      res.status(500).json({ ok: false, error: err.message, results: [] });
    }
  });

  // ===========================================================================
  // Add Magnet API
  // ===========================================================================

  /**
   * POST /api/add — Adds a magnet link to the specified (or default) provider.
   *
   * Request body:
   * - `magnet` (required) — The magnet URI to add.
   * - `name` (optional) — Human-readable name for the torrent.
   * - `provider` (optional) — Target provider ("torbox" or "realdebrid").
   *
   * For Real-Debrid, automatically selects all files after adding.
   */
  app.post("/api/add", async (req, res) => {
    try {
      const { magnet, name, provider: targetProvider } = req.body || {};

      if (!magnet) {
        return res.status(400).json({ ok: false, error: "Missing 'magnet' in request body" });
      }

      const activeProviders = config.providers.length > 0 ? config.providers : ["torbox"];
      const selectedProvider = targetProvider || activeProviders[0];

      if (selectedProvider === "torbox") {
        if (!config.torboxApiKey) {
          return res.status(503).json({ ok: false, error: "TorBox API key not configured" });
        }
        console.log(`[${new Date().toISOString()}][api/add] adding to TorBox`, { name });
        const result = await addMagnetToTorbox(magnet, name);
        res.json({ ok: true, provider: "torbox", result });
      } else if (selectedProvider === "realdebrid") {
        if (!isRDConfigured()) {
          return res.status(503).json({ ok: false, error: "Real-Debrid not configured" });
        }
        console.log(`[${new Date().toISOString()}][api/add] adding to Real-Debrid`, { name });
        const result = await addMagnetToRD(magnet);
        // Automatically select all files to begin downloading
        if (result.id) {
          await selectAllFilesRD(result.id);
        }
        res.json({ ok: true, provider: "realdebrid", result });
      } else {
        return res.status(400).json({ ok: false, error: `Unknown provider: ${selectedProvider}` });
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][api/add] error`, err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===========================================================================
  // Logs API
  // ===========================================================================

  /**
   * GET /api/logs — Returns recent log entries from the in-memory log buffer.
   *
   * Query params:
   * - `limit` (optional) — Number of entries to return (max 500, default 100).
   * - `level` (optional) — Filter by log level (default "all").
   */
  app.get("/api/logs", (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const level = String(req.query.level || "all");
      const logs = logBuffer.getLogs(limit, level);
      res.json({ ok: true, logs });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message, logs: [] });
    }
  });

  /**
   * GET /api/logs/stream — SSE endpoint for real-time log streaming.
   * Sends initial log batch, then streams new entries as they arrive.
   * Includes a 30-second heartbeat to keep the connection alive.
   */
  app.get("/api/logs/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Send initial batch of recent logs
    const initialLogs = logBuffer.getLogs(50);
    res.write(`data: ${JSON.stringify({ type: "initial", logs: initialLogs })}\n\n`);

    // Subscribe to new log entries — callback fires for each new entry
    const unsubscribe = logBuffer.subscribe((entry) => {
      res.write(`data: ${JSON.stringify({ type: "log", log: entry })}\n\n`);
    });

    // Keep connection alive with periodic heartbeat comments
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 30000);

    // Cleanup on client disconnect
    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  /** DELETE /api/logs — Clears the in-memory log buffer. */
  app.delete("/api/logs", (_req, res) => {
    try {
      logBuffer.clear();
      res.json({ ok: true, message: "Logs cleared" });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===========================================================================
  // Overseerr Webhook
  // ===========================================================================

  if (config.runWebhook) {
    /**
     * POST /webhook/overseerr — Receives webhook payloads from Overseerr
     * when new media is requested.
     *
     * Processing flow:
     * 1. Validates indexer and API key configuration
     * 2. Checks optional authorisation header
     * 3. Extracts search query from the webhook payload
     * 4. Responds with HTTP 202 immediately (avoids Overseerr's 20s timeout)
     * 5. Processes asynchronously: searches indexer → picks best result → adds magnet
     */
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

        // Optional webhook authorisation check
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

        // Background async processing — search, select best result, and add magnet
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

  // ===========================================================================
  // Filesystem Browser
  // ===========================================================================

  /**
   * GET /api/files — Browses the actual mounted filesystem.
   * Returns directory listings or file metadata for the requested path.
   *
   * Query params:
   * - `path` (optional) — Relative path within the mount base (default "/").
   *
   * Includes directory traversal protection to prevent accessing files
   * outside the mount base.
   */
  app.get("/api/files", async (req, res) => {
    try {
      const requestedPath = String(req.query.path || "/");
      const mountBase = config.mountBase || "/mnt/schrodrive";
      
      // Sanitise path to prevent directory traversal attacks
      const safePath = path.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, "");
      const fullPath = path.join(mountBase, safePath);
      
      // Ensure the resolved path hasn't escaped the mount base
      if (!fullPath.startsWith(mountBase)) {
        return res.status(403).json({ ok: false, error: "Access denied" });
      }
      
      // Check if path exists
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ ok: false, error: "Path not found", path: safePath });
      }
      
      const stat = fs.statSync(fullPath);
      
      if (stat.isFile()) {
        // Return file metadata (not the file contents)
        return res.json({
          ok: true,
          type: "file",
          path: safePath,
          name: path.basename(fullPath),
          size: stat.size,
          modified: stat.mtime,
        });
      }
      
      // List directory contents
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      const items = entries.map((entry) => {
        const itemPath = path.join(fullPath, entry.name);
        try {
          const itemStat = fs.statSync(itemPath);
          return {
            name: entry.name,
            path: path.join(safePath, entry.name),
            type: entry.isDirectory() ? "directory" : "file",
            size: entry.isFile() ? itemStat.size : undefined,
            modified: itemStat.mtime,
          };
        } catch {
          return {
            name: entry.name,
            path: path.join(safePath, entry.name),
            type: entry.isDirectory() ? "directory" : "file",
          };
        }
      });
      
      // Sort: directories first, then alphabetically by name
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      
      res.json({
        ok: true,
        type: "directory",
        path: safePath,
        items,
        mountBase,
      });
    } catch (err: any) {
      console.error("[api/files] Error:", err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ===========================================================================
  // Server Startup
  // ===========================================================================

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  // Optional: start Overseerr API poller for periodic request checking
  if (config.runPoller) {
    startOverseerrPoller();
  }

  // Optional: start auto-updater for self-update checks
  startAutoUpdater();
}

// ===========================================================================
// Webhook Payload Parser
// ===========================================================================

/**
 * Extracts a search query and optional category filters from an Overseerr
 * webhook payload.
 *
 * Prefers the `subject` field if present. Falls back to constructing a
 * query from `media.title`/`media.name` with optional year and TMDB ID.
 *
 * Maps `media_type` to Prowlarr category IDs:
 * - "movie" → `["5000"]`
 * - "tv" → `["5000"]`
 *
 * @param payload - The raw Overseerr webhook payload.
 * @returns An object with `query` and optional `categories`, or `undefined` if no query could be derived.
 */
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
    // Append TMDB ID for more specific search results
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
