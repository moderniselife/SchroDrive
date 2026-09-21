"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripTmdbQuery = stripTmdbQuery;
exports.buildMagnetFromHash = buildMagnetFromHash;
exports.normaliseBaseUrl = normaliseBaseUrl;
function stripTmdbQuery(query) {
    const cleaned = String(query || "").slice(0, 200);
    return cleaned.replace(/\s*TMDB\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
}
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
function normaliseBaseUrl(baseUrl) {
    return baseUrl.replace(/\/+$/, "");
}
