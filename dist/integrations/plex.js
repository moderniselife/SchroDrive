"use strict";
/**
 * SchroDrive — Plex Media Server Integration
 *
 * Provides watchlist polling and library refresh for Plex Media Server.
 * Polls the user's Plex watchlist at a configurable interval and triggers
 * torrent searches for new items via the indexer (Prowlarr/Jackett).
 *
 * @module plex
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPlexWatchlist = getPlexWatchlist;
exports.getPlexLibrarySections = getPlexLibrarySections;
exports.refreshPlexLibrary = refreshPlexLibrary;
exports.extractTmdbId = extractTmdbId;
exports.extractTvdbId = extractTvdbId;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
// =============================================================================
// Plex API Client
// =============================================================================
const PLEX_DISCOVER_URL = "https://discover.provider.plex.tv";
/**
 * Fetches the current user's Plex watchlist.
 *
 * Uses the Plex Discover API at discover.provider.plex.tv which
 * requires a valid Plex authentication token.
 *
 * @returns Array of watchlist items with title, year, type, and GUID info
 */
async function getPlexWatchlist() {
    const token = config_1.config.plexToken;
    if (!token) {
        console.warn(`[${new Date().toISOString()}][plex] No PLEX_TOKEN configured — skipping watchlist fetch`);
        return [];
    }
    const url = `${PLEX_DISCOVER_URL}/library/sections/watchlist/all`;
    console.log(`[${new Date().toISOString()}][plex] GET ${url}`);
    try {
        const res = await axios_1.default.get(url, {
            headers: {
                "X-Plex-Token": token,
                "X-Plex-Client-Identifier": "schrodrive",
                "X-Plex-Product": "SchroDrive",
                "X-Plex-Version": "0.2.0",
                Accept: "application/json",
            },
            timeout: 15000,
        });
        const items = res.data?.MediaContainer?.Metadata || [];
        const mapped = items.map((item) => ({
            ratingKey: item.ratingKey,
            title: item.title,
            year: item.year ?? undefined,
            type: item.type === "movie" ? "movie" : "show",
            guid: item.guid,
            guids: item.Guid || [],
            thumb: item.thumb,
        }));
        console.log(`[${new Date().toISOString()}][plex] Watchlist: ${mapped.length} items`);
        return mapped;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][plex] Watchlist fetch failed:`, err?.message || String(err));
        return [];
    }
}
/**
 * Lists all library sections from the configured Plex server.
 *
 * @returns Array of library sections with key, title, and type
 */
async function getPlexLibrarySections() {
    const plexUrl = config_1.config.plexUrl;
    const token = config_1.config.plexToken;
    if (!plexUrl || !token)
        return [];
    const url = `${plexUrl}/library/sections`;
    console.log(`[${new Date().toISOString()}][plex] GET ${url}`);
    try {
        const res = await axios_1.default.get(url, {
            headers: {
                "X-Plex-Token": token,
                Accept: "application/json",
            },
            timeout: 10000,
        });
        const sections = res.data?.MediaContainer?.Directory || [];
        return sections.map((s) => ({
            key: s.key,
            title: s.title,
            type: s.type,
        }));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][plex] Library sections fetch failed:`, err?.message || String(err));
        return [];
    }
}
/**
 * Triggers a library scan/refresh on the Plex server.
 *
 * If a section key is provided, only that section is refreshed.
 * Otherwise, all sections are refreshed.
 *
 * @param sectionKey - Optional specific library section to refresh
 */
async function refreshPlexLibrary(sectionKey) {
    const plexUrl = config_1.config.plexUrl;
    const token = config_1.config.plexToken;
    if (!plexUrl || !token)
        return;
    const sections = sectionKey
        ? [{ key: sectionKey }]
        : await getPlexLibrarySections();
    for (const section of sections) {
        const url = `${plexUrl}/library/sections/${section.key}/refresh`;
        console.log(`[${new Date().toISOString()}][plex] POST ${url}`);
        try {
            await axios_1.default.get(url, {
                headers: { "X-Plex-Token": token },
                timeout: 10000,
            });
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][plex] Refresh failed for section ${section.key}:`, err?.message || String(err));
        }
    }
}
/**
 * Extracts a TMDB ID from Plex GUID strings.
 *
 * Plex provides GUIDs like 'tmdb://12345' or 'com.plexapp.agents.themoviedb://12345'.
 *
 * @param item - Plex watchlist item with guid/guids fields
 * @returns TMDB ID as a number, or undefined if not found
 */
function extractTmdbId(item) {
    // Check the main guid field
    const tmdbMatch = item.guid?.match(/tmdb:\/\/(\d+)/);
    if (tmdbMatch)
        return Number(tmdbMatch[1]);
    // Check alternative guids array
    for (const g of item.guids || []) {
        const match = g.id?.match(/tmdb:\/\/(\d+)/);
        if (match)
            return Number(match[1]);
    }
    return undefined;
}
/**
 * Extracts a TVDB ID from Plex GUID strings.
 *
 * @param item - Plex watchlist item with guid/guids fields
 * @returns TVDB ID as a number, or undefined if not found
 */
function extractTvdbId(item) {
    const tvdbMatch = item.guid?.match(/tvdb:\/\/(\d+)/);
    if (tvdbMatch)
        return Number(tvdbMatch[1]);
    for (const g of item.guids || []) {
        const match = g.id?.match(/tvdb:\/\/(\d+)/);
        if (match)
            return Number(match[1]);
    }
    return undefined;
}
