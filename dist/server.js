"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
exports.buildQueryFromPayload = buildQueryFromPayload;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("./config");
const indexer_1 = require("./indexer");
const torbox_1 = require("./torbox");
const realdebrid_1 = require("./realdebrid");
const overseerr_1 = require("./overseerr");
const autoUpdate_1 = require("./autoUpdate");
const configApi_1 = require("./configApi");
const logger_1 = require("./logger");
function startServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "1mb" }));
    app.use((0, cors_1.default)()); // Allow web GUI to connect
    app.get("/health", (_req, res) => {
        res.json({ ok: true });
    });
    // Config API endpoints for web GUI
    app.get("/api/config", (_req, res) => {
        try {
            const { config: configData, envPath } = (0, configApi_1.getConfigWithSources)();
            res.json({
                ok: true,
                config: configData,
                envPath,
                isDocker: (0, configApi_1.isRunningInDocker)(),
                schema: configApi_1.CONFIG_SCHEMA,
            });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.post("/api/config", (req, res) => {
        try {
            const updates = req.body?.config || {};
            const result = (0, configApi_1.saveConfigToFile)(updates);
            if (result.success) {
                res.json({ ok: true, message: "Configuration saved", path: result.path });
            }
            else {
                res.status(500).json({ ok: false, error: result.error, path: result.path });
            }
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.post("/api/restart", (_req, res) => {
        try {
            const result = (0, configApi_1.triggerRestart)();
            res.json({ ok: result.success, message: result.message });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.get("/api/status", (_req, res) => {
        res.json({
            ok: true,
            isDocker: (0, configApi_1.isRunningInDocker)(),
            services: {
                webhook: config_1.config.runWebhook,
                poller: config_1.config.runPoller,
                mount: config_1.config.runMount,
                deadScanner: config_1.config.runDeadScanner,
                deadScannerWatch: config_1.config.runDeadScannerWatch,
                organizerWatch: config_1.config.runOrganizerWatch,
            },
            indexer: {
                configured: (0, indexer_1.isIndexerConfigured)(),
                provider: (0, indexer_1.isIndexerConfigured)() ? (0, indexer_1.getProviderName)() : null,
            },
        });
    });
    // Provider status endpoint
    app.get("/api/providers", async (_req, res) => {
        try {
            const providers = [];
            const activeProviders = config_1.config.providers.length > 0 ? config_1.config.providers : ["torbox"];
            // Check TorBox
            if (activeProviders.includes("torbox") && config_1.config.torboxApiKey) {
                try {
                    const torrents = await (0, torbox_1.listTorboxTorrents)();
                    providers.push({
                        name: "TorBox",
                        id: "torbox",
                        configured: true,
                        connected: true,
                        torrentCount: torrents.length,
                        webdav: {
                            configured: !!(config_1.config.torboxWebdavUrl && config_1.config.torboxWebdavUsername),
                            url: config_1.config.torboxWebdavUrl || null,
                        },
                    });
                }
                catch (err) {
                    providers.push({
                        name: "TorBox",
                        id: "torbox",
                        configured: true,
                        connected: false,
                        error: err.message,
                        webdav: {
                            configured: !!(config_1.config.torboxWebdavUrl && config_1.config.torboxWebdavUsername),
                            url: config_1.config.torboxWebdavUrl || null,
                        },
                    });
                }
            }
            else if (activeProviders.includes("torbox")) {
                providers.push({
                    name: "TorBox",
                    id: "torbox",
                    configured: false,
                    connected: false,
                    webdav: { configured: false, url: null },
                });
            }
            // Check Real-Debrid
            if (activeProviders.includes("realdebrid") && (0, realdebrid_1.isRDConfigured)()) {
                try {
                    const torrents = await (0, realdebrid_1.listRDTorrents)();
                    providers.push({
                        name: "Real-Debrid",
                        id: "realdebrid",
                        configured: true,
                        connected: true,
                        torrentCount: torrents.length,
                        webdav: {
                            configured: !!(config_1.config.rdWebdavUrl && config_1.config.rdWebdavUsername),
                            url: config_1.config.rdWebdavUrl || null,
                        },
                    });
                }
                catch (err) {
                    providers.push({
                        name: "Real-Debrid",
                        id: "realdebrid",
                        configured: true,
                        connected: false,
                        error: err.message,
                        webdav: {
                            configured: !!(config_1.config.rdWebdavUrl && config_1.config.rdWebdavUsername),
                            url: config_1.config.rdWebdavUrl || null,
                        },
                    });
                }
            }
            else if (activeProviders.includes("realdebrid")) {
                providers.push({
                    name: "Real-Debrid",
                    id: "realdebrid",
                    configured: false,
                    connected: false,
                    webdav: { configured: false, url: null },
                });
            }
            res.json({ ok: true, providers });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message, providers: [] });
        }
    });
    // Torrents list endpoint
    app.get("/api/torrents", async (_req, res) => {
        try {
            const allTorrents = [];
            const activeProviders = config_1.config.providers.length > 0 ? config_1.config.providers : ["torbox"];
            // Get TorBox torrents
            if (activeProviders.includes("torbox") && config_1.config.torboxApiKey) {
                try {
                    const torrents = await (0, torbox_1.listTorboxTorrents)();
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
                }
                catch (err) {
                    console.error("[api/torrents] TorBox error:", err.message);
                }
            }
            // Get Real-Debrid torrents
            if (activeProviders.includes("realdebrid") && (0, realdebrid_1.isRDConfigured)()) {
                try {
                    const torrents = await (0, realdebrid_1.listRDTorrents)();
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
                }
                catch (err) {
                    console.error("[api/torrents] Real-Debrid error:", err.message);
                }
            }
            // Sort by added date descending
            allTorrents.sort((a, b) => {
                const dateA = new Date(a.addedAt || 0).getTime();
                const dateB = new Date(b.addedAt || 0).getTime();
                return dateB - dateA;
            });
            res.json({ ok: true, torrents: allTorrents });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message, torrents: [] });
        }
    });
    // Downloads list endpoint (Real-Debrid downloads + TorBox web/usenet downloads)
    app.get("/api/downloads", async (_req, res) => {
        try {
            const allDownloads = [];
            const activeProviders = config_1.config.providers.length > 0 ? config_1.config.providers : ["torbox"];
            // Get Real-Debrid downloads
            if (activeProviders.includes("realdebrid") && (0, realdebrid_1.isRDConfigured)()) {
                try {
                    const downloads = await (0, realdebrid_1.listRDDownloads)();
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
                }
                catch (err) {
                    console.error("[api/downloads] Real-Debrid error:", err.message);
                }
            }
            // Get TorBox web downloads
            if (activeProviders.includes("torbox") && config_1.config.torboxApiKey) {
                try {
                    const webDownloads = await (0, torbox_1.listTorboxWebDownloads)();
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
                }
                catch (err) {
                    console.error("[api/downloads] TorBox web downloads error:", err.message);
                }
                // Get TorBox usenet downloads
                try {
                    const usenetDownloads = await (0, torbox_1.listTorboxUsenetDownloads)();
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
                }
                catch (err) {
                    console.error("[api/downloads] TorBox usenet downloads error:", err.message);
                }
            }
            // Sort by added date descending
            allDownloads.sort((a, b) => {
                const dateA = new Date(a.addedAt || 0).getTime();
                const dateB = new Date(b.addedAt || 0).getTime();
                return dateB - dateA;
            });
            res.json({ ok: true, downloads: allDownloads });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message, downloads: [] });
        }
    });
    // Search endpoint
    app.get("/api/search", async (req, res) => {
        try {
            const query = String(req.query.q || "").trim();
            const categories = req.query.categories ? String(req.query.categories).split(",") : undefined;
            if (!query) {
                return res.status(400).json({ ok: false, error: "Missing query parameter 'q'" });
            }
            if (!(0, indexer_1.isIndexerConfigured)()) {
                return res.status(503).json({
                    ok: false,
                    error: "No indexer configured. Set Jackett or Prowlarr in settings.",
                    results: [],
                });
            }
            console.log(`[${new Date().toISOString()}][api/search] searching`, { query, categories });
            const results = await (0, indexer_1.searchIndexer)(query, { categories });
            // Map results to a consistent format
            const mappedResults = results.map((r) => ({
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
                provider: (0, indexer_1.getProviderName)(),
                count: mappedResults.length,
            });
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][api/search] error`, err.message);
            res.status(500).json({ ok: false, error: err.message, results: [] });
        }
    });
    // Add magnet endpoint
    app.post("/api/add", async (req, res) => {
        try {
            const { magnet, name, provider: targetProvider } = req.body || {};
            if (!magnet) {
                return res.status(400).json({ ok: false, error: "Missing 'magnet' in request body" });
            }
            const activeProviders = config_1.config.providers.length > 0 ? config_1.config.providers : ["torbox"];
            const selectedProvider = targetProvider || activeProviders[0];
            if (selectedProvider === "torbox") {
                if (!config_1.config.torboxApiKey) {
                    return res.status(503).json({ ok: false, error: "TorBox API key not configured" });
                }
                console.log(`[${new Date().toISOString()}][api/add] adding to TorBox`, { name });
                const result = await (0, torbox_1.addMagnetToTorbox)(magnet, name);
                res.json({ ok: true, provider: "torbox", result });
            }
            else if (selectedProvider === "realdebrid") {
                if (!(0, realdebrid_1.isRDConfigured)()) {
                    return res.status(503).json({ ok: false, error: "Real-Debrid not configured" });
                }
                console.log(`[${new Date().toISOString()}][api/add] adding to Real-Debrid`, { name });
                const result = await (0, realdebrid_1.addMagnetToRD)(magnet);
                if (result.id) {
                    await (0, realdebrid_1.selectAllFilesRD)(result.id);
                }
                res.json({ ok: true, provider: "realdebrid", result });
            }
            else {
                return res.status(400).json({ ok: false, error: `Unknown provider: ${selectedProvider}` });
            }
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][api/add] error`, err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    // Logs API - GET recent logs
    app.get("/api/logs", (req, res) => {
        try {
            const limit = Math.min(Number(req.query.limit) || 100, 500);
            const level = String(req.query.level || "all");
            const logs = logger_1.logBuffer.getLogs(limit, level);
            res.json({ ok: true, logs });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message, logs: [] });
        }
    });
    // Logs API - SSE streaming endpoint
    app.get("/api/logs/stream", (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();
        // Send initial logs
        const initialLogs = logger_1.logBuffer.getLogs(50);
        res.write(`data: ${JSON.stringify({ type: "initial", logs: initialLogs })}\n\n`);
        // Subscribe to new logs
        const unsubscribe = logger_1.logBuffer.subscribe((entry) => {
            res.write(`data: ${JSON.stringify({ type: "log", log: entry })}\n\n`);
        });
        // Keep connection alive with heartbeat
        const heartbeat = setInterval(() => {
            res.write(`: heartbeat\n\n`);
        }, 30000);
        // Cleanup on close
        req.on("close", () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
    });
    // Logs API - Clear logs
    app.delete("/api/logs", (_req, res) => {
        try {
            logger_1.logBuffer.clear();
            res.json({ ok: true, message: "Logs cleared" });
        }
        catch (err) {
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    if (config_1.config.runWebhook) {
        app.post("/webhook/overseerr", async (req, res) => {
            try {
                console.log(`[${new Date().toISOString()}][webhook] hit /webhook/overseerr`);
                // Check required environment variables early and return a helpful error
                if (!(0, indexer_1.isIndexerConfigured)()) {
                    console.warn(`[${new Date().toISOString()}][webhook] no indexer configured`);
                    return res.status(503).json({
                        ok: false,
                        error: "No indexer configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.",
                        documentation: "See README.md for configuration instructions.",
                    });
                }
                if (!config_1.config.torboxApiKey) {
                    console.warn(`[${new Date().toISOString()}][webhook] missing TORBOX_API_KEY`);
                    return res.status(503).json({
                        ok: false,
                        error: "TORBOX_API_KEY not configured.",
                        documentation: "See README.md for configuration instructions.",
                    });
                }
                if (config_1.config.overseerrAuth && req.get("authorization") !== config_1.config.overseerrAuth) {
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
                        const provider = (0, indexer_1.getProviderName)();
                        console.log(`[${new Date().toISOString()}][webhook->${provider}] searching`, { query: built.query, categories: built.categories });
                        const started = Date.now();
                        const results = await (0, indexer_1.searchIndexer)(built.query, { categories: built.categories });
                        console.log(`[${new Date().toISOString()}][webhook->${provider}] results`, { count: results.length, ms: Date.now() - started });
                        const best = (0, indexer_1.pickBestResult)(results);
                        console.log(`[${new Date().toISOString()}][webhook->${provider}] chosen`, { title: best?.title, seeders: best?.seeders, size: best?.size });
                        const magnet = (0, indexer_1.getMagnet)(best);
                        if (!magnet) {
                            console.warn(`[${new Date().toISOString()}][webhook] no magnet found in search results`, { query: built.query });
                            return;
                        }
                        const teaser = typeof magnet === 'string' ? magnet.slice(0, 80) + '...' : undefined;
                        console.log(`[${new Date().toISOString()}][webhook->torbox] adding magnet`, { title: best?.title, teaser });
                        await (0, torbox_1.addMagnetToTorbox)(magnet, best?.title);
                        console.log(`[${new Date().toISOString()}][webhook->torbox] added`);
                    }
                    catch (err) {
                        console.error(`[${new Date().toISOString()}][webhook] async processing error`, err?.message || String(err));
                    }
                })();
            }
            catch (e) {
                if (!res.headersSent) {
                    if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
                        console.error(`[${new Date().toISOString()}][webhook] timeout while searching indexer`);
                        res.status(504).json({ ok: false, error: "Request timed out while searching indexer. Try again or check your indexer configuration." });
                    }
                    else {
                        console.error(`[${new Date().toISOString()}][webhook] unexpected error`, e?.message || String(e));
                        res.status(500).json({ ok: false, error: e?.message || String(e) });
                    }
                }
            }
        });
    }
    // Filesystem browser endpoint - browses actual mounted files
    app.get("/api/files", async (req, res) => {
        try {
            const requestedPath = String(req.query.path || "/");
            const mountBase = config_1.config.mountBase || "/mnt/schrodrive";
            // Sanitize path to prevent directory traversal
            const safePath = path_1.default.normalize(requestedPath).replace(/^(\.\.[\/\\])+/, "");
            const fullPath = path_1.default.join(mountBase, safePath);
            // Ensure we're still within mount base
            if (!fullPath.startsWith(mountBase)) {
                return res.status(403).json({ ok: false, error: "Access denied" });
            }
            // Check if path exists
            if (!fs_1.default.existsSync(fullPath)) {
                return res.status(404).json({ ok: false, error: "Path not found", path: safePath });
            }
            const stat = fs_1.default.statSync(fullPath);
            if (stat.isFile()) {
                // Return file info
                return res.json({
                    ok: true,
                    type: "file",
                    path: safePath,
                    name: path_1.default.basename(fullPath),
                    size: stat.size,
                    modified: stat.mtime,
                });
            }
            // List directory contents
            const entries = fs_1.default.readdirSync(fullPath, { withFileTypes: true });
            const items = entries.map((entry) => {
                const itemPath = path_1.default.join(fullPath, entry.name);
                try {
                    const itemStat = fs_1.default.statSync(itemPath);
                    return {
                        name: entry.name,
                        path: path_1.default.join(safePath, entry.name),
                        type: entry.isDirectory() ? "directory" : "file",
                        size: entry.isFile() ? itemStat.size : undefined,
                        modified: itemStat.mtime,
                    };
                }
                catch {
                    return {
                        name: entry.name,
                        path: path_1.default.join(safePath, entry.name),
                        type: entry.isDirectory() ? "directory" : "file",
                    };
                }
            });
            // Sort: directories first, then by name
            items.sort((a, b) => {
                if (a.type !== b.type)
                    return a.type === "directory" ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            res.json({
                ok: true,
                type: "directory",
                path: safePath,
                items,
                mountBase,
            });
        }
        catch (err) {
            console.error("[api/files] Error:", err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });
    app.listen(config_1.config.port, () => {
        console.log(`Server listening on port ${config_1.config.port}`);
    });
    // Optional: start Overseerr API poller
    if (config_1.config.runPoller) {
        (0, overseerr_1.startOverseerrPoller)();
    }
    // Optional: start auto-updater
    (0, autoUpdate_1.startAutoUpdater)();
}
function buildQueryFromPayload(payload) {
    const subject = payload?.subject;
    const media = payload?.media || {};
    const title = media?.title || media?.name;
    const year = media?.year || media?.releaseYear;
    const mediaType = media?.media_type; // 'movie' or 'tv'
    const tmdbId = media?.tmdbId;
    let query = "";
    if (subject && subject.trim().length > 0) {
        query = subject.trim();
    }
    else if (title) {
        query = year ? `${title} ${year}` : title;
        if (tmdbId && Number.isInteger(Number(tmdbId))) {
            query += ` TMDB${tmdbId}`;
        }
    }
    if (!query)
        return undefined;
    const result = { query };
    // Map media_type to Prowlarr categories if configured
    const defaultCategories = {
        movie: ["5000"], // Movies
        tv: ["5000"], // TV (adjust as needed)
    };
    if (mediaType && defaultCategories[mediaType]) {
        result.categories = defaultCategories[mediaType];
    }
    return result;
}
