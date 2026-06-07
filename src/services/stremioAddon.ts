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

import express from "express";
import cors from "cors";
import { config } from "../core/config";
import {
  searchScrapers,
  searchAll,
  isAnyScraperConfigured,
  isIndexerConfigured,
  isAnySearchConfigured,
  getMagnet,
} from "../indexers/index";
import type { ScraperResult } from "../indexers/stremioScraper";
import { registry } from "../providers";

// =============================================================================
// Manifest
// =============================================================================

const MANIFEST = {
  id: "au.schrodrive.addon",
  version: "0.9.0",
  name: "SchröDrive",
  description:
    "Stream content from your debrid providers via SchröDrive. " +
    "Searches Torrentio, Comet, Zilean, Mediafusion, and optionally Prowlarr/Jackett in parallel.",
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

// =============================================================================
// Helpers
// =============================================================================

/**
 * Extracts a 40-hex info hash from a magnet URI.
 *
 * @param magnetUri - The magnet URI to extract from.
 * @returns The 40-hex info hash in lowercase, or undefined.
 */
function extractInfoHash(magnetUri: string | undefined): string | undefined {
  if (!magnetUri) return undefined;

  // Match btih: followed by 40 hex chars or 32 base32 chars
  const match = magnetUri.match(/btih:([a-fA-F0-9]{40})/i);
  if (match) return match[1].toLowerCase();

  // Try base32 (some magnets use this)
  const b32Match = magnetUri.match(/btih:([A-Z2-7]{32})/i);
  if (b32Match) {
    // Base32 to hex conversion
    try {
      const b32 = b32Match[1].toUpperCase();
      const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
      let bits = "";
      for (const c of b32) {
        const idx = chars.indexOf(c);
        if (idx === -1) return undefined;
        bits += idx.toString(2).padStart(5, "0");
      }
      let hex = "";
      for (let i = 0; i + 4 <= bits.length; i += 4) {
        hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
      }
      if (hex.length === 40) return hex.toLowerCase();
    } catch {
      return undefined;
    }
  }

  return undefined;
}

// =============================================================================
// Stream Handler
// =============================================================================

interface StremioStreamResponse {
  streams: Array<{
    name: string;
    title: string;
    infoHash?: string;
    behaviorHints?: {
      bingeGroup?: string;
      notWebReady?: boolean;
    };
  }>;
}

/**
 * Handles Stremio stream requests. Searches all configured sources
 * (scrapers AND indexers), then returns results formatted as Stremio streams.
 *
 * URL format: /stream/:type/:id.json
 * - type: "movie" or "series"
 * - id: IMDB ID (e.g. "tt1234567") or "tt1234567:1:2" for series (season:episode)
 */
async function handleStreamRequest(
  type: string,
  id: string,
): Promise<StremioStreamResponse> {
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
    hasScraper: isAnyScraperConfigured(),
    hasIndexer: isIndexerConfigured(),
  });

  try {
    // Search ALL configured sources (scrapers + indexers)
    const results = await searchAll(imdbId, {
      imdbId,
      mediaType,
      season,
      episode,
    });

    console.log(
      `[${new Date().toISOString()}][stremio-addon] search returned ${results.length} raw results for ${imdbId}`,
    );

    // Convert to Stremio stream format
    const streams: StremioStreamResponse["streams"] = [];
    const seenHashes = new Set<string>();

    for (const r of results) {
      // Try to get an infoHash — Stremio requires this for torrent streams
      let infoHash: string | undefined;

      // ScraperResult has infoHash directly
      if ("source" in r && (r as ScraperResult).infoHash) {
        infoHash = (r as ScraperResult).infoHash?.toLowerCase();
      }

      // IndexerResult — try to extract from magnetUrl/magnetUri field
      if (!infoHash) {
        const magnet = getMagnet(r);
        infoHash = extractInfoHash(magnet);
      }

      // Also try common field names from indexer results
      if (!infoHash) {
        const raw = r as any;
        infoHash = extractInfoHash(raw.magnetUrl || raw.magnetUri || raw.magnet);
        if (!infoHash && raw.infoHash) {
          infoHash = raw.infoHash.toLowerCase();
        }
        if (!infoHash && raw.infohash) {
          infoHash = raw.infohash.toLowerCase();
        }
        if (!infoHash && raw.hash) {
          infoHash = raw.hash.toLowerCase();
        }
      }

      // Skip results without infoHash — Stremio can't use them
      if (!infoHash) continue;

      // Deduplicate
      if (seenHashes.has(infoHash)) continue;
      seenHashes.add(infoHash);

      // Extract title
      const title =
        (r as any).title ||
        (r as any).name ||
        (r as any).fileName ||
        "Unknown";

      // Extract quality from title
      const qualityMatch = title.match(
        /(2160p|1080p|720p|480p|4K|HDR|DV)/i,
      );
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : "";

      // Extract seeders
      const seeders = (r as any).seeders || (r as any).Seeders || 0;

      // Extract size
      const rawSize =
        (r as any).size || (r as any).Size || (r as any).sizeBytes || 0;
      const sizeGB =
        rawSize && rawSize > 0
          ? `${(rawSize / 1073741824).toFixed(1)} GB`
          : "";

      // Determine source label
      const source =
        "source" in r
          ? (r as ScraperResult).source
          : "indexer";

      const nameParts = ["SchröDrive"];
      if (quality) nameParts.push(quality);
      if (seeders > 0) nameParts.push(`👤 ${seeders}`);
      if (sizeGB) nameParts.push(`💾 ${sizeGB}`);

      streams.push({
        name: nameParts.join("\n"),
        title,
        infoHash,
        behaviorHints: {
          bingeGroup: `schrodrive-${source}`,
          notWebReady: true,
        },
      });
    }

    console.log(
      `[${new Date().toISOString()}][stremio-addon] returning ${streams.length} streams for ${imdbId} (from ${results.length} raw results)`,
    );
    return { streams };
  } catch (err: any) {
    console.error(
      `[${new Date().toISOString()}][stremio-addon] stream handler error`,
      { err: err?.message, stack: err?.stack?.split("\n").slice(0, 3) },
    );
    return { streams: [] };
  }
}

// =============================================================================
// Server
// =============================================================================

let addonServer: ReturnType<typeof express> | null = null;

/**
 * Starts the Stremio addon HTTP server on the configured port.
 *
 * Only starts if `STREMIO_ADDON_ENABLED=true` in config.
 */
export function startStremioAddonServer(): void {
  if (!config.stremioAddonEnabled) {
    console.log(
      `[${new Date().toISOString()}][stremio-addon] disabled (STREMIO_ADDON_ENABLED=false)`,
    );
    return;
  }

  const app = express();

  // CORS — required for Stremio clients (web, desktop, mobile)
  app.use(cors());

  // Also add explicit CORS headers as a belt-and-braces approach
  app.use((_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    next();
  });

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
    } catch (err: any) {
      console.error(
        `[${new Date().toISOString()}][stremio-addon] request error`,
        { err: err?.message },
      );
      res.status(500).json({ streams: [] });
    }
  });

  // Health endpoint
  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      addon: "schrodrive",
      version: MANIFEST.version,
      scrapers: isAnyScraperConfigured(),
      indexers: isIndexerConfigured(),
      anySearch: isAnySearchConfigured(),
      providers: registry
        .configured()
        .map((p) => p.id),
    });
  });

  const port = config.stremioAddonPort;
  app.listen(port, "0.0.0.0", () => {
    console.log(
      `[${new Date().toISOString()}][stremio-addon] 🎬 Stremio addon server running on 0.0.0.0:${port}`,
    );
    console.log(
      `[${new Date().toISOString()}][stremio-addon] Install URL: http://localhost:${port}/manifest.json`,
    );

    // Log search source status
    const sources: string[] = [];
    if (isAnyScraperConfigured()) sources.push("scrapers");
    if (isIndexerConfigured()) sources.push("indexers");

    if (sources.length === 0) {
      console.warn(
        `[${new Date().toISOString()}][stremio-addon] ⚠️  No search sources configured — enable TORRENTIO_ENABLED, ZILEAN_ENABLED, or configure Prowlarr/Jackett`,
      );
    } else {
      console.log(
        `[${new Date().toISOString()}][stremio-addon] ✅ Active search sources: ${sources.join(", ")}`,
      );
    }
  });

  addonServer = app;
}

/**
 * Returns the addon install URL for logging/display purposes.
 */
export function getAddonInstallUrl(): string {
  return `http://localhost:${config.stremioAddonPort}/manifest.json`;
}
