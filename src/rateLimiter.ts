// Rate limit tracking, backoff, and request throttling for API providers

interface RateLimitState {
  isLimited: boolean;
  limitedUntil: number;
  consecutiveErrors: number;
  lastError: string | null;
  lastRequestTime: number;
}

class RateLimiter {
  private states: Map<string, RateLimitState> = new Map();
  
  // Base backoff: 60 seconds, doubles with each consecutive error up to 15 minutes
  private baseBackoffMs = 60 * 1000;
  private maxBackoffMs = 15 * 60 * 1000;

  // Minimum delay between requests per provider (in ms)
  // Real-Debrid: 250 req/min = 240ms minimum, using 500ms for safety
  // TorBox: Undocumented but strict, using 5s to be safe
  private minRequestDelayMs: Map<string, number> = new Map([
    ["torbox", 5000],      // 5 seconds between TorBox requests (strict limits)
    ["realdebrid", 500],   // 500ms between RD requests (250/min limit)
  ]);
  
  // Cache for last successful results
  // Cache TTL must be >= max backoff to ensure cached data survives rate limit periods
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTtlMs = 20 * 60 * 1000; // Cache for 20 minutes (longer than max backoff of 15min)
  
  // In-flight request locks to prevent concurrent requests to the same endpoint
  private inFlightLocks: Map<string, Promise<void>> = new Map();
  private lockResolvers: Map<string, () => void> = new Map();
  private lockTimestamps: Map<string, number> = new Map();

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
   * Set custom throttle delay for a provider
   */
  setThrottleDelay(provider: string, delayMs: number): void {
    this.minRequestDelayMs.set(provider, delayMs);
  }

  /**
   * Acquire a lock for a specific endpoint (e.g., "realdebrid:torrents")
   * If waitIfLocked is true and lock is held, waits for it to be released then acquires
   * Returns true if lock acquired, false if another request is in-flight and waitIfLocked is false
   * Locks automatically expire after 2 minutes to prevent deadlocks
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
        // Wait with timeout
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
   * Wait for an existing lock to be released (does not acquire)
   */
  async waitForLock(lockKey: string): Promise<void> {
    const existingLock = this.inFlightLocks.get(lockKey);
    if (existingLock) {
      console.log(`[${new Date().toISOString()}][rate-limiter] ${lockKey} waiting for lock release...`);
      await existingLock;
    }
  }

  /**
   * Release a lock for a specific endpoint
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
   * Check if a lock is held
   */
  isLocked(lockKey: string): boolean {
    return this.inFlightLocks.has(lockKey);
  }

  /**
   * Wait if needed to respect throttle limits, then mark request time
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
   * Get time until next request is allowed (for logging)
   */
  getThrottleWaitMs(provider: string): number {
    const state = this.getState(provider);
    const minDelay = this.minRequestDelayMs.get(provider) || 1000;
    const elapsed = Date.now() - state.lastRequestTime;
    return Math.max(0, minDelay - elapsed);
  }

  /**
   * Check if a provider is currently rate limited
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
   * Get remaining wait time in seconds
   */
  getWaitTimeSeconds(provider: string): number {
    const state = this.getState(provider);
    if (!state.isLimited) return 0;
    
    const remaining = Math.max(0, state.limitedUntil - Date.now());
    return Math.ceil(remaining / 1000);
  }

  /**
   * Record a rate limit error and calculate backoff
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
   * Record a successful request - resets consecutive error count
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
   * Check if an error is a rate limit error
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

  /**
   * Cache data for a provider
   */
  setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /**
   * Get cached data if still valid
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

  /**
   * Get status for all providers
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

// Singleton instance
export const rateLimiter = new RateLimiter();
