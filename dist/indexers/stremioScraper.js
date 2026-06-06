"use strict";
/**
 * stremioScraper.ts — Shared utilities for all Stremio addon protocol scrapers.
 *
 * Provides common types, stream parsing, quality/size extraction, and URL
 * construction used by torrentio, comet, mediafusion, and any future
 * Stremio-compatible addon scrapers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseQualityFromName = parseQualityFromName;
exports.buildStremioUrl = buildStremioUrl;
exports.parseStremioStreams = parseStremioStreams;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/**
 * Parse quality, size and seeder count from the Stremio stream `name` field.
 *
 * Typical formats:
 *   "Torrentio\n1080p"
 *   "⚙️ 42\n💾 2.1 GB\n1080p"
 */
function parseQualityFromName(name) {
    const quality = (name.match(/\b(2160p|1080p|720p|480p|360p|4K|UHD)\b/i)?.[1] ?? "unknown").toUpperCase();
    // Seeders — look for ⚙️ or "👤" followed by a number
    let seeders;
    const seederMatch = name.match(/[⚙👤]\s*(\d+)/);
    if (seederMatch) {
        seeders = parseInt(seederMatch[1], 10);
    }
    // Size — look for 💾 or a standalone size like "2.1 GB"
    let size;
    const sizeMatch = name.match(/💾?\s*([\d.]+)\s*(GB|MB|TB|KB)/i);
    if (sizeMatch) {
        const val = parseFloat(sizeMatch[1]);
        const unit = sizeMatch[2].toUpperCase();
        switch (unit) {
            case "TB":
                size = val * 1024 * 1024 * 1024 * 1024;
                break;
            case "GB":
                size = val * 1024 * 1024 * 1024;
                break;
            case "MB":
                size = val * 1024 * 1024;
                break;
            case "KB":
                size = val * 1024;
                break;
        }
        if (size !== undefined)
            size = Math.round(size);
    }
    return { quality, size, seeders };
}
/**
 * Build the full Stremio addon stream URL.
 *
 * Movies:  /{config}/stream/movie/{imdbId}.json
 * Series:  /{config}/stream/series/{imdbId}:{season}:{episode}.json
 */
function buildStremioUrl(baseUrl, configStr, type, imdbId, season, episode) {
    const base = baseUrl.replace(/\/+$/, "");
    const cfgSegment = configStr ? `/${configStr.replace(/^\/+/, "").replace(/\/+$/, "")}` : "";
    if (type === "series" && season !== undefined && episode !== undefined) {
        return `${base}${cfgSegment}/stream/series/${imdbId}:${season}:${episode}.json`;
    }
    return `${base}${cfgSegment}/stream/movie/${imdbId}.json`;
}
/**
 * Build a magnet URI from a 40-hex or 32-base32 info hash.
 */
function buildMagnetFromHash(hash, title) {
    const trimmed = hash.trim();
    const hex40 = /^[a-fA-F0-9]{40}$/;
    const b32 = /^[A-Z2-7]{32,39}$/i;
    if (!hex40.test(trimmed) && !b32.test(trimmed))
        return undefined;
    const hashUpper = trimmed.toUpperCase();
    const dn = title ? `&dn=${encodeURIComponent(title)}` : "";
    return `magnet:?xt=urn:btih:${hashUpper}${dn}`;
}
/**
 * Convert an array of raw Stremio streams into normalised ScraperResults.
 */
function parseStremioStreams(streams, source) {
    const results = [];
    for (const s of streams) {
        const title = s.behaviorHints?.filename || s.title || s.name || "";
        const parsed = parseQualityFromName(s.name || "");
        let magnetUrl;
        let infoHash;
        if (s.infoHash) {
            infoHash = s.infoHash.toLowerCase();
            magnetUrl = buildMagnetFromHash(s.infoHash, title);
        }
        // If the addon only provides a direct URL (no hash), record it as magnetUrl
        // for downstream consumers that accept arbitrary URLs.
        if (!magnetUrl && s.url) {
            magnetUrl = s.url;
        }
        results.push({
            title,
            magnetUrl,
            infoHash,
            seeders: parsed.seeders,
            size: parsed.size,
            source,
        });
    }
    console.log(`[${new Date().toISOString()}][stremioScraper] parseStremioStreams`, { source, inputCount: streams.length, outputCount: results.length });
    return results;
}
