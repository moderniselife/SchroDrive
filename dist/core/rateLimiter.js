"use strict";
/**
 * SchroDrive — Rate Limiter & Request Throttler
 *
 * Provides rate limit tracking, exponential backoff, request throttling,
 * response caching, and in-flight request locking for API providers.
 *
 * This module exports a singleton {@link rateLimiter} instance used across
 * all provider modules (Real-Debrid, TorBox) to coordinate API access.
 *
 * Key features:
 * - Per-provider configurable throttle delays (e.g. 500ms for RD, 5s for TorBox)
 * - Exponential backoff from 60s base up to 15min maximum
 * - Response caching with 20min TTL to serve during backoff periods
 * - In-flight request locks with automatic 2min expiry to prevent deadlocks
 *
 * @module rateLimiter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = void 0;
const db_1 = require("./db");
// ===========================================================================
// RateLimiter Class
// ===========================================================================
/**
 * Centralised rate limiter that manages API request pacing, backoff, caching,
 * and concurrency locking across multiple debrid providers.
 *
 * Usage:
 * 1. Call {@link throttle} before each request to enforce minimum delays
 * 2. Call {@link recordSuccess} on success to reset error counters
 * 3. Call {@link recordRateLimit} on 429/rate-limit errors to trigger backoff
 * 4. Check {@link isRateLimited} before making requests to skip during backoff
 * 5. Use {@link setCache}/{@link getCache} to store/retrieve cached responses
 */
class RateLimiter {
    constructor() {
        /** Per-provider rate limit state. */
        this.states = new Map();
        /** Whether the initial DB restore has been performed. */
        this._dbRestored = false;
        /** Base backoff duration: 60 seconds, doubles with each consecutive error. */
        this.baseBackoffMs = 60 * 1000;
        /** Maximum backoff cap: 15 minutes. */
        this.maxBackoffMs = 15 * 60 * 1000;
        /**
         * Minimum delay between requests per provider (in milliseconds).
         * - Real-Debrid: 250 req/min ≈ 240ms minimum; using 500ms for safety margin
         * - TorBox: "60 per hour" observed — starts at 5s but dynamically adjusted
         * - AllDebrid: 12 req/s = 83ms minimum; using 100ms for safety margin
         * - Premiumize: Undocumented threshold; using 1s conservative default
         */
        this.minRequestDelayMs = new Map([
            ["torbox", 5000], // 5 seconds between TorBox requests (strict limits, dynamically adjusted)
            ["realdebrid", 500], // 500ms between RD requests (250/min limit)
            ["alldebrid", 100], // 100ms between AD requests (12/s, 600/min limit)
            ["premiumize", 1000], // 1s between PM requests (undocumented limits, conservative)
        ]);
        /**
         * Cache for last successful API responses.
         * TTL must be >= max backoff to ensure cached data survives rate limit periods.
         */
        this.cache = new Map();
        /** Cache TTL: 20 minutes (longer than the 15min max backoff). */
        this.cacheTtlMs = 20 * 60 * 1000;
        // ---------------------------------------------------------------------------
        // In-flight Request Locks
        // ---------------------------------------------------------------------------
        /** Promises representing in-flight requests, keyed by lock name. */
        this.inFlightLocks = new Map();
        /** Resolver functions to release locks when requests complete. */
        this.lockResolvers = new Map();
        /** Timestamps for lock creation, used for automatic expiry detection. */
        this.lockTimestamps = new Map();
    }
    // ---------------------------------------------------------------------------
    // State Management
    // ---------------------------------------------------------------------------
    /**
     * Retrieves or creates the rate limit state for a provider.
     *
     * @param provider - The provider identifier (e.g. "realdebrid", "torbox").
     * @returns The mutable rate limit state object.
     */
    getState(provider) {
        // Restore all states from DB on first access
        if (!this._dbRestored) {
            this.restoreFromDb();
        }
        if (!this.states.has(provider)) {
            this.states.set(provider, {
                isLimited: false,
                limitedUntil: 0,
                consecutiveErrors: 0,
                lastError: null,
                lastRequestTime: 0,
            });
        }
        return this.states.get(provider);
    }
    /**
     * Restores rate limit states from the SQLite database.
     * Called once on first access to rehydrate backoff timers across restarts.
     */
    restoreFromDb() {
        this._dbRestored = true;
        try {
            const saved = (0, db_1.loadAllRateLimitStates)();
            for (const [provider, record] of saved) {
                // Only restore if the backoff hasn't expired
                const state = {
                    isLimited: record.isLimited && record.limitedUntil > Date.now(),
                    limitedUntil: record.limitedUntil,
                    consecutiveErrors: record.consecutiveErrors,
                    lastError: record.lastError,
                    lastRequestTime: record.lastRequest,
                };
                this.states.set(provider, state);
                // Restore custom throttle delays
                if (record.throttleMs !== null && record.throttleMs !== undefined) {
                    this.minRequestDelayMs.set(provider, record.throttleMs);
                }
            }
            if (saved.size > 0) {
                console.log(`[${new Date().toISOString()}][rate-limiter] Restored state for ${saved.size} provider(s) from database`);
            }
        }
        catch (err) {
            console.warn(`[${new Date().toISOString()}][rate-limiter] Failed to restore from database: ${err?.message}`);
        }
    }
    /**
     * Persists the current state for a provider to the database.
     *
     * @param provider - The provider identifier.
     */
    persistState(provider) {
        try {
            const state = this.states.get(provider);
            if (!state)
                return;
            (0, db_1.saveRateLimitState)(provider, {
                isLimited: state.isLimited,
                limitedUntil: state.limitedUntil,
                consecutiveErrors: state.consecutiveErrors,
                lastError: state.lastError,
                lastRequest: state.lastRequestTime,
                throttleMs: this.minRequestDelayMs.get(provider) ?? null,
            });
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][rate-limiter] Failed to persist state: ${err?.message}`);
        }
    }
    /**
     * Sets a custom throttle delay for a provider, overriding the default.
     *
     * @param provider - The provider identifier.
     * @param delayMs - The minimum delay between requests in milliseconds.
     */
    setThrottleDelay(provider, delayMs) {
        this.minRequestDelayMs.set(provider, delayMs);
        this.persistState(provider);
    }
    // ---------------------------------------------------------------------------
    // Locking (Concurrency Control)
    // ---------------------------------------------------------------------------
    /**
     * Acquires an exclusive lock for a specific endpoint to prevent concurrent
     * duplicate requests (e.g. "realdebrid:torrents").
     *
     * Locks automatically expire after 2 minutes to prevent deadlocks from
     * crashed requests that never released their lock.
     *
     * @param lockKey - Unique identifier for the locked resource.
     * @param waitIfLocked - If `true` and lock is held, waits for release then re-acquires.
     * @param timeoutMs - Maximum time to wait for a held lock (default: 30s).
     * @returns `true` if the lock was acquired, `false` if already held and `waitIfLocked` is `false`.
     */
    async acquireLock(lockKey, waitIfLocked = false, timeoutMs = 30000) {
        const lockData = this.inFlightLocks.get(lockKey);
        // Check if lock exists and hasn't expired (2 minute max lock time)
        if (lockData) {
            const lockAge = Date.now() - (this.lockTimestamps.get(lockKey) || 0);
            if (lockAge > 120000) {
                // Lock expired, force release it
                console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} lock expired after ${Math.round(lockAge / 1000)}s, force releasing`);
                this.releaseLock(lockKey);
            }
            else if (waitIfLocked) {
                console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} waiting for in-flight request (timeout: ${timeoutMs}ms)...`);
                // Wait with timeout — race between lock release and timeout
                const timeoutPromise = new Promise((resolve) => setTimeout(resolve, timeoutMs));
                await Promise.race([lockData, timeoutPromise]);
                // After waiting, try to acquire again (recursive but should succeed now)
                return this.acquireLock(lockKey, false);
            }
            else {
                console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} request already in-flight, skipping`);
                return false;
            }
        }
        // Create a promise that will resolve when releaseLock is called
        let resolver;
        const promise = new Promise((resolve) => {
            resolver = resolve;
        });
        this.inFlightLocks.set(lockKey, promise);
        this.lockResolvers.set(lockKey, resolver);
        this.lockTimestamps.set(lockKey, Date.now());
        return true;
    }
    /**
     * Waits for an existing lock to be released without acquiring it.
     * Returns immediately if no lock is held.
     *
     * @param lockKey - The lock identifier to wait on.
     */
    async waitForLock(lockKey) {
        const existingLock = this.inFlightLocks.get(lockKey);
        if (existingLock) {
            console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} waiting for lock release...`);
            await existingLock;
        }
    }
    /**
     * Releases a held lock, resolving any waiters.
     *
     * @param lockKey - The lock identifier to release.
     */
    releaseLock(lockKey) {
        const resolver = this.lockResolvers.get(lockKey);
        if (resolver) {
            resolver();
        }
        this.inFlightLocks.delete(lockKey);
        this.lockResolvers.delete(lockKey);
        this.lockTimestamps.delete(lockKey);
    }
    /**
     * Checks whether a lock is currently held.
     *
     * @param lockKey - The lock identifier to check.
     * @returns `true` if the lock is currently held.
     */
    isLocked(lockKey) {
        return this.inFlightLocks.has(lockKey);
    }
    // ---------------------------------------------------------------------------
    // Throttling
    // ---------------------------------------------------------------------------
    /**
     * Enforces minimum delay between requests for a provider.
     * If the elapsed time since the last request is less than the configured
     * minimum delay, this method sleeps for the remaining duration.
     *
     * @param provider - The provider identifier to throttle.
     */
    async throttle(provider) {
        const state = this.getState(provider);
        const minDelay = this.minRequestDelayMs.get(provider) || 1000;
        const elapsed = Date.now() - state.lastRequestTime;
        if (elapsed < minDelay) {
            const waitTime = minDelay - elapsed;
            console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} throttling for ${waitTime}ms`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        state.lastRequestTime = Date.now();
    }
    /**
     * Returns the time (in milliseconds) until the next request is allowed
     * for the given provider, based on throttle settings.
     *
     * @param provider - The provider identifier.
     * @returns Milliseconds until next allowed request, or 0 if ready.
     */
    getThrottleWaitMs(provider) {
        const state = this.getState(provider);
        const minDelay = this.minRequestDelayMs.get(provider) || 1000;
        const elapsed = Date.now() - state.lastRequestTime;
        return Math.max(0, minDelay - elapsed);
    }
    // ---------------------------------------------------------------------------
    // Rate Limit Tracking
    // ---------------------------------------------------------------------------
    /**
     * Checks whether a provider is currently in a rate-limit backoff period.
     * Automatically clears expired rate limits and logs the resumption.
     *
     * @param provider - The provider identifier.
     * @returns `true` if the provider is currently rate-limited.
     */
    isRateLimited(provider) {
        const state = this.getState(provider);
        if (!state.isLimited)
            return false;
        if (Date.now() >= state.limitedUntil) {
            // Rate limit period expired
            console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} rate limit expired, resuming`);
            state.isLimited = false;
            return false;
        }
        return true;
    }
    /**
     * Returns the remaining wait time (in seconds) before a rate-limited
     * provider can resume making requests.
     *
     * @param provider - The provider identifier.
     * @returns Remaining seconds, or 0 if not rate-limited.
     */
    getWaitTimeSeconds(provider) {
        const state = this.getState(provider);
        if (!state.isLimited)
            return 0;
        const remaining = Math.max(0, state.limitedUntil - Date.now());
        return Math.ceil(remaining / 1000);
    }
    /**
     * Records a rate limit error and calculates the backoff duration.
     *
     * If `backoffOverrideMs` is provided (e.g. parsed from a provider's
     * "60 per hour" response), that value is used directly. Otherwise,
     * exponential backoff is applied:
     * `min(baseBackoff * 2^(consecutiveErrors - 1), maxBackoff)`
     * This produces: 60s → 120s → 240s → 480s → 900s (capped at 15min).
     *
     * @param provider - The provider identifier that was rate-limited.
     * @param errorMessage - The error message for diagnostic logging.
     * @param backoffOverrideMs - Optional explicit backoff duration in milliseconds.
     */
    recordRateLimit(provider, errorMessage, backoffOverrideMs) {
        const state = this.getState(provider);
        state.consecutiveErrors++;
        state.lastError = errorMessage;
        state.isLimited = true;
        // Use provider-specified backoff if available, otherwise exponential
        const backoff = backoffOverrideMs
            ? Math.min(backoffOverrideMs, this.maxBackoffMs)
            : Math.min(this.baseBackoffMs * Math.pow(2, state.consecutiveErrors - 1), this.maxBackoffMs);
        state.limitedUntil = Date.now() + backoff;
        const waitSeconds = Math.ceil(backoff / 1000);
        const source = backoffOverrideMs ? 'provider-specified' : 'exponential';
        console.warn(`[${new Date().toISOString()}][rate-limiter] ${provider} rate limited, ` +
            `backing off for ${waitSeconds}s [${source}] (attempt ${state.consecutiveErrors})`);
        this.persistState(provider);
    }
    /**
     * Records a successful request.
     *
     * Resets the consecutive error counter but does NOT clear an active
     * rate-limit backoff period — the backoff must expire naturally. This
     * prevents a single lucky request from resetting the limiter and
     * immediately triggering another burst of 429s.
     *
     * @param provider - The provider identifier that completed successfully.
     */
    recordSuccess(provider) {
        const state = this.getState(provider);
        if (state.consecutiveErrors > 0) {
            console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} request succeeded, resetting error count`);
        }
        state.consecutiveErrors = 0;
        state.lastError = null;
        // Only clear rate limit if the backoff period has already expired.
        // Don't prematurely clear — one success during backoff doesn't mean
        // the provider's rate limit window has reset.
        if (state.isLimited && Date.now() >= state.limitedUntil) {
            state.isLimited = false;
            console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} backoff expired + success — fully cleared`);
        }
        this.persistState(provider);
    }
    /**
     * Determines whether an error indicates a rate limit by inspecting its
     * message for common rate-limit keywords (case-insensitive).
     *
     * Matches: "rate limit", "too many requests", "429", "throttl".
     *
     * @param error - The error object or message to inspect.
     * @returns `true` if the error appears to be a rate limit error.
     */
    isRateLimitError(error) {
        const message = String(error?.message || error || "").toLowerCase();
        return (message.includes("rate limit") ||
            message.includes("too many requests") ||
            message.includes("429") ||
            message.includes("throttl"));
    }
    // ---------------------------------------------------------------------------
    // Caching
    // ---------------------------------------------------------------------------
    /**
     * Stores data in the response cache with the current timestamp.
     *
     * @param key - The cache key (typically `"provider_endpoint"`).
     * @param data - The data to cache.
     */
    setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
        // Write through to SQLite for persistence across restarts
        try {
            const expiresAt = Date.now() + this.cacheTtlMs;
            (0, db_1.setCacheEntry)(key, JSON.stringify(data), expiresAt);
        }
        catch (err) {
            // Non-critical — in-memory cache still works
            console.error(`[${new Date().toISOString()}][rate-limiter] Cache write-through failed: ${err?.message}`);
        }
    }
    /**
     * Retrieves cached data if it exists and hasn't exceeded the TTL.
     * Expired entries are automatically purged.
     *
     * @typeParam T - The expected type of the cached data.
     * @param key - The cache key to look up.
     * @returns The cached data, or `null` if not found or expired.
     */
    getCache(key) {
        const cached = this.cache.get(key);
        if (cached) {
            if (Date.now() - cached.timestamp > this.cacheTtlMs) {
                this.cache.delete(key);
            }
            else {
                return cached.data;
            }
        }
        // In-memory miss — check SQLite as fallback
        try {
            const dbData = (0, db_1.getCacheEntry)(key);
            if (dbData) {
                const parsed = JSON.parse(dbData);
                // Re-populate in-memory cache
                this.cache.set(key, { data: parsed, timestamp: Date.now() });
                return parsed;
            }
        }
        catch (err) {
            // Non-critical — return null gracefully
        }
        return null;
    }
    // ---------------------------------------------------------------------------
    // Status Reporting
    // ---------------------------------------------------------------------------
    /**
     * Returns a summary of rate-limit status for all tracked providers.
     * Useful for health check endpoints and diagnostic dashboards.
     *
     * @returns An object keyed by provider name with current limit state.
     */
    getStatus() {
        const status = {};
        for (const [provider, state] of this.states) {
            status[provider] = {
                limited: this.isRateLimited(provider),
                waitSeconds: this.getWaitTimeSeconds(provider),
                errors: state.consecutiveErrors,
            };
        }
        return status;
    }
}
// ===========================================================================
// Singleton Export
// ===========================================================================
/** Shared singleton rate limiter instance used by all provider modules. */
exports.rateLimiter = new RateLimiter();
