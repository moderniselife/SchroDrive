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

// ===========================================================================
// Types
// ===========================================================================

/**
 * Tracks the current rate-limiting state for a single API provider.
 *
 * @property isLimited - Whether the provider is currently in a backoff period.
 * @property limitedUntil - Timestamp (ms since epoch) when the backoff expires.
 * @property consecutiveErrors - Number of consecutive rate limit errors (drives backoff calculation).
 * @property lastError - The error message from the most recent rate limit event.
 * @property lastRequestTime - Timestamp of the last request (used for throttle enforcement).
 */
interface RateLimitState {
  isLimited: boolean;
  limitedUntil: number;
  consecutiveErrors: number;
  lastError: string | null;
  lastRequestTime: number;
}

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
  /** Per-provider rate limit state. */
  private states: Map<string, RateLimitState> = new Map();
  
  /** Base backoff duration: 60 seconds, doubles with each consecutive error. */
  private baseBackoffMs = 60 * 1000;
  /** Maximum backoff cap: 15 minutes. */
  private maxBackoffMs = 15 * 60 * 1000;

  /**
   * Minimum delay between requests per provider (in milliseconds).
   * - Real-Debrid: 250 req/min ≈ 240ms minimum; using 500ms for safety margin
   * - TorBox: "60 per hour" observed — starts at 5s but dynamically adjusted
   * - AllDebrid: 12 req/s = 83ms minimum; using 100ms for safety margin
   * - Premiumize: Undocumented threshold; using 1s conservative default
   */
  private minRequestDelayMs: Map<string, number> = new Map([
    ["torbox", 5000],      // 5 seconds between TorBox requests (strict limits, dynamically adjusted)
    ["realdebrid", 500],   // 500ms between RD requests (250/min limit)
    ["alldebrid", 100],    // 100ms between AD requests (12/s, 600/min limit)
    ["premiumize", 1000],  // 1s between PM requests (undocumented limits, conservative)
  ]);
  
  /**
   * Cache for last successful API responses.
   * TTL must be >= max backoff to ensure cached data survives rate limit periods.
   */
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  /** Cache TTL: 20 minutes (longer than the 15min max backoff). */
  private cacheTtlMs = 20 * 60 * 1000;
  
  // ---------------------------------------------------------------------------
  // In-flight Request Locks
  // ---------------------------------------------------------------------------

  /** Promises representing in-flight requests, keyed by lock name. */
  private inFlightLocks: Map<string, Promise<void>> = new Map();
  /** Resolver functions to release locks when requests complete. */
  private lockResolvers: Map<string, () => void> = new Map();
  /** Timestamps for lock creation, used for automatic expiry detection. */
  private lockTimestamps: Map<string, number> = new Map();

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  /**
   * Retrieves or creates the rate limit state for a provider.
   *
   * @param provider - The provider identifier (e.g. "realdebrid", "torbox").
   * @returns The mutable rate limit state object.
   */
  private getState(provider: string): RateLimitState {
    if (!this.states.has(provider)) {
      this.states.set(provider, {
        isLimited: false,
        limitedUntil: 0,
        consecutiveErrors: 0,
        lastError: null,
        lastRequestTime: 0,
      });
    }
    return this.states.get(provider)!;
  }

  /**
   * Sets a custom throttle delay for a provider, overriding the default.
   *
   * @param provider - The provider identifier.
   * @param delayMs - The minimum delay between requests in milliseconds.
   */
  setThrottleDelay(provider: string, delayMs: number): void {
    this.minRequestDelayMs.set(provider, delayMs);
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
  async acquireLock(lockKey: string, waitIfLocked: boolean = false, timeoutMs: number = 30000): Promise<boolean> {
    const lockData = this.inFlightLocks.get(lockKey);
    
    // Check if lock exists and hasn't expired (2 minute max lock time)
    if (lockData) {
      const lockAge = Date.now() - (this.lockTimestamps.get(lockKey) || 0);
      if (lockAge > 120000) {
        // Lock expired, force release it
        console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} lock expired after ${Math.round(lockAge/1000)}s, force releasing`);
        this.releaseLock(lockKey);
      } else if (waitIfLocked) {
        console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} waiting for in-flight request (timeout: ${timeoutMs}ms)...`);
        // Wait with timeout — race between lock release and timeout
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
        await Promise.race([lockData, timeoutPromise]);
        // After waiting, try to acquire again (recursive but should succeed now)
        return this.acquireLock(lockKey, false);
      } else {
        console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} request already in-flight, skipping`);
        return false;
      }
    }
    
    // Create a promise that will resolve when releaseLock is called
    let resolver: () => void;
    const promise = new Promise<void>((resolve) => {
      resolver = resolve;
    });
    this.inFlightLocks.set(lockKey, promise);
    this.lockResolvers.set(lockKey, resolver!);
    this.lockTimestamps.set(lockKey, Date.now());
    return true;
  }

  /**
   * Waits for an existing lock to be released without acquiring it.
   * Returns immediately if no lock is held.
   *
   * @param lockKey - The lock identifier to wait on.
   */
  async waitForLock(lockKey: string): Promise<void> {
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
  releaseLock(lockKey: string): void {
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
  isLocked(lockKey: string): boolean {
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
  async throttle(provider: string): Promise<void> {
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
  getThrottleWaitMs(provider: string): number {
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
  isRateLimited(provider: string): boolean {
    const state = this.getState(provider);
    if (!state.isLimited) return false;
    
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
  getWaitTimeSeconds(provider: string): number {
    const state = this.getState(provider);
    if (!state.isLimited) return 0;
    
    const remaining = Math.max(0, state.limitedUntil - Date.now());
    return Math.ceil(remaining / 1000);
  }

  /**
   * Records a rate limit error and calculates the exponential backoff duration.
   *
   * Backoff formula: `min(baseBackoff * 2^(consecutiveErrors - 1), maxBackoff)`
   * This produces: 60s → 120s → 240s → 480s → 900s (capped at 15min).
   *
   * @param provider - The provider identifier that was rate-limited.
   * @param errorMessage - The error message for diagnostic logging.
   */
  recordRateLimit(provider: string, errorMessage: string): void {
    const state = this.getState(provider);
    state.consecutiveErrors++;
    state.lastError = errorMessage;
    state.isLimited = true;
    
    // Calculate backoff with exponential increase
    const backoff = Math.min(
      this.baseBackoffMs * Math.pow(2, state.consecutiveErrors - 1),
      this.maxBackoffMs
    );
    
    state.limitedUntil = Date.now() + backoff;
    
    const waitSeconds = Math.ceil(backoff / 1000);
    console.warn(
      `[${new Date().toISOString()}][rate-limiter] ${provider} rate limited, ` +
      `backing off for ${waitSeconds}s (attempt ${state.consecutiveErrors})`
    );
  }

  /**
   * Records a successful request, resetting the consecutive error count
   * and clearing any active rate-limit state.
   *
   * @param provider - The provider identifier that completed successfully.
   */
  recordSuccess(provider: string): void {
    const state = this.getState(provider);
    if (state.consecutiveErrors > 0) {
      console.log(`[${new Date().toISOString()}][rate-limiter] ${provider} request succeeded, resetting error count`);
    }
    state.consecutiveErrors = 0;
    state.lastError = null;
    state.isLimited = false;
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
  isRateLimitError(error: any): boolean {
    const message = String(error?.message || error || "").toLowerCase();
    return (
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("429") ||
      message.includes("throttl")
    );
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
  setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Retrieves cached data if it exists and hasn't exceeded the TTL.
   * Expired entries are automatically purged.
   *
   * @typeParam T - The expected type of the cached data.
   * @param key - The cache key to look up.
   * @returns The cached data, or `null` if not found or expired.
   */
  getCache<T>(key: string): T | null {
    const cached = this.cache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return cached.data as T;
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
  getStatus(): Record<string, { limited: boolean; waitSeconds: number; errors: number }> {
    const status: Record<string, { limited: boolean; waitSeconds: number; errors: number }> = {};
    
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
export const rateLimiter = new RateLimiter();
