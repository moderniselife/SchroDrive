"use strict";
/**
 * SchroDrive — Jellyfin Media Server Integration
 *
 * Provides watchlist/favourites polling and library refresh for Jellyfin.
 * Jellyfin doesn't have a native "watchlist" — instead we poll the user's
 * favourites list which serves the same purpose.
 *
 * @module jellyfin
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJellyfinWatchlist = getJellyfinWatchlist;
exports.refreshJellyfinLibrary = refreshJellyfinLibrary;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
// =============================================================================
// Jellyfin API Client
// =============================================================================
/**
 * Fetches the current user's Jellyfin favourites (used as watchlist).
 *
 * Requires JELLYFIN_URL, JELLYFIN_API_KEY, and JELLYFIN_USER_ID.
 * Jellyfin uses favourites as its watchlist equivalent.
 *
 * @returns Array of watchlist items with title, year, type, and external IDs
 */
async function getJellyfinWatchlist() {
    const baseUrl = config_1.config.jellyfinUrl;
    const apiKey = config_1.config.jellyfinApiKey;
    const userId = config_1.config.jellyfinUserId;
    if (!baseUrl || !apiKey || !userId) {
        return [];
    }
    // Fetch both movies and series that are marked as favourites
    const url = `${baseUrl}/Users/${userId}/Items`;
    console.log(`[${new Date().toISOString()}][jellyfin] GET ${url} (favourites)`);
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
                "X-Emby-Authorization": `MediaBrowser Token="${apiKey}"`,
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
        console.log(`[${new Date().toISOString()}][jellyfin] Watchlist (favourites): ${mapped.length} items`);
        return mapped;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][jellyfin] Watchlist fetch failed:`, err?.message || String(err));
        return [];
    }
}
/**
 * Triggers a library scan on the Jellyfin server.
 *
 * Uses the POST /Library/Refresh endpoint to trigger a full scan.
 */
async function refreshJellyfinLibrary() {
    const baseUrl = config_1.config.jellyfinUrl;
    const apiKey = config_1.config.jellyfinApiKey;
    if (!baseUrl || !apiKey)
        return;
    const url = `${baseUrl}/Library/Refresh`;
    console.log(`[${new Date().toISOString()}][jellyfin] POST ${url}`);
    try {
        await axios_1.default.post(url, null, {
            headers: {
                "X-Emby-Authorization": `MediaBrowser Token="${apiKey}"`,
            },
            timeout: 10000,
        });
        console.log(`[${new Date().toISOString()}][jellyfin] Library refresh triggered`);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][jellyfin] Library refresh failed:`, err?.message || String(err));
    }
}
