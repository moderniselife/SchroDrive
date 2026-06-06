"use strict";
/**
 * SchroDrive — Emby Media Server Integration
 *
 * Provides watchlist/favourites polling and library refresh for Emby.
 * Emby's API is largely compatible with Jellyfin (they share a common ancestor),
 * but uses different auth headers and some endpoint differences.
 *
 * @module emby
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEmbyWatchlist = getEmbyWatchlist;
exports.refreshEmbyLibrary = refreshEmbyLibrary;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
// =============================================================================
// Emby API Client
// =============================================================================
/**
 * Fetches the current user's Emby favourites (used as watchlist).
 *
 * Requires EMBY_URL, EMBY_API_KEY, and EMBY_USER_ID.
 * Emby uses favourites as its watchlist equivalent.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
async function getEmbyWatchlist() {
    const baseUrl = config_1.config.embyUrl;
    const apiKey = config_1.config.embyApiKey;
    const userId = config_1.config.embyUserId;
    if (!baseUrl || !apiKey || !userId) {
        return [];
    }
    const url = `${baseUrl}/Users/${userId}/Items`;
    console.log(`[${new Date().toISOString()}][emby] GET ${url} (favourites)`);
    try {
        const res = await axios_1.default.get(url, {
            params: {
                IsFavorite: true,
                IncludeItemTypes: "Movie,Series",
                Recursive: true,
                Fields: "ProviderIds",
                SortBy: "DateCreated",
                SortOrder: "Descending",
                Limit: 100,
            },
            headers: {
                "X-Emby-Token": apiKey,
            },
            timeout: 15000,
        });
        const items = res.data?.Items || [];
        const mapped = items.map((item) => {
            const providerIds = item.ProviderIds || {};
            return {
                id: item.Id,
                title: item.Name,
                year: item.ProductionYear ?? undefined,
                type: item.Type === "Movie" ? "movie" : "show",
                tmdbId: providerIds.Tmdb ? Number(providerIds.Tmdb) : undefined,
                tvdbId: providerIds.Tvdb ? Number(providerIds.Tvdb) : undefined,
                imdbId: providerIds.Imdb || undefined,
            };
        });
        console.log(`[${new Date().toISOString()}][emby] Watchlist (favourites): ${mapped.length} items`);
        return mapped;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][emby] Watchlist fetch failed:`, err?.message || String(err));
        return [];
    }
}
/**
 * Triggers a library scan on the Emby server.
 *
 * Uses the POST /Library/Refresh endpoint to trigger a full scan.
 */
async function refreshEmbyLibrary() {
    const baseUrl = config_1.config.embyUrl;
    const apiKey = config_1.config.embyApiKey;
    if (!baseUrl || !apiKey)
        return;
    const url = `${baseUrl}/Library/Refresh`;
    console.log(`[${new Date().toISOString()}][emby] POST ${url}`);
    try {
        await axios_1.default.post(url, null, {
            headers: {
                "X-Emby-Token": apiKey,
            },
            timeout: 10000,
        });
        console.log(`[${new Date().toISOString()}][emby] Library refresh triggered`);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][emby] Library refresh failed:`, err?.message || String(err));
    }
}
