"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startServer = startServer;
exports.buildQueryFromPayload = buildQueryFromPayload;
const express_1 = __importDefault(require("express"));
const config_1 = require("./config");
const indexer_1 = require("./indexer");
const torbox_1 = require("./torbox");
const overseerr_1 = require("./overseerr");
const autoUpdate_1 = require("./autoUpdate");
function startServer() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "1mb" }));
    app.get("/health", (_req, res) => {
        res.json({ ok: true });
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
