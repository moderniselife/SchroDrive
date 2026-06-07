"use strict";
/**
 * SchroDrive — Cloud Link Manager WebDAV Bridge
 *
 * A WebDAV server that exposes public shared folder links (Mega, Google Drive,
 * Dropbox) as a virtual filesystem. rclone mounts this bridge to make cloud
 * link content appear alongside debrid mounts.
 *
 * Architecture:
 * - Reads cloud link config from JSON file or env var
 * - Creates adapters for each configured link
 * - Exposes a WebDAV endpoint that rclone can mount
 * - For GDrive/Dropbox: 302 redirects to direct download URLs
 * - For MEGA: Proxies the decrypted stream (uses server bandwidth)
 *
 * Directory structure:
 *   /mega/Australian.Survivor/Season 01/S01E01.mkv
 *   /gdrive/Shared.Collection/file.mp4
 *   /dropbox/Team.Media/video.mkv
 *
 * @module cloudLinks/bridge
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCloudLinksBridge = startCloudLinksBridge;
exports.stopCloudLinksBridge = stopCloudLinksBridge;
const express_1 = __importDefault(require("express"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../../core/config");
const megaAdapter_1 = require("./megaAdapter");
const gdriveAdapter_1 = require("./gdriveAdapter");
const dropboxAdapter_1 = require("./dropboxAdapter");
const httpAdapter_1 = require("./httpAdapter");
// ===========================================================================
// Constants
// ===========================================================================
const LOG_PREFIX = '[cloud-links]';
/** Cache entry is considered fresh for 5 minutes — served without revalidation (dynamic providers). */
const PROPFIND_FRESH_TTL_MS = 5 * 60 * 1000;
/** Cache entry is considered stale after 1 hour — must be refetched (dynamic providers). */
const PROPFIND_STALE_TTL_MS = 60 * 60 * 1000;
/** HTTP open directories are insanely static — 12-hour fresh TTL. */
const PROPFIND_HTTP_FRESH_TTL_MS = 12 * 60 * 60 * 1000;
/** HTTP open directories — 7-day stale TTL before a hard refetch is required. */
const PROPFIND_HTTP_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Background re-crawl interval to keep the cache warm (6 hours). */
const RECRAWL_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Maximum concurrent adapter.listFolder() calls during pre-warm. */
const PREWARM_CONCURRENCY = 3;
/** Maximum directory depth for pre-warm traversal (root → show → season). */
const PREWARM_MAX_DEPTH = 3;
/**
 * Maximum total entries allowed in a Depth: infinity PROPFIND response.
 * Prevents OOM when a directory tree is massive (e.g. 50k+ files).
 */
const DEPTH_INFINITY_MAX_ENTRIES = 5000;
/**
 * Returns the appropriate fresh/stale TTLs for a given provider type.
 * HTTP directories are extremely static so they get much longer cache windows.
 */
function getTtlsForProvider(provider) {
    if (provider === 'http') {
        return { freshMs: PROPFIND_HTTP_FRESH_TTL_MS, staleMs: PROPFIND_HTTP_STALE_TTL_MS };
    }
    return { freshMs: PROPFIND_FRESH_TTL_MS, staleMs: PROPFIND_STALE_TTL_MS };
}
// ===========================================================================
// Configuration Loading
// ===========================================================================
/**
 * Loads cloud link configurations from JSON file and/or env var.
 * File takes priority; env var is merged in (deduped by URL).
 *
 * @returns Array of validated cloud link configs.
 */
function loadCloudLinks() {
    const links = [];
    const seenUrls = new Set();
    // 1. Try JSON file first
    const configFile = config_1.config.cloudLinksFile;
    if (configFile && fs_1.default.existsSync(configFile)) {
        try {
            const raw = fs_1.default.readFileSync(configFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (isValidCloudLink(item) && !seenUrls.has(item.url)) {
                        links.push(item);
                        seenUrls.add(item.url);
                    }
                }
                console.log(`${LOG_PREFIX} Loaded ${links.length} cloud link(s) from ${configFile}`);
            }
        }
        catch (err) {
            console.error(`${LOG_PREFIX} Failed to parse cloud links file ${configFile}: ${err?.message}`);
        }
    }
    // 2. Merge in env var (CLOUD_LINKS JSON)
    const envJson = config_1.config.cloudLinksJson;
    if (envJson) {
        try {
            const parsed = JSON.parse(envJson);
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    if (isValidCloudLink(item) && !seenUrls.has(item.url)) {
                        links.push(item);
                        seenUrls.add(item.url);
                    }
                }
                console.log(`${LOG_PREFIX} Merged ${links.length} total cloud link(s) (incl. env var)`);
            }
        }
        catch (err) {
            console.error(`${LOG_PREFIX} Failed to parse CLOUD_LINKS env var: ${err?.message}`);
        }
    }
    return links;
}
/**
 * Validates that a config object has the required fields.
 */
function isValidCloudLink(item) {
    return (item &&
        typeof item.type === 'string' &&
        ['mega', 'gdrive', 'dropbox', 'http'].includes(item.type) &&
        typeof item.url === 'string' &&
        item.url.length > 0 &&
        typeof item.name === 'string' &&
        item.name.length > 0);
}
// ===========================================================================
// Adapter Factory
// ===========================================================================
/**
 * Creates the appropriate adapter for a cloud link config.
 * Returns null if the required credentials are missing.
 */
function createAdapter(link) {
    switch (link.type) {
        case 'mega':
            return new megaAdapter_1.MegaAdapter(link.url, link.name);
        case 'gdrive':
            if (!config_1.config.gdriveApiKey) {
                console.warn(`${LOG_PREFIX} Skipping GDrive link "${link.name}" — GDRIVE_API_KEY not set`);
                return null;
            }
            return new gdriveAdapter_1.GDriveAdapter(link.url, link.name, config_1.config.gdriveApiKey);
        case 'dropbox':
            if (!config_1.config.dropboxToken) {
                console.warn(`${LOG_PREFIX} Skipping Dropbox link "${link.name}" — DROPBOX_TOKEN not set`);
                return null;
            }
            return new dropboxAdapter_1.DropboxAdapter(link.url, link.name, config_1.config.dropboxToken);
        case 'http':
            return new httpAdapter_1.HttpAdapter(link.url, link.name, link.headers, link.rateLimitMs);
        default:
            console.warn(`${LOG_PREFIX} Unknown cloud link type: ${link.type}`);
            return null;
    }
}
// ===========================================================================
// State
// ===========================================================================
/** Active adapters grouped by provider type. */
const adaptersByProvider = new Map();
/** HTTP server instance. */
let server = null;
/** Handle for the periodic re-crawl timer so we can cancel on shutdown. */
let recrawlTimer = null;
/** In-memory cache mapping request path → rendered PROPFIND response. */
const propfindCache = new Map();
/** Paths currently undergoing a background refresh — prevents duplicate refreshes. */
const refreshingPaths = new Set();
/**
 * Triggers a background (fire-and-forget) refresh of a single cache entry.
 * Deduplicated via `refreshingPaths` — concurrent calls for the same path
 * are silently dropped.
 */
function backgroundRefresh(cacheKey, adapter, subPath, providerType, linkName, basePath) {
    if (refreshingPaths.has(cacheKey))
        return;
    refreshingPaths.add(cacheKey);
    console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Background refresh started for ${cacheKey}`);
    adapter
        .listFolder(subPath)
        .then((files) => {
        const entries = files.map((f) => ({
            href: `${basePath}/${f.name}`,
            isDirectory: f.isDirectory,
            size: f.size,
            name: f.name,
        }));
        const xml = generatePropfindResponse(basePath, entries);
        propfindCache.set(cacheKey, { xml, files, fetchedAt: Date.now() });
        console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Background refresh complete for ${cacheKey} (${files.length} entries)`);
    })
        .catch((err) => {
        console.error(`[${new Date().toISOString()}]${LOG_PREFIX} Background refresh failed for ${cacheKey}: ${err?.message}`);
    })
        .finally(() => {
        refreshingPaths.delete(cacheKey);
    });
}
/**
 * Looks up cached CloudFile[] for a given adapter path.
 * Returns the cached file array if the entry exists and is not expired
 * (within the stale TTL for the provider). Returns null otherwise.
 */
function getCachedFiles(cacheKey) {
    const entry = propfindCache.get(cacheKey);
    if (!entry)
        return null;
    // Derive provider from the cache key (first path segment)
    const provider = cacheKey.split('/').filter(Boolean)[0] || '';
    const { staleMs } = getTtlsForProvider(provider);
    const age = Date.now() - entry.fetchedAt;
    if (age > staleMs)
        return null;
    return entry.files;
}
// ===========================================================================
// WebDAV Response Helpers
// ===========================================================================
/**
 * Generates a WebDAV PROPFIND multistatus response for a directory listing.
 */
function generatePropfindResponse(requestPath, entries) {
    const lines = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<D:multistatus xmlns:D="DAV:">',
    ];
    // Add the directory itself
    lines.push(`  <D:response>`);
    lines.push(`    <D:href>${encodeURI(requestPath.endsWith('/') ? requestPath : requestPath + '/')}</D:href>`);
    lines.push(`    <D:propstat>`);
    lines.push(`      <D:prop>`);
    lines.push(`        <D:resourcetype><D:collection/></D:resourcetype>`);
    lines.push(`        <D:displayname>${escapeXml(requestPath.split('/').filter(Boolean).pop() || 'root')}</D:displayname>`);
    lines.push(`      </D:prop>`);
    lines.push(`      <D:status>HTTP/1.1 200 OK</D:status>`);
    lines.push(`    </D:propstat>`);
    lines.push(`  </D:response>`);
    // Add children
    for (const entry of entries) {
        const href = entry.href.endsWith('/') || !entry.isDirectory
            ? entry.href
            : entry.href + '/';
        lines.push(`  <D:response>`);
        lines.push(`    <D:href>${encodeURI(href)}</D:href>`);
        lines.push(`    <D:propstat>`);
        lines.push(`      <D:prop>`);
        if (entry.isDirectory) {
            lines.push(`        <D:resourcetype><D:collection/></D:resourcetype>`);
        }
        else {
            lines.push(`        <D:resourcetype/>`);
            lines.push(`        <D:getcontentlength>${entry.size}</D:getcontentlength>`);
        }
        lines.push(`        <D:displayname>${escapeXml(entry.name)}</D:displayname>`);
        lines.push(`      </D:prop>`);
        lines.push(`      <D:status>HTTP/1.1 200 OK</D:status>`);
        lines.push(`    </D:propstat>`);
        lines.push(`  </D:response>`);
    }
    lines.push('</D:multistatus>');
    return lines.join('\n');
}
function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
// ===========================================================================
// Request Handlers
// ===========================================================================
/**
 * Handles OPTIONS requests (WebDAV capability discovery).
 */
function handleOptions(_req, res) {
    res.setHeader('Allow', 'OPTIONS, PROPFIND, GET, HEAD');
    res.setHeader('DAV', '1, 2');
    res.status(200).end();
}
/**
 * Handles PROPFIND requests (directory listings).
 *
 * Path structure:
 * /          → lists provider types (mega/, gdrive/, dropbox/)
 * /mega/     → lists configured MEGA folder links
 * /mega/Name/ → lists files in that folder
 * /mega/Name/Sub/ → lists files in subfolder
 *
 * Supports Depth: 0, 1 (default), and infinity.
 * Depth: infinity recursively includes all descendants, capped at
 * DEPTH_INFINITY_MAX_ENTRIES to prevent OOM on massive trees.
 */
async function handlePropfind(req, res) {
    const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
    const segments = reqPath.split('/').filter(Boolean);
    const depthHeader = (req.headers['depth'] || '1').toLowerCase();
    try {
        // Root: list provider types
        if (segments.length === 0) {
            const entries = [];
            for (const providerType of adaptersByProvider.keys()) {
                entries.push({
                    href: `/${providerType}/`,
                    isDirectory: true,
                    size: 0,
                    name: providerType,
                });
            }
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.status(207).send(generatePropfindResponse('/', entries));
            return;
        }
        const providerType = segments[0];
        const providerMap = adaptersByProvider.get(providerType);
        if (!providerMap) {
            res.status(404).end();
            return;
        }
        // Provider level: list configured links
        if (segments.length === 1) {
            const entries = [];
            for (const [name] of providerMap) {
                entries.push({
                    href: `/${providerType}/${name}/`,
                    isDirectory: true,
                    size: 0,
                    name,
                });
            }
            res.setHeader('Content-Type', 'application/xml; charset=utf-8');
            res.status(207).send(generatePropfindResponse(`/${providerType}`, entries));
            return;
        }
        // Link level: list files in the shared folder
        const linkName = segments[1];
        const adapter = providerMap.get(linkName);
        if (!adapter) {
            res.status(404).end();
            return;
        }
        const subPath = segments.slice(2).join('/');
        const basePath = `/${providerType}/${linkName}${subPath ? '/' + subPath : ''}`;
        const cacheKey = reqPath;
        const now = Date.now();
        // ----- Depth: infinity handling -----
        // Recursively collect all descendants into a single multistatus response.
        // Falls back to depth-1 if the tree exceeds DEPTH_INFINITY_MAX_ENTRIES.
        if (depthHeader === 'infinity') {
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} PROPFIND Depth:infinity requested for ${cacheKey}`);
            const allEntries = [];
            let aborted = false;
            /**
             * Recursively collects entries for the Depth: infinity response.
             * Fetches from the PROPFIND cache where possible, otherwise calls the adapter.
             */
            async function collectRecursive(currentSubPath, currentBasePath) {
                if (aborted)
                    return;
                const currentCacheKey = `/${providerType}/${linkName}${currentSubPath ? '/' + currentSubPath : ''}`;
                let files;
                // Prefer cached data; fall back to a live adapter call
                const cachedEntry = propfindCache.get(currentCacheKey);
                if (cachedEntry) {
                    files = cachedEntry.files;
                }
                else {
                    files = await adapter.listFolder(currentSubPath || undefined);
                    // Populate the cache while we're at it
                    const entryItems = files.map((f) => ({
                        href: `${currentBasePath}/${f.name}`,
                        isDirectory: f.isDirectory,
                        size: f.size,
                        name: f.name,
                    }));
                    const entryXml = generatePropfindResponse(currentBasePath, entryItems);
                    propfindCache.set(currentCacheKey, { xml: entryXml, files, fetchedAt: Date.now() });
                }
                for (const f of files) {
                    if (aborted)
                        return;
                    if (allEntries.length >= DEPTH_INFINITY_MAX_ENTRIES) {
                        aborted = true;
                        return;
                    }
                    allEntries.push({
                        href: `${currentBasePath}/${f.name}`,
                        isDirectory: f.isDirectory,
                        size: f.size,
                        name: f.name,
                    });
                    // Recurse into subdirectories
                    if (f.isDirectory) {
                        const childSubPath = currentSubPath ? `${currentSubPath}/${f.name}` : f.name;
                        const childBasePath = `${currentBasePath}/${f.name}`;
                        await collectRecursive(childSubPath, childBasePath);
                    }
                }
            }
            await collectRecursive(subPath, basePath);
            if (aborted) {
                // Too many entries — fall back to a standard depth-1 response
                console.warn(`[${new Date().toISOString()}]${LOG_PREFIX} Depth:infinity exceeded ${DEPTH_INFINITY_MAX_ENTRIES} entries ` +
                    `for ${cacheKey}, falling back to depth-1`);
                // Fall through to the normal depth-1 logic below
            }
            else {
                console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Depth:infinity response for ${cacheKey}: ${allEntries.length} entries`);
                const xml = generatePropfindResponse(basePath, allEntries);
                res.setHeader('Content-Type', 'application/xml; charset=utf-8');
                res.status(207).send(xml);
                return;
            }
        }
        // ----- Standard depth-0 / depth-1 cache lookup -----
        const cached = propfindCache.get(cacheKey);
        if (cached) {
            const age = now - cached.fetchedAt;
            const { freshMs, staleMs } = getTtlsForProvider(providerType);
            if (age < freshMs) {
                // Fresh — serve straight from cache, no adapter call
                console.log(`[${new Date().toISOString()}]${LOG_PREFIX} PROPFIND cache HIT (fresh) for ${cacheKey}`);
                res.setHeader('Content-Type', 'application/xml; charset=utf-8');
                res.status(207).send(cached.xml);
                return;
            }
            if (age < staleMs) {
                // Stale-while-revalidate — serve cached XML, kick off background refresh
                console.log(`[${new Date().toISOString()}]${LOG_PREFIX} PROPFIND cache HIT (stale, revalidating) for ${cacheKey}`);
                backgroundRefresh(cacheKey, adapter, subPath || undefined, providerType, linkName, basePath);
                res.setHeader('Content-Type', 'application/xml; charset=utf-8');
                res.status(207).send(cached.xml);
                return;
            }
            // Expired — fall through to fresh fetch below
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} PROPFIND cache EXPIRED for ${cacheKey}`);
        }
        else {
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} PROPFIND cache MISS for ${cacheKey}`);
        }
        // ----- Fresh fetch from adapter -----
        const files = await adapter.listFolder(subPath || undefined);
        const entries = files.map((f) => ({
            href: `${basePath}/${f.name}`,
            isDirectory: f.isDirectory,
            size: f.size,
            name: f.name,
        }));
        const xml = generatePropfindResponse(basePath, entries);
        propfindCache.set(cacheKey, { xml, files, fetchedAt: Date.now() });
        res.setHeader('Content-Type', 'application/xml; charset=utf-8');
        res.status(207).send(xml);
    }
    catch (err) {
        console.error(`${LOG_PREFIX} PROPFIND error for ${reqPath}: ${err?.message}`);
        res.status(500).send('Internal server error');
    }
}
/**
 * Handles GET requests (file downloads / stream proxying).
 *
 * - For GDrive/Dropbox: 302 redirect to direct download URL
 * - For MEGA: Proxy the decrypted stream
 */
async function handleGet(req, res) {
    const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
    const segments = reqPath.split('/').filter(Boolean);
    if (segments.length < 3) {
        res.status(404).end();
        return;
    }
    const providerType = segments[0];
    const linkName = segments[1];
    const filePath = segments.slice(2).join('/');
    const providerMap = adaptersByProvider.get(providerType);
    const adapter = providerMap?.get(linkName);
    if (!adapter) {
        res.status(404).end();
        return;
    }
    try {
        // Find the file in the parent directory listing — try the cache first
        const parentPath = segments.slice(2, -1).join('/');
        const fileName = segments[segments.length - 1];
        const parentCacheKey = `/${providerType}/${linkName}${parentPath ? '/' + parentPath : ''}`;
        let parentFiles = getCachedFiles(parentCacheKey);
        if (parentFiles) {
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} GET parent-listing cache HIT for ${parentCacheKey}`);
        }
        else {
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} GET parent-listing cache MISS for ${parentCacheKey}`);
            parentFiles = await adapter.listFolder(parentPath || undefined);
        }
        const file = parentFiles.find((f) => f.name === fileName);
        if (!file) {
            res.status(404).end();
            return;
        }
        if (file.isDirectory) {
            res.status(404).end();
            return;
        }
        // Try direct URL first (GDrive, Dropbox)
        if (adapter.getDirectUrl) {
            const directUrl = await adapter.getDirectUrl(file.id);
            if (directUrl) {
                console.log(`${LOG_PREFIX}[${providerType}] GET ${filePath} → 302 redirect`);
                res.redirect(302, directUrl);
                return;
            }
        }
        // Fall back to stream proxying (MEGA)
        console.log(`${LOG_PREFIX}[${providerType}] GET ${filePath} → stream proxy (${file.size} bytes)`);
        const stream = await adapter.getStream(file.id);
        res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
        if (file.size > 0) {
            res.setHeader('Content-Length', String(file.size));
        }
        res.setHeader('Accept-Ranges', 'none');
        // Pipe the stream to the response
        stream.pipe(res);
        stream.on('error', (err) => {
            console.error(`${LOG_PREFIX}[${providerType}] Stream error for ${filePath}: ${err?.message}`);
            if (!res.headersSent) {
                const errorVideoPath = path_1.default.resolve(__dirname, '../../../assets/not_found.mp4');
                if (fs_1.default.existsSync(errorVideoPath)) {
                    res.setHeader('Content-Type', 'video/mp4');
                    fs_1.default.createReadStream(errorVideoPath).pipe(res);
                }
                else {
                    res.status(503).send('Stream error');
                }
            }
        });
    }
    catch (err) {
        console.error(`${LOG_PREFIX}[${providerType}] GET error for ${filePath}: ${err?.message}`);
        if (!res.headersSent) {
            res.status(500).send('Failed to fetch file');
        }
    }
}
/**
 * Handles HEAD requests (file metadata without body).
 */
async function handleHead(req, res) {
    const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
    const segments = reqPath.split('/').filter(Boolean);
    if (segments.length < 3) {
        res.status(404).end();
        return;
    }
    const providerType = segments[0];
    const linkName = segments[1];
    const providerMap = adaptersByProvider.get(providerType);
    const adapter = providerMap?.get(linkName);
    if (!adapter) {
        res.status(404).end();
        return;
    }
    try {
        const parentPath = segments.slice(2, -1).join('/');
        const fileName = segments[segments.length - 1];
        const parentCacheKey = `/${providerType}/${linkName}${parentPath ? '/' + parentPath : ''}`;
        let parentFiles = getCachedFiles(parentCacheKey);
        if (!parentFiles) {
            parentFiles = await adapter.listFolder(parentPath || undefined);
        }
        const file = parentFiles.find((f) => f.name === fileName);
        if (!file || file.isDirectory) {
            res.status(404).end();
            return;
        }
        res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
        if (file.size > 0) {
            res.setHeader('Content-Length', String(file.size));
        }
        res.status(200).end();
    }
    catch (err) {
        res.status(500).end();
    }
}
// ===========================================================================
// Pre-warm Cache (Plex Compatibility)
// ===========================================================================
/**
 * Recursive PROPFIND cache pre-warming for Plex/rclone compatibility.
 *
 * Plex performs recursive directory scans (PROPFIND depth-1 on every
 * subdirectory). For a large library, this means thousands of sequential
 * PROPFIND requests on the first scan. Even though HTTP adapters cache
 * their own folder data to disk, each uncached path still requires
 * building the PROPFIND XML response on first access.
 *
 * This function eagerly walks the directory tree for HTTP adapters
 * (which are static/rarely changing) and pre-builds the PROPFIND XML
 * cache. When Plex subsequently sends its flood of PROPFINDs, every
 * single one is an instant cache hit.
 *
 * Only HTTP adapters are pre-warmed — MEGA/GDrive/Dropbox are dynamic
 * and their listings change frequently enough that pre-warming would
 * be wasteful (and MEGA has API rate limits).
 *
 * Concurrency is capped at PREWARM_CONCURRENCY (3) to avoid saturating
 * the event loop. Traversal depth is limited to PREWARM_MAX_DEPTH (3)
 * which covers root → show → season — exactly what Plex needs.
 */
async function preWarmCache() {
    const startTime = Date.now();
    const httpAdapters = adaptersByProvider.get('http');
    if (!httpAdapters || httpAdapters.size === 0) {
        console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm: no HTTP adapters configured, skipping`);
        return;
    }
    console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm: starting for ${httpAdapters.size} HTTP adapter(s) ` +
        `(concurrency=${PREWARM_CONCURRENCY}, maxDepth=${PREWARM_MAX_DEPTH})`);
    // Simple semaphore for concurrency control
    let activeCount = 0;
    const waiting = [];
    async function acquireSemaphore() {
        if (activeCount < PREWARM_CONCURRENCY) {
            activeCount++;
            return;
        }
        // Wait until a slot opens up
        return new Promise((resolve) => {
            waiting.push(() => {
                activeCount++;
                resolve();
            });
        });
    }
    function releaseSemaphore() {
        activeCount--;
        if (waiting.length > 0) {
            const next = waiting.shift();
            next();
        }
    }
    let totalCached = 0;
    let totalSkipped = 0;
    /**
     * Recursively walks a single adapter's directory tree, building
     * PROPFIND cache entries for each directory encountered.
     */
    async function walkAdapter(adapter, linkName, subPath, depth) {
        if (depth > PREWARM_MAX_DEPTH)
            return;
        const cacheKey = `/http/${linkName}${subPath ? '/' + subPath : ''}`;
        const basePath = cacheKey;
        // Check if this path already has a fresh PROPFIND cache entry
        const existing = propfindCache.get(cacheKey);
        if (existing) {
            const { freshMs } = getTtlsForProvider('http');
            const age = Date.now() - existing.fetchedAt;
            if (age < freshMs) {
                // Already fresh — still need to recurse into subdirectories
                // using the cached file list (no adapter call needed)
                totalSkipped++;
                const subdirs = existing.files.filter((f) => f.isDirectory);
                const tasks = [];
                for (const dir of subdirs) {
                    const childSubPath = subPath ? `${subPath}/${dir.name}` : dir.name;
                    tasks.push(walkAdapter(adapter, linkName, childSubPath, depth + 1));
                }
                await Promise.all(tasks);
                return;
            }
        }
        // Acquire a concurrency slot before calling the adapter
        await acquireSemaphore();
        let files;
        try {
            files = await adapter.listFolder(subPath || undefined);
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm: failed to list ${cacheKey}: ${err?.message}`);
            releaseSemaphore();
            return;
        }
        releaseSemaphore();
        // Build and cache the PROPFIND XML for this directory
        const entries = files.map((f) => ({
            href: `${basePath}/${f.name}`,
            isDirectory: f.isDirectory,
            size: f.size,
            name: f.name,
        }));
        const xml = generatePropfindResponse(basePath, entries);
        propfindCache.set(cacheKey, { xml, files, fetchedAt: Date.now() });
        totalCached++;
        // Log progress periodically
        if (totalCached % 100 === 0) {
            console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm progress: ${totalCached} cached, ${totalSkipped} skipped`);
        }
        // Recurse into subdirectories
        const subdirs = files.filter((f) => f.isDirectory);
        const tasks = [];
        for (const dir of subdirs) {
            const childSubPath = subPath ? `${subPath}/${dir.name}` : dir.name;
            tasks.push(walkAdapter(adapter, linkName, childSubPath, depth + 1));
        }
        await Promise.all(tasks);
    }
    // Walk each HTTP adapter's tree
    for (const [linkName, adapter] of httpAdapters) {
        console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm: walking http/${linkName}...`);
        try {
            await walkAdapter(adapter, linkName, '', 0);
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm: error walking http/${linkName}: ${err?.message}`);
        }
    }
    const elapsedMs = Date.now() - startTime;
    const elapsedSec = (elapsedMs / 1000).toFixed(1);
    console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm complete: ${totalCached} paths cached, ` +
        `${totalSkipped} skipped (already fresh). Total time: ${elapsedSec}s`);
}
// ===========================================================================
// Public API
// ===========================================================================
/**
 * Starts the Cloud Links WebDAV bridge server.
 *
 * @returns Promise that resolves when the server is listening.
 */
async function startCloudLinksBridge() {
    const links = loadCloudLinks();
    if (links.length === 0) {
        console.log(`${LOG_PREFIX} No cloud links configured — bridge not started`);
        return;
    }
    console.log(`${LOG_PREFIX} Initialising ${links.length} cloud link adapter(s)...`);
    // Create and initialise adapters
    for (const link of links) {
        try {
            const adapter = createAdapter(link);
            if (!adapter)
                continue;
            await adapter.init();
            if (!adaptersByProvider.has(link.type)) {
                adaptersByProvider.set(link.type, new Map());
            }
            adaptersByProvider.get(link.type).set(link.name, adapter);
            console.log(`${LOG_PREFIX} ✅ ${link.type}/${link.name} — ready`);
        }
        catch (err) {
            console.error(`${LOG_PREFIX} ❌ Failed to initialise ${link.type}/${link.name}: ${err?.message}`);
        }
    }
    if (adaptersByProvider.size === 0) {
        console.warn(`${LOG_PREFIX} No adapters initialised successfully — bridge not started`);
        return;
    }
    // Create Express app
    const app = (0, express_1.default)();
    // Health check
    app.get('/health', (_req, res) => {
        const providers = {};
        for (const [type, adapters] of adaptersByProvider) {
            providers[type] = [...adapters.keys()];
        }
        res.json({ status: 'ok', service: 'cloud-links', providers });
    });
    // WebDAV methods
    app.use((req, res, next) => {
        switch (req.method) {
            case 'OPTIONS':
                handleOptions(req, res);
                break;
            case 'PROPFIND':
                handlePropfind(req, res).catch(next);
                break;
            case 'GET':
                handleGet(req, res).catch(next);
                break;
            case 'HEAD':
                handleHead(req, res).catch(next);
                break;
            default:
                res.status(405).send('Method not allowed');
        }
    });
    // Start listening
    const port = config_1.config.cloudLinksBridgePort;
    return new Promise((resolve, reject) => {
        server = app.listen(port, () => {
            console.log(`${LOG_PREFIX} Cloud Links WebDAV bridge listening on port ${port}`);
            const totalLinks = [...adaptersByProvider.values()].reduce((sum, m) => sum + m.size, 0);
            console.log(`${LOG_PREFIX} Serving ${totalLinks} cloud link(s) across ${adaptersByProvider.size} provider(s)`);
            // ------ Periodic re-crawl to keep the cache warm ------
            recrawlTimer = setInterval(() => {
                const startTime = new Date();
                console.log(`[${startTime.toISOString()}]${LOG_PREFIX} Periodic re-crawl started (${propfindCache.size} cached paths)`);
                let refreshed = 0;
                for (const [cachedPath, entry] of propfindCache) {
                    // Parse the cached path to determine provider and resolve TTLs
                    const segs = cachedPath.split('/').filter(Boolean);
                    if (segs.length < 2)
                        continue; // Root / provider-level paths aren't adapter calls
                    const pType = segs[0];
                    const lName = segs[1];
                    // Skip entries that are still fresh for their provider
                    const { freshMs } = getTtlsForProvider(pType);
                    const age = Date.now() - entry.fetchedAt;
                    if (age < freshMs)
                        continue;
                    const subP = segs.slice(2).join('/') || undefined;
                    const bPath = `/${pType}/${lName}${subP ? '/' + subP : ''}`;
                    const pMap = adaptersByProvider.get(pType);
                    const adpt = pMap?.get(lName);
                    if (!adpt)
                        continue;
                    backgroundRefresh(cachedPath, adpt, subP, pType, lName, bPath);
                    refreshed++;
                }
                console.log(`[${new Date().toISOString()}]${LOG_PREFIX} Periodic re-crawl queued ${refreshed} refresh(es)`);
            }, RECRAWL_INTERVAL_MS);
            // Ensure the timer doesn't prevent process exit
            if (recrawlTimer && typeof recrawlTimer === 'object' && 'unref' in recrawlTimer) {
                recrawlTimer.unref();
            }
            // ------ Fire-and-forget pre-warm for HTTP adapters ------
            // This runs in the background after the server is ready to accept
            // requests. If Plex connects before pre-warm finishes, PROPFIND
            // requests will still work — they'll just trigger on-demand fetches.
            preWarmCache().catch((err) => {
                console.error(`[${new Date().toISOString()}]${LOG_PREFIX} Pre-warm failed: ${err?.message}`);
            });
            resolve();
        });
        server.on('error', (err) => {
            console.error(`${LOG_PREFIX} Failed to start Cloud Links bridge: ${err?.message}`);
            reject(err);
        });
    });
}
/**
 * Stops the Cloud Links bridge server gracefully.
 */
function stopCloudLinksBridge() {
    return new Promise((resolve) => {
        // Cancel the re-crawl timer if active
        if (recrawlTimer) {
            clearInterval(recrawlTimer);
            recrawlTimer = null;
        }
        // Clear the PROPFIND cache
        propfindCache.clear();
        refreshingPaths.clear();
        if (!server) {
            resolve();
            return;
        }
        server.close(() => {
            console.log(`${LOG_PREFIX} Cloud Links bridge stopped`);
            server = null;
            resolve();
        });
    });
}
