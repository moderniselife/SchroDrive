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
  private minRequestDelayMs: Map<string, number> = new Map([
    ["torbox", 2000],      // 2 seconds between TorBox requests
    ["realdebrid", 1000],  // 1 second between RD requests
  ]);

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
