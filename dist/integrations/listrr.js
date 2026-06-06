"use strict";
/**
 * SchroDrive — Listrr Watchlist Integration
 *
 * Provides watchlist polling from listrr.pro. Fetches the user's movie and
 * show lists via the Listrr API and normalises items into a unified format.
 *
 * @module listrr
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getListrrWatchlist = getListrrWatchlist;
exports.isListrrConfigured = isListrrConfigured;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
// =============================================================================
// Listrr API Client
// =============================================================================
const LISTRR_BASE_URL = "https://listrr.pro/api";
/**
 * Builds the common headers required by the Listrr API.
 *
 * @returns Headers object for Listrr API requests
 */
function buildHeaders() {
    return {
        "X-Api-Key": config_1.config.listrrApiKey,
        "Content-Type": "application/json",
    };
}
/**
 * Fetches all items from a Listrr endpoint and maps them to our
 * normalised watchlist item shape.
 *
 * @param endpoint - API endpoint path (e.g. '/List/Movie')
 * @param mediaType - The media type to assign: 'movie' or 'show'
 * @returns Array of normalised ListrrWatchlistItem entries
 */
async function fetchListItems(endpoint, mediaType) {
    const url = `${LISTRR_BASE_URL}${endpoint}`;
    console.log(`[${new Date().toISOString()}][listrr] GET ${url}`);
    const res = await axios_1.default.get(url, {
        headers: buildHeaders(),
        timeout: 15000,
    });
    const lists = Array.isArray(res.data) ? res.data : [];
    const results = [];
    const seenIds = new Set();
    for (const list of lists) {
        const items = Array.isArray(list.items) ? list.items : [];
        for (const item of items) {
            const tmdbId = item.theMovieDbId ?? undefined;
            const id = tmdbId != null ? String(tmdbId) : String(item.id || "");
            if (seenIds.has(id))
                continue;
            seenIds.add(id);
            results.push({
                id,
                title: item.title || "",
                year: item.year ?? undefined,
                type: mediaType,
                tmdbId: tmdbId != null ? Number(tmdbId) : undefined,
            });
        }
    }
    return results;
}
/**
 * Fetches the user's Listrr watchlist items (movies and shows).
 *
 * Queries both the movie and show list endpoints and merges the results.
 *
 * @returns Array of watchlist items with title, year, type, and TMDB ID
 */
async function getListrrWatchlist() {
    if (!isListrrConfigured()) {
        console.warn(`[${new Date().toISOString()}][listrr] Not configured — skipping watchlist fetch (need LISTRR_API_KEY)`);
        return [];
    }
    const results = [];
    // Fetch movies
    try {
        const movies = await fetchListItems("/List/Movie", "movie");
        results.push(...movies);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][listrr] Movie list fetch failed:`, err?.message || String(err));
    }
    // Fetch shows
    try {
        const shows = await fetchListItems("/List/Show", "show");
        results.push(...shows);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][listrr] Show list fetch failed:`, err?.message || String(err));
    }
    console.log(`[${new Date().toISOString()}][listrr] Watchlist: ${results.length} items`);
    return results;
}
/**
 * Checks whether Listrr integration is configured.
 *
 * Requires listrrApiKey to be set.
 *
 * @returns true if Listrr can be used
 */
function isListrrConfigured() {
    return Boolean(config_1.config.listrrApiKey);
}
