"use strict";
/**
 * SchroDrive — SQLite Persistence Layer
 *
 * Provides a lightweight SQLite database for persisting application state
 * across restarts. This is a BONUS persistence layer — the app must still
 * function correctly if the database is corrupted, missing, or deleted.
 *
 * Uses Bun's built-in `bun:sqlite` for synchronous, zero-dependency SQLite
 * access with WAL journalling for concurrent read performance.
 *
 * Tables:
 * - `processed_watchlist` — tracks which watchlist items have been processed
 * - `dead_torrents` — records torrents flagged as dead by the WebDAV bridge
 * - `rate_limit_state` — persists per-provider rate limit backoff state
 * - `blacklist_backup` — mirrors the JSON blacklist for disaster recovery
 * - `response_cache` — key/value cache with TTL for API responses
 *
 * @module db
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.closeDb = closeDb;
exports.pruneOldEntries = pruneOldEntries;
exports.isWatchlistProcessed = isWatchlistProcessed;
exports.markWatchlistProcessed = markWatchlistProcessed;
exports.getProcessedWatchlistKeys = getProcessedWatchlistKeys;
exports.getDeadTorrent = getDeadTorrent;
exports.upsertDeadTorrent = upsertDeadTorrent;
exports.removeDeadTorrent = removeDeadTorrent;
exports.getAllDeadTorrents = getAllDeadTorrents;
exports.saveRateLimitState = saveRateLimitState;
exports.loadRateLimitState = loadRateLimitState;
exports.loadAllRateLimitStates = loadAllRateLimitStates;
exports.backupBlacklistEntry = backupBlacklistEntry;
exports.getAllBlacklistBackup = getAllBlacklistBackup;
exports.recoverBlacklistFromDb = recoverBlacklistFromDb;
exports.setCacheEntry = setCacheEntry;
exports.getCacheEntry = getCacheEntry;
exports.pruneExpiredCache = pruneExpiredCache;
exports.getOverseerrRequest = getOverseerrRequest;
exports.upsertOverseerrRequest = upsertOverseerrRequest;
exports.getAllOverseerrRequests = getAllOverseerrRequests;
const bun_sqlite_1 = require("bun:sqlite");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
// ===========================================================================
// Singleton
// ===========================================================================
/** The singleton database connection. */
let db = null;
// ===========================================================================
// Lifecycle
// ===========================================================================
/**
 * Returns the singleton database connection, initialising it on first call.
 * Creates the data directory if it doesn't exist, enables WAL mode, and
 * runs schema migrations.
 *
 * @returns The initialised `better-sqlite3` database instance.
 */
function getDb() {
    if (db)
        return db;
    const dbPath = config_1.config.dbPath;
    // Ensure the parent directory exists
    const dir = path_1.default.dirname(dbPath);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    db = new bun_sqlite_1.Database(dbPath, { create: true });
    // WAL mode provides better concurrent read performance
    db.exec('PRAGMA journal_mode = WAL');
    // Wait up to 5 seconds if the database is locked by another connection
    db.exec('PRAGMA busy_timeout = 5000');
    // Run schema migrations
    runMigrations(db);
    console.log(`[${new Date().toISOString()}][db] SQLite database initialised at ${dbPath}`);
    return db;
}
/**
 * Closes the database connection gracefully.
 * Safe to call multiple times — silently ignores if already closed.
 */
function closeDb() {
    if (!db)
        return;
    try {
        db.close();
        console.log(`[${new Date().toISOString()}][db] Database connection closed`);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] Error closing database: ${err?.message}`);
    }
    finally {
        db = null;
    }
}
// ===========================================================================
// Schema Migrations
// ===========================================================================
/**
 * Runs all schema migrations idempotently using `CREATE TABLE IF NOT EXISTS`.
 * Each table creation is wrapped in its own try/catch so a failure in one
 * table doesn't prevent others from being created.
 *
 * @param database - The database instance to migrate.
 */
function runMigrations(database) {
    const migrations = [
        `CREATE TABLE IF NOT EXISTS processed_watchlist (
      key TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT,
      processed_at INTEGER NOT NULL
    )`,
        `CREATE TABLE IF NOT EXISTS dead_torrents (
      torrent_key TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      torrent_id TEXT NOT NULL,
      torrent_name TEXT,
      failure_count INTEGER DEFAULT 0,
      flagged_at INTEGER,
      last_error TEXT,
      created_at INTEGER NOT NULL
    )`,
        `CREATE TABLE IF NOT EXISTS rate_limit_state (
      provider TEXT PRIMARY KEY,
      is_limited INTEGER DEFAULT 0,
      limited_until INTEGER,
      consecutive_errors INTEGER DEFAULT 0,
      last_error TEXT,
      last_request INTEGER,
      throttle_ms INTEGER
    )`,
        `CREATE TABLE IF NOT EXISTS blacklist_backup (
      name TEXT PRIMARY KEY,
      reason TEXT,
      provider TEXT,
      added_at INTEGER,
      raw_entry TEXT
    )`,
        `CREATE TABLE IF NOT EXISTS response_cache (
      cache_key TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )`,
        `CREATE TABLE IF NOT EXISTS overseerr_requests (
      request_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER,
      last_search_at INTEGER,
      status TEXT,
      created_at INTEGER NOT NULL
    )`,
    ];
    for (const sql of migrations) {
        try {
            database.exec(sql);
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][db] Migration failed: ${err?.message}`);
        }
    }
}
// ===========================================================================
// Pruning
// ===========================================================================
/**
 * Removes stale data from the database:
 * - Processed watchlist entries older than 30 days
 * - Expired response cache entries
 *
 * Designed to be called on a scheduled interval (e.g. every 24 hours).
 */
function pruneOldEntries() {
    try {
        const database = getDb();
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        database.prepare('DELETE FROM processed_watchlist WHERE processed_at < ?').run(thirtyDaysAgo);
        database.prepare('DELETE FROM response_cache WHERE expires_at < ?').run(Date.now());
        console.log(`[${new Date().toISOString()}][db] Pruned stale watchlist + expired cache entries`);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] Prune failed: ${err?.message}`);
    }
}
// ===========================================================================
// Processed Watchlist
// ===========================================================================
/**
 * Checks whether a watchlist item has already been processed.
 *
 * @param key - The unique watchlist item key (e.g. "plex:12345").
 * @returns `true` if the key exists in the processed watchlist table.
 */
function isWatchlistProcessed(key) {
    try {
        const database = getDb();
        const row = database.prepare('SELECT 1 FROM processed_watchlist WHERE key = ?').get(key);
        return !!row;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] isWatchlistProcessed error: ${err?.message}`);
        return false;
    }
}
/**
 * Records a watchlist item as processed.
 *
 * @param key - The unique watchlist item key.
 * @param source - The source service (e.g. "plex", "jellyfin").
 * @param title - Optional human-readable title for diagnostics.
 */
function markWatchlistProcessed(key, source, title) {
    try {
        const database = getDb();
        database.prepare('INSERT OR REPLACE INTO processed_watchlist (key, source, title, processed_at) VALUES (?, ?, ?, ?)').run(key, source, title ?? null, Date.now());
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] markWatchlistProcessed error: ${err?.message}`);
    }
}
/**
 * Loads all processed watchlist keys from the database.
 * Used at startup to hydrate in-memory state.
 *
 * @returns A Set of all processed watchlist keys.
 */
function getProcessedWatchlistKeys() {
    try {
        const database = getDb();
        const rows = database.prepare('SELECT key FROM processed_watchlist').all();
        return new Set(rows.map((r) => r.key));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getProcessedWatchlistKeys error: ${err?.message}`);
        return new Set();
    }
}
/**
 * Retrieves a single dead torrent record by its key.
 *
 * @param key - The torrent key (primary key).
 * @returns The dead torrent record, or `null` if not found.
 */
function getDeadTorrent(key) {
    try {
        const database = getDb();
        const row = database.prepare('SELECT torrent_key, provider, torrent_id, torrent_name, failure_count, flagged_at, last_error, created_at FROM dead_torrents WHERE torrent_key = ?').get(key);
        if (!row)
            return null;
        return {
            torrentKey: row.torrent_key,
            provider: row.provider,
            torrentId: row.torrent_id,
            torrentName: row.torrent_name,
            failureCount: row.failure_count,
            flaggedAt: row.flagged_at,
            lastError: row.last_error,
            createdAt: row.created_at,
        };
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getDeadTorrent error: ${err?.message}`);
        return null;
    }
}
/**
 * Inserts or updates a dead torrent record.
 *
 * @param key - The torrent key (primary key).
 * @param provider - The debrid provider name.
 * @param torrentId - The provider-side torrent identifier.
 * @param name - Optional torrent name.
 * @param failureCount - Number of consecutive failures.
 * @param flaggedAt - Timestamp when the torrent was flagged as dead.
 * @param lastError - Most recent error message.
 */
function upsertDeadTorrent(key, provider, torrentId, name, failureCount, flaggedAt, lastError) {
    try {
        const database = getDb();
        database.prepare(`
      INSERT INTO dead_torrents (torrent_key, provider, torrent_id, torrent_name, failure_count, flagged_at, last_error, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(torrent_key) DO UPDATE SET
        failure_count = excluded.failure_count,
        flagged_at = excluded.flagged_at,
        last_error = excluded.last_error
    `).run(key, provider, torrentId, name ?? null, failureCount ?? 0, flaggedAt ?? null, lastError ?? null, Date.now());
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] upsertDeadTorrent error: ${err?.message}`);
    }
}
/**
 * Removes a dead torrent record by its key.
 *
 * @param key - The torrent key to remove.
 */
function removeDeadTorrent(key) {
    try {
        const database = getDb();
        database.prepare('DELETE FROM dead_torrents WHERE torrent_key = ?').run(key);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] removeDeadTorrent error: ${err?.message}`);
    }
}
/**
 * Retrieves all dead torrent records from the database.
 *
 * @returns Array of all dead torrent records.
 */
function getAllDeadTorrents() {
    try {
        const database = getDb();
        const rows = database.prepare('SELECT torrent_key, provider, torrent_id, torrent_name, failure_count, flagged_at, last_error, created_at FROM dead_torrents').all();
        return rows.map((row) => ({
            torrentKey: row.torrent_key,
            provider: row.provider,
            torrentId: row.torrent_id,
            torrentName: row.torrent_name,
            failureCount: row.failure_count,
            flaggedAt: row.flagged_at,
            lastError: row.last_error,
            createdAt: row.created_at,
        }));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getAllDeadTorrents error: ${err?.message}`);
        return [];
    }
}
/**
 * Persists the rate limit state for a provider.
 *
 * @param provider - The provider identifier.
 * @param state - The rate limit state to persist.
 */
function saveRateLimitState(provider, state) {
    try {
        const database = getDb();
        database.prepare(`
      INSERT INTO rate_limit_state (provider, is_limited, limited_until, consecutive_errors, last_error, last_request, throttle_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider) DO UPDATE SET
        is_limited = excluded.is_limited,
        limited_until = excluded.limited_until,
        consecutive_errors = excluded.consecutive_errors,
        last_error = excluded.last_error,
        last_request = excluded.last_request,
        throttle_ms = excluded.throttle_ms
    `).run(provider, state.isLimited ? 1 : 0, state.limitedUntil, state.consecutiveErrors, state.lastError ?? null, state.lastRequest, state.throttleMs ?? null);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] saveRateLimitState error: ${err?.message}`);
    }
}
/**
 * Loads the persisted rate limit state for a provider.
 *
 * @param provider - The provider identifier.
 * @returns The rate limit state, or `null` if not found.
 */
function loadRateLimitState(provider) {
    try {
        const database = getDb();
        const row = database.prepare('SELECT is_limited, limited_until, consecutive_errors, last_error, last_request, throttle_ms FROM rate_limit_state WHERE provider = ?').get(provider);
        if (!row)
            return null;
        return {
            isLimited: !!row.is_limited,
            limitedUntil: row.limited_until ?? 0,
            consecutiveErrors: row.consecutive_errors ?? 0,
            lastError: row.last_error,
            lastRequest: row.last_request ?? 0,
            throttleMs: row.throttle_ms,
        };
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] loadRateLimitState error: ${err?.message}`);
        return null;
    }
}
/**
 * Loads rate limit state for all providers.
 * Used at startup to restore backoff timers.
 *
 * @returns A Map of provider name to rate limit state.
 */
function loadAllRateLimitStates() {
    const result = new Map();
    try {
        const database = getDb();
        const rows = database.prepare('SELECT provider, is_limited, limited_until, consecutive_errors, last_error, last_request, throttle_ms FROM rate_limit_state').all();
        for (const row of rows) {
            result.set(row.provider, {
                isLimited: !!row.is_limited,
                limitedUntil: row.limited_until ?? 0,
                consecutiveErrors: row.consecutive_errors ?? 0,
                lastError: row.last_error,
                lastRequest: row.last_request ?? 0,
                throttleMs: row.throttle_ms,
            });
        }
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] loadAllRateLimitStates error: ${err?.message}`);
    }
    return result;
}
// ===========================================================================
// Blacklist Backup
// ===========================================================================
/**
 * Backs up a single blacklist entry to the database.
 * Acts as a secondary persistence layer alongside the JSON file.
 *
 * @param name - The blacklisted torrent name.
 * @param reason - Why it was blacklisted.
 * @param provider - Which provider flagged it.
 * @param addedAt - Timestamp when the entry was added.
 * @param rawEntry - The raw JSON entry for full-fidelity recovery.
 */
function backupBlacklistEntry(name, reason, provider, addedAt, rawEntry) {
    try {
        const database = getDb();
        database.prepare(`
      INSERT OR REPLACE INTO blacklist_backup (name, reason, provider, added_at, raw_entry)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, reason, provider, addedAt, rawEntry);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] backupBlacklistEntry error: ${err?.message}`);
    }
}
/**
 * Retrieves all blacklist backup entries from the database.
 *
 * @returns Array of all backed-up blacklist entries.
 */
function getAllBlacklistBackup() {
    try {
        const database = getDb();
        const rows = database.prepare('SELECT name, reason, provider, added_at, raw_entry FROM blacklist_backup').all();
        return rows.map((row) => ({
            name: row.name,
            reason: row.reason,
            provider: row.provider,
            addedAt: row.added_at,
            rawEntry: row.raw_entry,
        }));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getAllBlacklistBackup error: ${err?.message}`);
        return [];
    }
}
/**
 * Recovers blacklist entries from the database backup.
 * Used when the JSON blacklist file is missing, empty, or corrupted.
 *
 * @returns Array of recovered blacklist entries in the original JSON format.
 */
function recoverBlacklistFromDb() {
    try {
        const database = getDb();
        const rows = database.prepare('SELECT name, reason, provider, added_at, raw_entry FROM blacklist_backup').all();
        return rows.map((row) => {
            // Try to parse the raw entry first for full fidelity
            if (row.raw_entry) {
                try {
                    return JSON.parse(row.raw_entry);
                }
                catch {
                    // Fall through to manual reconstruction
                }
            }
            return {
                name: row.name,
                reason: row.reason ?? 'recovered from database',
                provider: row.provider ?? 'unknown',
                blacklistedAt: row.added_at
                    ? new Date(row.added_at).toISOString()
                    : new Date().toISOString(),
            };
        });
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] recoverBlacklistFromDb error: ${err?.message}`);
        return [];
    }
}
// ===========================================================================
// Response Cache
// ===========================================================================
/**
 * Stores a cache entry with an expiry timestamp.
 *
 * @param key - The cache key.
 * @param data - The data to cache (serialised as a string).
 * @param expiresAt - Timestamp (ms since epoch) when the entry expires.
 */
function setCacheEntry(key, data, expiresAt) {
    try {
        const database = getDb();
        database.prepare(`
      INSERT OR REPLACE INTO response_cache (cache_key, data, expires_at)
      VALUES (?, ?, ?)
    `).run(key, data, expiresAt);
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] setCacheEntry error: ${err?.message}`);
    }
}
/**
 * Retrieves a cache entry if it exists and hasn't expired.
 *
 * @param key - The cache key to look up.
 * @returns The cached data string, or `null` if not found or expired.
 */
function getCacheEntry(key) {
    try {
        const database = getDb();
        const row = database.prepare('SELECT data, expires_at FROM response_cache WHERE cache_key = ?').get(key);
        if (!row)
            return null;
        // Check expiry
        if (Date.now() > row.expires_at) {
            // Clean up expired entry
            database.prepare('DELETE FROM response_cache WHERE cache_key = ?').run(key);
            return null;
        }
        return row.data;
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getCacheEntry error: ${err?.message}`);
        return null;
    }
}
/**
 * Removes all expired entries from the response cache table.
 */
function pruneExpiredCache() {
    try {
        const database = getDb();
        database.prepare('DELETE FROM response_cache WHERE expires_at < ?').run(Date.now());
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] pruneExpiredCache error: ${err?.message}`);
    }
}
/**
 * Retrieves an Overseerr request record by its ID.
 */
function getOverseerrRequest(requestId) {
    try {
        const database = getDb();
        const row = database.prepare('SELECT request_id, title, media_type, tmdb_id, last_search_at, status FROM overseerr_requests WHERE request_id = ?').get(requestId);
        if (!row)
            return null;
        return {
            requestId: row.request_id,
            title: row.title,
            mediaType: row.media_type,
            tmdbId: row.tmdb_id ?? undefined,
            lastSearchAt: row.last_search_at ?? undefined,
            status: row.status ?? undefined,
        };
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getOverseerrRequest error: ${err?.message}`);
        return null;
    }
}
/**
 * Inserts or updates an Overseerr request record.
 */
function upsertOverseerrRequest(record) {
    try {
        const database = getDb();
        database.prepare(`
      INSERT INTO overseerr_requests (request_id, title, media_type, tmdb_id, last_search_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET
        title = excluded.title,
        media_type = excluded.media_type,
        tmdb_id = excluded.tmdb_id,
        last_search_at = COALESCE(excluded.last_search_at, overseerr_requests.last_search_at),
        status = excluded.status
    `).run(record.requestId, record.title, record.mediaType, record.tmdbId ?? null, record.lastSearchAt ?? null, record.status ?? null, Date.now());
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] upsertOverseerrRequest error: ${err?.message}`);
    }
}
/**
 * Retrieves all Overseerr request records from the database.
 */
function getAllOverseerrRequests() {
    try {
        const database = getDb();
        const rows = database.prepare('SELECT request_id, title, media_type, tmdb_id, last_search_at, status FROM overseerr_requests').all();
        return rows.map(row => ({
            requestId: row.request_id,
            title: row.title,
            mediaType: row.media_type,
            tmdbId: row.tmdb_id ?? undefined,
            lastSearchAt: row.last_search_at ?? undefined,
            status: row.status ?? undefined,
        }));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][db] getAllOverseerrRequests error: ${err?.message}`);
        return [];
    }
}
