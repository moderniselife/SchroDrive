/**
 * SchroDrive — Dynamic Rate Limit Learning Store
 *
 * Persists per-endpoint rate limit observations to a JSON file so the
 * system learns optimal request pacing over time rather than relying
 * on hardcoded delays.
 *
 * The store tracks:
 * - Observed Retry-After values from provider responses
 * - Successful request timings (latency percentiles)
 * - Error patterns per endpoint path
 * - Dynamically adjusted throttle delays
 *
 * @module rateLimitStore
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// =============================================================================
// Types
// =============================================================================

/** Statistics for a specific API endpoint. */
export interface EndpointStats {
  /** Full endpoint path (e.g. "/rest/1.0/torrents"). */
  endpoint: string;
  /** Provider this endpoint belongs to. */
  provider: string;
  /** Total requests made to this endpoint. */
  totalRequests: number;
  /** Total rate limit errors received. */
  rateLimitErrors: number;
  /** Total successful responses. */
  successCount: number;
  /** Average response time in milliseconds. */
  avgResponseMs: number;
  /** Minimum observed Retry-After value (seconds). */
  minRetryAfterS: number | null;
  /** Maximum observed Retry-After value (seconds). */
  maxRetryAfterS: number | null;
  /** Most recently observed Retry-After value. */
  lastRetryAfterS: number | null;
  /** Current dynamically calculated optimal delay (ms). */
  optimalDelayMs: number;
  /** Last time this endpoint was accessed (ISO timestamp). */
  lastAccessed: string;
  /** Last time a rate limit was hit (ISO timestamp). */
  lastRateLimited: string | null;
  /** Rolling window of recent response times (last 20). */
  recentResponseTimesMs: number[];
}

/** The full rate limit learning store file structure. */
interface RateLimitStoreFile {
  /** Schema version. */
  version: 1;
  /** Last time the file was saved. */
  lastSaved: string;
  /** Per-endpoint statistics. */
  endpoints: Record<string, EndpointStats>;
  /** Global provider-level learned delays. */
  providerDelays: Record<string, number>;
}

// =============================================================================
// Configuration
// =============================================================================

/** Default path for the rate limit store file. */
const DEFAULT_STORE_PATH = join(
  process.env.CONFIG_DIR || process.env.MOUNT_BASE || "/config",
  "rate-limit-store.json"
);

const STORE_PATH = process.env.RATE_LIMIT_STORE_PATH || DEFAULT_STORE_PATH;

/** Maximum recent response times to track per endpoint. */
const MAX_RECENT_RESPONSES = 20;

/** How often to auto-save to disk (ms). */
const AUTO_SAVE_INTERVAL_MS = 60_000;

/** Minimum delay floor — never go below this (ms). */
const MIN_DELAY_FLOOR_MS = 100;

/** Maximum learned delay cap (ms). */
const MAX_DELAY_CAP_MS = 30_000;

// =============================================================================
// Store Class
// =============================================================================

class RateLimitStore {
  private data: RateLimitStoreFile;
  private dirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.data = this.load();
    // Auto-save periodically
    this.saveTimer = setInterval(() => {
      if (this.dirty) {
        this.save();
        this.dirty = false;
      }
    }, AUTO_SAVE_INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // File I/O
  // ---------------------------------------------------------------------------

  private load(): RateLimitStoreFile {
    try {
      if (existsSync(STORE_PATH)) {
        const raw = readFileSync(STORE_PATH, "utf-8");
        const parsed = JSON.parse(raw) as RateLimitStoreFile;
        if (parsed.version === 1 && parsed.endpoints) {
          console.log(`[${new Date().toISOString()}][rate-store] Loaded ${Object.keys(parsed.endpoints).length} endpoint stats from ${STORE_PATH}`);
          return parsed;
        }
      }
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][rate-store] Failed to load:`, err?.message || String(err));
    }

    return {
      version: 1,
      lastSaved: new Date().toISOString(),
      endpoints: {},
      providerDelays: {},
    };
  }

  private save(): void {
    try {
      const dir = dirname(STORE_PATH);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.data.lastSaved = new Date().toISOString();
      writeFileSync(STORE_PATH, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][rate-store] Failed to save:`, err?.message || String(err));
    }
  }

  /** Force save immediately. */
  flush(): void {
    this.save();
    this.dirty = false;
  }

  // ---------------------------------------------------------------------------
  // Endpoint Key
  // ---------------------------------------------------------------------------

  /** Generates a unique key for an endpoint. */
  private key(provider: string, endpoint: string): string {
    return `${provider}:${endpoint}`;
  }

  /** Gets or creates endpoint stats. */
  private getEndpoint(provider: string, endpoint: string): EndpointStats {
    const k = this.key(provider, endpoint);
    if (!this.data.endpoints[k]) {
      this.data.endpoints[k] = {
        endpoint,
        provider,
        totalRequests: 0,
        rateLimitErrors: 0,
        successCount: 0,
        avgResponseMs: 0,
        minRetryAfterS: null,
        maxRetryAfterS: null,
        lastRetryAfterS: null,
        optimalDelayMs: 1000, // Start conservative
        lastAccessed: new Date().toISOString(),
        lastRateLimited: null,
        recentResponseTimesMs: [],
      };
    }
    return this.data.endpoints[k];
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  /**
   * Records a successful API response.
   *
   * Updates endpoint statistics and adjusts the optimal delay downward
   * (towards faster pacing) since the request succeeded.
   *
   * @param provider - Provider name (e.g. "realdebrid", "torbox")
   * @param endpoint - API endpoint path
   * @param responseTimeMs - How long the request took
   */
  recordSuccess(provider: string, endpoint: string, responseTimeMs: number): void {
    const stats = this.getEndpoint(provider, endpoint);
    stats.totalRequests++;
    stats.successCount++;
    stats.lastAccessed = new Date().toISOString();

    // Track response time
    stats.recentResponseTimesMs.push(responseTimeMs);
    if (stats.recentResponseTimesMs.length > MAX_RECENT_RESPONSES) {
      stats.recentResponseTimesMs.shift();
    }

    // Recalculate average
    stats.avgResponseMs = Math.round(
      stats.recentResponseTimesMs.reduce((a, b) => a + b, 0) / stats.recentResponseTimesMs.length
    );

    // Gradually decrease delay on success (learn to go faster)
    // Only decrease if we haven't been rate limited recently
    const timeSinceRateLimit = stats.lastRateLimited
      ? Date.now() - new Date(stats.lastRateLimited).getTime()
      : Infinity;

    // Only speed up if we haven't been rate limited in the last 5 minutes
    if (timeSinceRateLimit > 5 * 60 * 1000) {
      stats.optimalDelayMs = Math.max(
        MIN_DELAY_FLOOR_MS,
        Math.round(stats.optimalDelayMs * 0.95) // Decrease by 5%
      );
    }

    this.dirty = true;
  }

  /**
   * Records a rate limit error response.
   *
   * Parses the Retry-After header value (if provided) and adjusts the
   * optimal delay upward to avoid future rate limits.
   *
   * @param provider - Provider name
   * @param endpoint - API endpoint path
   * @param retryAfterS - Retry-After value from the response header (seconds), if present
   */
  recordRateLimit(provider: string, endpoint: string, retryAfterS?: number): void {
    const stats = this.getEndpoint(provider, endpoint);
    stats.totalRequests++;
    stats.rateLimitErrors++;
    stats.lastAccessed = new Date().toISOString();
    stats.lastRateLimited = new Date().toISOString();

    // Track Retry-After values if provided
    if (retryAfterS != null && retryAfterS > 0) {
      stats.lastRetryAfterS = retryAfterS;
      if (stats.minRetryAfterS === null || retryAfterS < stats.minRetryAfterS) {
        stats.minRetryAfterS = retryAfterS;
      }
      if (stats.maxRetryAfterS === null || retryAfterS > stats.maxRetryAfterS) {
        stats.maxRetryAfterS = retryAfterS;
      }
    }

    // Increase delay aggressively on rate limit (learn to slow down)
    if (retryAfterS != null && retryAfterS > 0) {
      // If we have a Retry-After, use it as the basis (with 20% safety margin)
      stats.optimalDelayMs = Math.min(
        MAX_DELAY_CAP_MS,
        Math.round((retryAfterS * 1000) * 1.2)
      );
    } else {
      // No Retry-After — double the current delay
      stats.optimalDelayMs = Math.min(
        MAX_DELAY_CAP_MS,
        stats.optimalDelayMs * 2
      );
    }

    // Update provider-level delay to the max of all endpoints for that provider
    this.updateProviderDelay(provider);

    this.dirty = true;
    console.log(
      `[${new Date().toISOString()}][rate-store] ${provider}:${endpoint} ` +
      `rate limited (${stats.rateLimitErrors}/${stats.totalRequests}), ` +
      `new optimal delay: ${stats.optimalDelayMs}ms` +
      (retryAfterS ? `, Retry-After: ${retryAfterS}s` : "")
    );
  }

  // ---------------------------------------------------------------------------
  // Delay Calculation
  // ---------------------------------------------------------------------------

  /**
   * Gets the dynamically learned optimal delay for a specific endpoint.
   *
   * @param provider - Provider name
   * @param endpoint - API endpoint path
   * @returns Optimal delay in milliseconds
   */
  getEndpointDelay(provider: string, endpoint: string): number {
    const k = this.key(provider, endpoint);
    const stats = this.data.endpoints[k];
    return stats?.optimalDelayMs || this.getProviderDelay(provider);
  }

  /**
   * Gets the provider-level learned delay (maximum across all endpoints).
   *
   * @param provider - Provider name
   * @returns Delay in milliseconds
   */
  getProviderDelay(provider: string): number {
    return this.data.providerDelays[provider] || 1000;
  }

  /** Recalculates the provider-level delay from all endpoint stats. */
  private updateProviderDelay(provider: string): void {
    let maxDelay = MIN_DELAY_FLOOR_MS;
    for (const stats of Object.values(this.data.endpoints)) {
      if (stats.provider === provider) {
        maxDelay = Math.max(maxDelay, stats.optimalDelayMs);
      }
    }
    this.data.providerDelays[provider] = maxDelay;
  }

  // ---------------------------------------------------------------------------
  // Retry-After Parsing
  // ---------------------------------------------------------------------------

  /**
   * Parses a Retry-After header value into seconds.
   *
   * Handles both numeric seconds and HTTP-date formats:
   * - "120" → 120
   * - "Thu, 01 Jan 2026 12:00:00 GMT" → (seconds until that time)
   *
   * @param headerValue - The Retry-After header value
   * @returns Seconds to wait, or undefined if unparseable
   */
  parseRetryAfter(headerValue: string | undefined | null): number | undefined {
    if (!headerValue) return undefined;

    const trimmed = headerValue.trim();

    // Try numeric first
    const numeric = Number(trimmed);
    if (!isNaN(numeric) && numeric > 0) {
      return numeric;
    }

    // Try HTTP-date
    try {
      const date = new Date(trimmed);
      if (!isNaN(date.getTime())) {
        const diffMs = date.getTime() - Date.now();
        return diffMs > 0 ? Math.ceil(diffMs / 1000) : 1;
      }
    } catch {
      // Not a valid date
    }

    return undefined;
  }

  // ---------------------------------------------------------------------------
  // Status & API
  // ---------------------------------------------------------------------------

  /**
   * Returns full statistics for all tracked endpoints.
   * Used by the /api/rate-limits endpoint.
   */
  getAllStats(): {
    endpoints: EndpointStats[];
    providerDelays: Record<string, number>;
    lastSaved: string;
  } {
    return {
      endpoints: Object.values(this.data.endpoints),
      providerDelays: { ...this.data.providerDelays },
      lastSaved: this.data.lastSaved,
    };
  }

  /**
   * Returns stats for a specific provider.
   */
  getProviderStats(provider: string): EndpointStats[] {
    return Object.values(this.data.endpoints).filter(
      (s) => s.provider === provider
    );
  }

  /**
   * Resets learned data for a specific provider.
   */
  resetProvider(provider: string): void {
    for (const key of Object.keys(this.data.endpoints)) {
      if (key.startsWith(`${provider}:`)) {
        delete this.data.endpoints[key];
      }
    }
    delete this.data.providerDelays[provider];
    this.dirty = true;
    this.save();
    console.log(`[${new Date().toISOString()}][rate-store] Reset all learned data for ${provider}`);
  }

  /**
   * Resets all learned data.
   */
  resetAll(): void {
    this.data.endpoints = {};
    this.data.providerDelays = {};
    this.dirty = true;
    this.save();
    console.log(`[${new Date().toISOString()}][rate-store] Reset all learned rate limit data`);
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/** Shared singleton rate limit store used across the application. */
export const rateLimitStore = new RateLimitStore();
