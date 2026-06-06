"use strict";
/**
 * SchroDrive — Provider-Agnostic Token Rotation Manager
 *
 * Inspired by Zurg's download_tokens feature. Manages primary and download
 * tokens per debrid provider, automatically rotating through download tokens
 * when bandwidth limits (HTTP 503) are encountered.
 *
 * Concept:
 * - Each provider has a **primary token** (for management: list, add, delete)
 * - Each provider can have **download tokens** (for streaming/downloading via WebDAV)
 * - Download tokens are tried in order; when one hits 503/bandwidth limit, rotate to next
 * - Tokens reset daily at midnight AEST (configurable via `TOKEN_RESET_TIMEZONE` env)
 * - Token state is persisted in SQLite so it survives restarts
 *
 * Uses Bun's built-in `bun:sqlite` for synchronous, zero-dependency SQLite
 * access with WAL journalling for concurrent read performance.
 *
 * @module tokenRotator
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenRotator = exports.TokenRotator = void 0;
const bun_sqlite_1 = require("bun:sqlite");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
// ===========================================================================
// Constants
// ===========================================================================
/** Default limit duration: 24 hours (RD bandwidth resets daily). */
const DEFAULT_LIMIT_DURATION_MS = 24 * 60 * 60 * 1000;
/** Interval for checking the daily reset (every 60 seconds). */
const RESET_CHECK_INTERVAL_MS = 60 * 1000;
/** Prefix used in all log messages from this module. */
const LOG_PREFIX = 'token-rotator';
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Masks a token for safe logging — only reveals the last 4 characters.
 *
 * @param token - The full token string.
 * @returns A masked representation like `***abcd`.
 */
function maskToken(token) {
    if (token.length <= 4)
        return '****';
    return `***${token.slice(-4)}`;
}
/**
 * Returns the current date/time as a `Date` object in the configured timezone,
 * then extracts the local hours and minutes so we can detect midnight crossings.
 *
 * @param timezone - IANA timezone string (e.g. 'Australia/Sydney').
 * @returns An object with `hours` and `minutes` in the target timezone.
 */
function getTimeInTimezone(timezone) {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-AU', {
        timeZone: timezone,
        hour: 'numeric',
        minute: 'numeric',
        hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hours = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
    const minutes = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return { hours, minutes };
}
// ===========================================================================
// TokenRotator Class
// ===========================================================================
/**
 * Manages token pools for multiple debrid providers, persisting state in SQLite.
 *
 * Usage:
 * ```ts
 * const rotator = new TokenRotator('/path/to/tokens.db');
 * rotator.registerProvider('realdebrid', primaryToken, [dlToken1, dlToken2]);
 *
 * const token = rotator.getDownloadToken('realdebrid');
 * // ... use token for download ...
 * // On 503:
 * rotator.markTokenLimited('realdebrid', token, '503 bandwidth exceeded');
 * ```
 */
class TokenRotator {
    /**
     * Creates a new TokenRotator instance with SQLite persistence.
     *
     * @param dbPath - Absolute path to the SQLite database file for token state.
     */
    constructor(dbPath) {
        /**
         * In-memory registry of provider → primary token.
         * The primary token is used for management operations (list/add/delete).
         */
        this.primaryTokens = new Map();
        /**
         * In-memory registry of provider → ordered list of download tokens.
         * Maintains insertion order for deterministic rotation.
         */
        this.downloadTokens = new Map();
        /** Handle for the daily reset interval timer. */
        this.resetIntervalHandle = null;
        /** Tracks whether the daily reset has already fired for the current day. */
        this.lastResetDay = '';
        // Ensure the parent directory exists
        const dir = path_1.default.dirname(dbPath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        this.db = new bun_sqlite_1.Database(dbPath, { create: true });
        // WAL mode for better concurrent read performance
        this.db.exec('PRAGMA journal_mode = WAL');
        this.db.exec('PRAGMA busy_timeout = 5000');
        // Create the token_states table
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_states (
        provider TEXT NOT NULL,
        token TEXT NOT NULL,
        is_limited INTEGER NOT NULL DEFAULT 0,
        limited_until INTEGER NOT NULL DEFAULT 0,
        limit_reason TEXT NOT NULL DEFAULT '',
        last_used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (provider, token)
      )
    `);
        console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Token rotator initialised with database at ${dbPath}`);
    }
    // =========================================================================
    // Registration
    // =========================================================================
    /**
     * Registers a provider's complete token pool (primary + download tokens).
     *
     * Existing token state is preserved if the token already exists in the database
     * (e.g. after a restart). New tokens are inserted with clean state.
     *
     * @param provider - The provider identifier (e.g. 'realdebrid', 'torbox').
     * @param primaryToken - The primary API token for management operations.
     * @param downloadTokens - Ordered list of tokens for download/streaming operations.
     */
    registerProvider(provider, primaryToken, downloadTokens) {
        this.primaryTokens.set(provider, primaryToken);
        this.downloadTokens.set(provider, downloadTokens);
        // Upsert primary token into SQLite (preserve existing state if present)
        this._upsertTokenIfNew(provider, primaryToken);
        // Upsert each download token
        for (const token of downloadTokens) {
            this._upsertTokenIfNew(provider, token);
        }
        // Clean up tokens that are no longer in the pool
        const allTokens = new Set([primaryToken, ...downloadTokens]);
        this._pruneRemovedTokens(provider, allTokens);
        console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Registered ${provider}: ` +
            `primary=${maskToken(primaryToken)}, ` +
            `downloadTokens=${downloadTokens.length} ` +
            `[${downloadTokens.map(maskToken).join(', ')}]`);
    }
    // =========================================================================
    // Token Retrieval
    // =========================================================================
    /**
     * Returns the primary token for a provider (used for management operations).
     *
     * @param provider - The provider identifier.
     * @returns The primary token string, or `null` if the provider is not registered.
     */
    getPrimaryToken(provider) {
        return this.primaryTokens.get(provider) ?? null;
    }
    /**
     * Returns the best available download token for a provider, implementing
     * the rotation logic:
     *
     * 1. Get all download tokens for the provider (in configured order)
     * 2. If no download tokens are configured, fall back to the primary token
     * 3. Skip limited tokens (check limitedUntil vs now, auto-clear expired limits)
     * 4. Return the first available token
     * 5. Update the last_used timestamp
     * 6. Return `null` if ALL tokens are limited (logs a warning)
     *
     * @param provider - The provider identifier.
     * @returns The best available download token, or `null` if all are limited.
     */
    getDownloadToken(provider) {
        const dlTokens = this.downloadTokens.get(provider);
        // No download tokens configured — fall back to primary
        if (!dlTokens || dlTokens.length === 0) {
            const primary = this.primaryTokens.get(provider);
            if (!primary) {
                console.warn(`[${new Date().toISOString()}][${LOG_PREFIX}] ${provider} has no tokens registered`);
                return null;
            }
            // Check if primary is limited
            if (this.isTokenLimited(provider, primary)) {
                console.warn(`[${new Date().toISOString()}][${LOG_PREFIX}] ${provider} primary token ${maskToken(primary)} is limited — no fallback available`);
                return null;
            }
            this._updateLastUsed(provider, primary);
            return primary;
        }
        const now = Date.now();
        // Try each download token in order
        for (const token of dlTokens) {
            const state = this._getTokenState(provider, token);
            // Auto-clear expired limits
            if (state && state.is_limited && state.limited_until > 0 && state.limited_until <= now) {
                this._clearTokenLimit(provider, token);
                console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] ${provider} token ${maskToken(token)} limit expired — cleared automatically`);
            }
            // Check if still limited after potential auto-clear
            if (!this.isTokenLimited(provider, token)) {
                this._updateLastUsed(provider, token);
                return token;
            }
        }
        // All download tokens exhausted — log warning
        console.warn(`[${new Date().toISOString()}][${LOG_PREFIX}] ${provider} ALL ${dlTokens.length} download tokens are limited — returning null`);
        return null;
    }
    // =========================================================================
    // Token Limiting
    // =========================================================================
    /**
     * Marks a specific token as bandwidth-limited (e.g. after receiving a 503).
     *
     * The token will be skipped during rotation until either:
     * - The `durationMs` expires
     * - The daily reset runs
     * - `resetAllTokens()` is called manually
     *
     * @param provider - The provider identifier.
     * @param token - The token to mark as limited.
     * @param reason - Human-readable reason (e.g. '503 bandwidth exceeded').
     * @param durationMs - How long the limit should last. Defaults to 24 hours.
     */
    markTokenLimited(provider, token, reason, durationMs = DEFAULT_LIMIT_DURATION_MS) {
        const now = Date.now();
        const limitedUntil = now + durationMs;
        this.db
            .prepare(`INSERT INTO token_states (provider, token, is_limited, limited_until, limit_reason, last_used)
         VALUES (?, ?, 1, ?, ?, ?)
         ON CONFLICT(provider, token) DO UPDATE SET
           is_limited = 1,
           limited_until = excluded.limited_until,
           limit_reason = excluded.limit_reason`)
            .run(provider, token, limitedUntil, reason, now);
        // Determine next token for logging
        const nextToken = this.getDownloadToken(provider);
        const nextInfo = nextToken ? maskToken(nextToken) : 'NONE AVAILABLE';
        console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] ${provider} token ${maskToken(token)} marked limited: ${reason}. ` +
            `Rotated to token ${nextInfo}`);
    }
    /**
     * Checks whether a specific token is currently bandwidth-limited.
     * Automatically clears expired limits.
     *
     * @param provider - The provider identifier.
     * @param token - The token to check.
     * @returns `true` if the token is currently limited, `false` otherwise.
     */
    isTokenLimited(provider, token) {
        const state = this._getTokenState(provider, token);
        if (!state)
            return false;
        if (!state.is_limited)
            return false;
        // Auto-clear expired limits
        const now = Date.now();
        if (state.limited_until > 0 && state.limited_until <= now) {
            this._clearTokenLimit(provider, token);
            return false;
        }
        return true;
    }
    // =========================================================================
    // Status & Reporting
    // =========================================================================
    /**
     * Returns the status of all tokens registered for a given provider.
     *
     * @param provider - The provider identifier.
     * @returns Array of `TokenState` objects for every token in the provider's pool.
     */
    getTokenStatus(provider) {
        const rows = this.db
            .prepare(`SELECT provider, token, is_limited, limited_until, limit_reason, last_used
         FROM token_states WHERE provider = ?`)
            .all(provider);
        return rows.map((row) => ({
            token: row.token,
            provider: row.provider,
            isLimited: !!row.is_limited,
            limitedUntil: row.limited_until,
            limitReason: row.limit_reason,
            lastUsed: row.last_used,
        }));
    }
    /**
     * Returns a summary of token status across all registered providers.
     *
     * @returns A record keyed by provider name, containing the primary token,
     *          download token states, and active/limited counts.
     */
    getAllStatus() {
        const result = {};
        for (const [provider, primary] of this.primaryTokens) {
            const allStates = this.getTokenStatus(provider);
            const dlTokenSet = new Set(this.downloadTokens.get(provider) ?? []);
            const downloadStates = allStates.filter((s) => dlTokenSet.has(s.token));
            const now = Date.now();
            let limitedCount = 0;
            for (const state of downloadStates) {
                if (state.isLimited && (state.limitedUntil === 0 || state.limitedUntil > now)) {
                    limitedCount++;
                }
            }
            result[provider] = {
                primary: maskToken(primary),
                downloadTokens: downloadStates,
                activeCount: downloadStates.length - limitedCount,
                limitedCount,
            };
        }
        return result;
    }
    // =========================================================================
    // Reset
    // =========================================================================
    /**
     * Resets all tokens across all providers — clears all bandwidth limits.
     * Typically called at midnight in the configured timezone.
     */
    resetAllTokens() {
        this.db
            .prepare(`UPDATE token_states SET is_limited = 0, limited_until = 0, limit_reason = ''`)
            .run();
        console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] All token limits reset across all providers`);
    }
    /**
     * Starts the daily reset cron. Checks every minute whether it's past midnight
     * in the configured timezone, then resets all tokens once per day.
     *
     * Uses `setInterval` — no external cron libraries required.
     */
    startDailyReset() {
        const timezone = config_1.config.tokenResetTimezone;
        console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Daily reset cron started — resets at midnight ${timezone}`);
        // Initialise lastResetDay to the current date so we don't immediately reset
        this.lastResetDay = this._getCurrentDateString(timezone);
        this.resetIntervalHandle = setInterval(() => {
            try {
                const { hours, minutes } = getTimeInTimezone(timezone);
                const currentDay = this._getCurrentDateString(timezone);
                // Fire reset if we've crossed into a new day (within the first minute)
                if (currentDay !== this.lastResetDay && hours === 0 && minutes < 2) {
                    console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Midnight detected in ${timezone} — running daily token reset`);
                    this.resetAllTokens();
                    this.lastResetDay = currentDay;
                }
            }
            catch (err) {
                console.error(`[${new Date().toISOString()}][${LOG_PREFIX}] Daily reset check error: ${err?.message}`);
            }
        }, RESET_CHECK_INTERVAL_MS);
    }
    /**
     * Stops the daily reset cron if it's running.
     */
    stopDailyReset() {
        if (this.resetIntervalHandle) {
            clearInterval(this.resetIntervalHandle);
            this.resetIntervalHandle = null;
            console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Daily reset cron stopped`);
        }
    }
    /**
     * Closes the underlying SQLite database connection.
     * Should be called during graceful shutdown.
     */
    close() {
        this.stopDailyReset();
        try {
            this.db.close();
            console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Token rotator database closed`);
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][${LOG_PREFIX}] Error closing token rotator database: ${err?.message}`);
        }
    }
    // =========================================================================
    // Private Helpers
    // =========================================================================
    /**
     * Inserts a token into the database if it doesn't already exist.
     * Preserves existing state (limit info, last_used) across restarts.
     *
     * @param provider - The provider identifier.
     * @param token - The token string.
     */
    _upsertTokenIfNew(provider, token) {
        this.db
            .prepare(`INSERT OR IGNORE INTO token_states (provider, token, is_limited, limited_until, limit_reason, last_used)
         VALUES (?, ?, 0, 0, '', 0)`)
            .run(provider, token);
    }
    /**
     * Removes tokens from the database that are no longer in the provider's pool.
     * Handles cases where tokens are removed from the configuration.
     *
     * @param provider - The provider identifier.
     * @param currentTokens - Set of tokens that should still exist.
     */
    _pruneRemovedTokens(provider, currentTokens) {
        const existing = this.db
            .prepare(`SELECT token FROM token_states WHERE provider = ?`)
            .all(provider);
        for (const row of existing) {
            if (!currentTokens.has(row.token)) {
                this.db
                    .prepare(`DELETE FROM token_states WHERE provider = ? AND token = ?`)
                    .run(provider, row.token);
                console.log(`[${new Date().toISOString()}][${LOG_PREFIX}] Pruned removed token ${maskToken(row.token)} from ${provider}`);
            }
        }
    }
    /**
     * Retrieves the raw token state row from SQLite.
     *
     * @param provider - The provider identifier.
     * @param token - The token to look up.
     * @returns The raw row data, or `null` if not found.
     */
    _getTokenState(provider, token) {
        return this.db
            .prepare(`SELECT is_limited, limited_until, limit_reason, last_used
         FROM token_states WHERE provider = ? AND token = ?`)
            .get(provider, token);
    }
    /**
     * Clears the bandwidth limit on a specific token.
     *
     * @param provider - The provider identifier.
     * @param token - The token to clear.
     */
    _clearTokenLimit(provider, token) {
        this.db
            .prepare(`UPDATE token_states SET is_limited = 0, limited_until = 0, limit_reason = ''
         WHERE provider = ? AND token = ?`)
            .run(provider, token);
    }
    /**
     * Updates the last_used timestamp for a token.
     *
     * @param provider - The provider identifier.
     * @param token - The token that was just used.
     */
    _updateLastUsed(provider, token) {
        this.db
            .prepare(`UPDATE token_states SET last_used = ? WHERE provider = ? AND token = ?`)
            .run(Date.now(), provider, token);
    }
    /**
     * Returns the current date as a string (YYYY-MM-DD) in the given timezone.
     * Used to track whether we've already reset today.
     *
     * @param timezone - IANA timezone string.
     * @returns Date string like '2026-06-07'.
     */
    _getCurrentDateString(timezone) {
        return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
    }
}
exports.TokenRotator = TokenRotator;
// ===========================================================================
// Singleton
// ===========================================================================
/** The singleton TokenRotator instance, backed by a dedicated tokens database. */
exports.tokenRotator = new TokenRotator(path_1.default.join(config_1.config.dataDir, 'tokens.db'));
