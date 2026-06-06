"use strict";
/**
 * SchröDrive — Stremio Addon Server
 *
 * Exposes SchröDrive as a Stremio addon so users can install it directly
 * in their Stremio app. When a user searches for content, SchröDrive
 * searches all configured scrapers and indexers, then returns available
 * streams backed by their debrid providers.
 *
 * This is unique to SchröDrive — none of our competitors (Zurg, pd_zurg,
 * Riven) expose themselves as installable Stremio addons.
 *
 * Stremio addon protocol:
 * - GET /manifest.json — addon manifest (name, version, resources)
 * - GET /stream/:type/:id.json — returns streams for a given IMDB ID
 *
 * @module services/stremioAddon
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startStremioAddonServer = startStremioAddonServer;
exports.getAddonInstallUrl = getAddonInstallUrl;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("../core/config");
const index_1 = require("../indexers/index");
const providers_1 = require("../providers");
// =============================================================================
// Manifest
// =============================================================================
const MANIFEST = {
    id: "au.schrodrive.addon",
    version: "0.3.0",
    name: "SchröDrive",
    description: "Stream content from your debrid providers via SchröDrive. Searches Torrentio, Comet, Zilean, and Mediafusion in parallel.",
    logo: "https://raw.githubusercontent.com/moderniselife/SchroDrive/main/frontend/public/icon.png",
    resources: ["stream"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"],
    behaviorHints: {
        configurable: false,
        configurationRequired: false,
    },
};
/**
 * Handles Stremio stream requests. Searches all configured scrapers,
 * then returns results formatted as Stremio streams.
 *
 * URL format: /stream/:type/:id.json
 * - type: "movie" or "series"
 * - id: IMDB ID (e.g. "tt1234567") or "tt1234567:1:2" for series (season:episode)
 */
async function handleStreamRequest(type, id) {
    // Parse IMDB ID and optional season/episode
    const parts = id.replace(".json", "").split(":");
    const imdbId = parts[0];
    const season = parts[1] ? parseInt(parts[1], 10) : undefined;
    const episode = parts[2] ? parseInt(parts[2], 10) : undefined;
    if (!imdbId || !imdbId.startsWith("tt")) {
        return { streams: [] };
    }
    const mediaType = type === "series" ? "series" : "movie";
    console.log(`[${new Date().toISOString()}][stremio-addon] stream request`, {
        type: mediaType,
        imdbId,
        season,
        episode,
    });
    try {
        // Search all configured scrapers
        const results = await (0, index_1.searchScrapers)(imdbId, {
            imdbId,
            mediaType,
            season,
            episode,
        });
        // Convert to Stremio stream format
        const streams = results
            .filter((r) => r.infoHash || r.magnetUrl)
            .map((r) => {
            // Build a descriptive name line
            const providerNames = providers_1.registry
                .configured()
                .map((p) => p.displayName)
                .join(" / ");
            // Extract quality from title
            const qualityMatch = r.title?.match(/(2160p|1080p|720p|480p|4K|HDR|DV)/i);
            const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "";
            // Build size string
            const sizeGB = r.size && r.size > 0
                ? `${(r.size / 1073741824).toFixed(1)} GB`
                : "";
            const nameParts = ["SchröDrive"];
            if (quality)
                nameParts.push(quality);
            if (r.seeders && r.seeders > 0)
                nameParts.push(`👤 ${r.seeders}`);
            if (sizeGB)
                nameParts.push(`💾 ${sizeGB}`);
            return {
                name: nameParts.join("\n"),
                title: r.title || "Unknown",
                infoHash: r.infoHash?.toLowerCase(),
                behaviorHints: {
                    bingeGroup: `schrodrive-${r.source}`,
                    notWebReady: true,
                },
            };
        });
        console.log(`[${new Date().toISOString()}][stremio-addon] returning ${streams.length} streams for ${imdbId}`);
        return { streams };
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][stremio-addon] stream handler error`, { err: err?.message });
        return { streams: [] };
    }
}
// =============================================================================
// Server
// =============================================================================
let addonServer = null;
/**
 * Starts the Stremio addon HTTP server on the configured port.
 *
 * Only starts if `STREMIO_ADDON_ENABLED=true` in config.
 */
function startStremioAddonServer() {
    if (!config_1.config.stremioAddonEnabled) {
        console.log(`[${new Date().toISOString()}][stremio-addon] disabled (STREMIO_ADDON_ENABLED=false)`);
        return;
    }
    const app = (0, express_1.default)();
    app.use((0, cors_1.default)());
    // Manifest endpoint
    app.get("/manifest.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.json(MANIFEST);
    });
    // Also serve manifest at root for convenience
    app.get("/", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.json(MANIFEST);
    });
    // Stream endpoint
    app.get("/stream/:type/:id.json", async (req, res) => {
        try {
            const { type, id } = req.params;
            const result = await handleStreamRequest(type, id);
            res.setHeader("Content-Type", "application/json");
            res.json(result);
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][stremio-addon] request error`, { err: err?.message });
            res.status(500).json({ streams: [] });
        }
    });
    // Health endpoint
    app.get("/health", (_req, res) => {
        res.json({
            status: "ok",
            addon: "schrodrive",
            scrapers: (0, index_1.isAnyScraperConfigured)(),
            providers: providers_1.registry
                .configured()
                .map((p) => p.id),
        });
    });
    const port = config_1.config.stremioAddonPort;
    app.listen(port, () => {
        console.log(`[${new Date().toISOString()}][stremio-addon] 🎬 Stremio addon server running on port ${port}`);
        console.log(`[${new Date().toISOString()}][stremio-addon] Install URL: http://localhost:${port}/manifest.json`);
        if (!(0, index_1.isAnyScraperConfigured)()) {
            console.warn(`[${new Date().toISOString()}][stremio-addon] ⚠️  No scrapers configured — enable TORRENTIO_ENABLED, ZILEAN_ENABLED, etc.`);
        }
    });
    addonServer = app;
}
/**
 * Returns the addon install URL for logging/display purposes.
 */
function getAddonInstallUrl() {
    return `http://localhost:${config_1.config.stremioAddonPort}/manifest.json`;
}
