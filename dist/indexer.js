"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectActiveProvider = detectActiveProvider;
exports.getActiveProvider = getActiveProvider;
exports.clearProviderCache = clearProviderCache;
exports.testIndexerConnection = testIndexerConnection;
exports.searchIndexer = searchIndexer;
exports.pickBestResult = pickBestResult;
exports.getMagnet = getMagnet;
exports.getMagnetOrResolve = getMagnetOrResolve;
exports.getProviderName = getProviderName;
exports.isIndexerConfigured = isIndexerConfigured;
const config_1 = require("./config");
const prowlarr_1 = require("./prowlarr");
const jackett_1 = require("./jackett");
let cachedProvider = null;
function isJackettConfigured() {
    return !!(config_1.config.jackettUrl && config_1.config.jackettApiKey);
}
function isProwlarrConfigured() {
    return !!(config_1.config.prowlarrUrl && config_1.config.prowlarrApiKey);
}
async function detectActiveProvider() {
    if (cachedProvider)
        return cachedProvider;
    const provider = config_1.config.indexerProvider;
    if (provider === "jackett") {
        if (isJackettConfigured()) {
            cachedProvider = "jackett";
            return "jackett";
        }
        console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=jackett but Jackett not configured`);
        return null;
    }
    if (provider === "prowlarr") {
        if (isProwlarrConfigured()) {
            cachedProvider = "prowlarr";
            return "prowlarr";
        }
        console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=prowlarr but Prowlarr not configured`);
        return null;
    }
    // Auto mode: try Jackett first (if configured), then Prowlarr
    if (isJackettConfigured()) {
        console.log(`[${new Date().toISOString()}][indexer] auto-detected Jackett as indexer provider`);
        cachedProvider = "jackett";
        return "jackett";
    }
    if (isProwlarrConfigured()) {
        console.log(`[${new Date().toISOString()}][indexer] auto-detected Prowlarr as indexer provider`);
        cachedProvider = "prowlarr";
        return "prowlarr";
    }
    console.warn(`[${new Date().toISOString()}][indexer] no indexer provider configured`);
    return null;
}
function getActiveProvider() {
    if (cachedProvider)
        return cachedProvider;
    const provider = config_1.config.indexerProvider;
    if (provider === "jackett" && isJackettConfigured()) {
        cachedProvider = "jackett";
        return "jackett";
    }
    if (provider === "prowlarr" && isProwlarrConfigured()) {
        cachedProvider = "prowlarr";
        return "prowlarr";
    }
    // Auto mode
    if (provider === "auto") {
        if (isJackettConfigured()) {
            cachedProvider = "jackett";
            return "jackett";
        }
        if (isProwlarrConfigured()) {
            cachedProvider = "prowlarr";
            return "prowlarr";
        }
    }
    return null;
}
function clearProviderCache() {
    cachedProvider = null;
}
async function testIndexerConnection() {
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.testJackettConnection)();
    }
    if (provider === "prowlarr") {
        return (0, prowlarr_1.testProwlarrConnection)();
    }
    console.warn(`[${new Date().toISOString()}][indexer] no provider configured for connection test`);
    return false;
}
async function searchIndexer(query, opts) {
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.searchJackett)(query, opts);
    }
    if (provider === "prowlarr") {
        return (0, prowlarr_1.searchProwlarr)(query, opts);
    }
    throw new Error("No indexer provider configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
}
function pickBestResult(results) {
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.pickBestResult)(results);
    }
    // Default to Prowlarr logic (works for both since structures are similar)
    return (0, prowlarr_1.pickBestResult)(results);
}
function getMagnet(r) {
    if (!r)
        return undefined;
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.getMagnet)(r);
    }
    return (0, prowlarr_1.getMagnet)(r);
}
async function getMagnetOrResolve(r) {
    if (!r)
        return undefined;
    const provider = getActiveProvider();
    if (provider === "jackett") {
        return (0, jackett_1.getMagnetOrResolve)(r);
    }
    return (0, prowlarr_1.getMagnetOrResolve)(r);
}
function getProviderName() {
    const provider = getActiveProvider();
    return provider || "none";
}
function isIndexerConfigured() {
    return isJackettConfigured() || isProwlarrConfigured();
}
