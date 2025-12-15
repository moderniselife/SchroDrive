"use strict";
// Rate limit tracking, backoff, and request throttling for API providers
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimiter = void 0;
class RateLimiter {
    constructor() {
        this.states = new Map();
        // Base backoff: 60 seconds, doubles with each consecutive error up to 15 minutes
        this.baseBackoffMs = 60 * 1000;
        this.maxBackoffMs = 15 * 60 * 1000;
        // Minimum delay between requests per provider (in ms)
        // Real-Debrid: 250 req/min = 240ms minimum, using 500ms for safety
        // TorBox: Undocumented but strict, using 5s to be safe
        this.minRequestDelayMs = new Map([
            ["torbox", 5000], // 5 seconds between TorBox requests (strict limits)
            ["realdebrid", 500], // 500ms between RD requests (250/min limit)
        ]);
        // Cache for last successful results
        this.cache = new Map();
        this.cacheTtlMs = 60000; // Cache for 60 seconds
    }
    getState(provider) {
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
     * Set custom throttle delay for a provider
     */
    setThrottleDelay(provider, delayMs) {
        this.minRequestDelayMs.set(provider, delayMs);
    }
    /**
     * Wait if needed to respect throttle limits, then mark request time
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
     * Get time until next request is allowed (for logging)
     */
    getThrottleWaitMs(provider) {
        const state = this.getState(provider);
        const minDelay = this.minRequestDelayMs.get(provider) || 1000;
        const elapsed = Date.now() - state.lastRequestTime;
        return Math.max(0, minDelay - elapsed);
    }
    /**
     * Check if a provider is currently rate limited
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
     * Get remaining wait time in seconds
     */
    getWaitTimeSeconds(provider) {
        const state = this.getState(provider);
        if (!state.isLimited)
            return 0;
        const remaining = Math.max(0, state.limitedUntil - Date.now());
        return Math.ceil(remaining / 1000);
    }
    /**
     * Record a rate limit error and calculate backoff
     */
    recordRateLimit(provider, errorMessage) {
        const state = this.getState(provider);
        state.consecutiveErrors++;
        state.lastError = errorMessage;
        state.isLimited = true;
        // Calculate backoff with exponential increase
        const backoff = Math.min(this.baseBackoffMs * Math.pow(2, state.consecutiveErrors - 1), this.maxBackoffMs);
        state.limitedUntil = Date.now() + backoff;
        const waitSeconds = Math.ceil(backoff / 1000);
        console.warn(`[${new Date().toISOString()}][rate-limiter] ${provider} rate limited, ` +
            `backing off for ${waitSeconds}s (attempt ${state.consecutiveErrors})`);
    }
    /**
     * Record a successful request - resets consecutive error count
     */
    recordSuccess(provider) {
        const state = this.getState(provider);
        if (state.consecutiveErrors > 0) {
            console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} request succeeded, resetting error count`);
        }
        state.consecutiveErrors = 0;
        state.lastError = null;
        state.isLimited = false;
    }
    /**
     * Check if an error is a rate limit error
     */
    isRateLimitError(error) {
        const message = String(error?.message || error || "").toLowerCase();
        return (message.includes("rate limit") ||
            message.includes("too many requests") ||
            message.includes("429") ||
            message.includes("throttl"));
    }
    /**
     * Cache data for a provider
     */
    setCache(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }
    /**
     * Get cached data if still valid
     */
    getCache(key) {
        const cached = this.cache.get(key);
        if (!cached)
            return null;
        if (Date.now() - cached.timestamp > this.cacheTtlMs) {
            this.cache.delete(key);
            return null;
        }
        return cached.data;
    }
    /**
     * Get status for all providers
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
// Singleton instance
exports.rateLimiter = new RateLimiter();
