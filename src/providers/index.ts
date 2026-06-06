/**
 * SchroDrive — Provider Abstraction Layer
 *
 * Defines the standard interface for debrid providers and a registry
 * for managing them. Adding a new provider requires only implementing
 * the DebridProvider interface and calling registry.register().
 *
 * @module providers
 */

// ===========================================================================
// Types
// ===========================================================================

/** Normalised torrent representation returned by all providers. */
export interface TorrentInfo {
  /** Unique torrent identifier from the provider. */
  id: string;
  /** Human-readable torrent name. */
  name: string;
  /** Original filename from the provider (may differ from name). */
  filename?: string;
  /** Provider-specific status string (e.g. "downloaded", "seeding"). */
  status: string;
  /** Download progress as a percentage (0–100). */
  progress: number;
  /** Total size in bytes. */
  bytes: number;
  /** Files contained within this torrent. */
  files: TorrentFile[];
  /** When the torrent was added to the provider. */
  addedAt?: Date;
  /** Raw provider-specific data for pass-through to API consumers. */
  raw?: any;
}

/** A single file within a torrent. */
export interface TorrentFile {
  /** File identifier (provider-specific). */
  id: string;
  /** Human-readable filename. */
  name: string;
  /** Full path within the torrent. */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Whether this file has been selected for download. */
  selected: boolean;
}

/** Normalised download representation (completed/unrestricted files). */
export interface DownloadInfo {
  /** Unique download identifier from the provider. */
  id: string;
  /** Human-readable download name. */
  name: string;
  /** Direct download URL (if available). */
  url?: string;
  /** File size in bytes. */
  size: number;
  /** Provider-specific status string. */
  status: string;
  /** Download progress as a percentage (0–100). */
  progress: number;
  /** The type of download source. */
  type: 'torrent' | 'web' | 'usenet';
  /** Raw provider-specific data for pass-through to API consumers. */
  raw?: any;
}

/** Result of adding a magnet link to a provider. */
export interface AddMagnetResult {
  /** Provider-assigned torrent/transfer ID. */
  id: string;
  /** Provider-assigned URI (e.g. RealDebrid returns a resource URI). */
  uri?: string;
}

/**
 * Virtual directory representing a single torrent in the WebDAV bridge.
 * These types are authoritative — webdavBridge.ts imports them from here.
 */
export interface VirtualDirectory {
  /** Unique torrent identifier from the provider. */
  id: string;
  /** Sanitised name, safe for filesystem paths. */
  name: string;
  /** Original unsanitised torrent name. */
  originalName: string;
  /** Files within this torrent directory. */
  files: VirtualFile[];
}

/** A virtual file within a VirtualDirectory. */
export interface VirtualFile {
  /** File identifier (provider-specific). */
  id: string;
  /** Sanitised filename, safe for filesystem paths. */
  name: string;
  /** File size in bytes. */
  size: number;
  /** Index of this file's corresponding link in the torrent's links array (RD only). */
  linkIndex?: number;
}

/**
 * Strategy for distributing magnet additions across providers.
 * - `'all'`: Add to ALL configured providers (redundancy).
 * - `'failover'`: Try first provider, fall back to next on failure.
 * - `'single'`: Only add to the first configured provider.
 */
export type AddStrategy = 'all' | 'failover' | 'single';

// ===========================================================================
// DebridProvider Interface
// ===========================================================================

/**
 * Contract that all debrid provider implementations must satisfy.
 *
 * Required methods cover the core lifecycle: status checks, torrent CRUD,
 * WebDAV bridge support, and mount configuration. Optional methods (marked
 * with `?`) are implemented only by providers that support those features
 * (e.g. TorBox has web/usenet downloads, RealDebrid doesn't).
 */
export interface DebridProvider {
  /** Unique lowercase provider identifier (e.g. `'realdebrid'`). */
  readonly id: string;
  /** Human-readable display name (e.g. `'RealDebrid'`). */
  readonly displayName: string;

  // --- Status ---------------------------------------------------------------

  /** Returns `true` if the provider has the required API credentials configured. */
  isConfigured(): boolean;
  /** Returns `true` if the provider is currently in a rate-limit backoff period. */
  isRateLimited(): boolean;
  /** Returns the remaining wait time (seconds) before requests can resume. */
  getWaitTime(): number;

  // --- Torrent Operations ---------------------------------------------------

  /** Fetches the complete list of torrents from the provider. */
  listTorrents(): Promise<TorrentInfo[]>;
  /** Async generator yielding torrent pages for SSE streaming (optional). */
  listTorrentsStream?(): AsyncGenerator<TorrentInfo[], void, unknown>;
  /** Adds a magnet link to the provider for downloading. */
  addMagnet(magnet: string, name?: string): Promise<AddMagnetResult>;
  /** Checks whether a torrent with a matching title already exists. */
  checkExisting(title: string): Promise<boolean>;
  /** Determines whether a torrent is dead (failed/errored/stalled). */
  isTorrentDead(torrent: TorrentInfo): boolean;
  /** Deletes a torrent from the provider by its ID. */
  deleteTorrent(torrentId: string): Promise<void>;
  /** Returns the info hash or magnet URI for a torrent (used for repair). */
  getInfoHash?(torrentId: string): Promise<string | null>;
  /**
   * Attempts to repair a dead torrent by re-adding its magnet to the same provider.
   * Returns true if repair succeeded, false if the torrent should be replaced.
   */
  repairTorrent?(torrentId: string): Promise<boolean>;

  // --- Download Operations (optional — TB has web/usenet, RD doesn't) -------

  /** Lists all downloads (completed/unrestricted files). */
  listDownloads?(): Promise<DownloadInfo[]>;
  /** Async generator yielding download pages for SSE streaming. */
  listDownloadsStream?(): AsyncGenerator<DownloadInfo[], void, unknown>;
  /** Lists web downloads (TorBox only). */
  listWebDownloads?(): Promise<DownloadInfo[]>;
  /** Lists Usenet downloads (TorBox only). */
  listUsenetDownloads?(): Promise<DownloadInfo[]>;

  // --- WebDAV Bridge Support ------------------------------------------------

  /** Fetches completed torrents as virtual directories for the WebDAV bridge. */
  fetchDirectories(): Promise<VirtualDirectory[]>;
  /** Fetches detailed file info for a single torrent (RD only — TB embeds files). */
  fetchTorrentFiles?(torrentId: string): Promise<VirtualFile[]>;
  /** Resolves a direct download URL for a specific file within a torrent. */
  resolveDownloadUrl(torrentId: string, fileId: string, linkIndex?: number): Promise<string | null>;

  // --- Mount Configuration --------------------------------------------------

  /** Returns `true` if the provider has native WebDAV credentials configured. */
  hasDirectWebDAV(): boolean;
  /** Returns `true` if the provider has an API key configured. */
  hasApiKey(): boolean;
  /** Returns native WebDAV connection details, or `null` if not configured. */
  getWebDAVConfig(): { url: string; username: string; password: string } | null;
  /** Returns the local port the WebDAV bridge should listen on for this provider. */
  getBridgePort(): number;
}

// ===========================================================================
// ProviderRegistry
// ===========================================================================

import { config } from '../core/config';

/**
 * Manages the lifecycle and lookup of registered debrid providers.
 *
 * Providers self-register on module load via `registry.register()`.
 * Consumers query the registry for configured/ordered providers and
 * use strategy-based methods for cross-provider operations.
 */
class ProviderRegistry {
  private providers: Map<string, DebridProvider> = new Map();

  /**
   * Registers a provider instance. Typically called at module level
   * by each provider's source file.
   *
   * @param provider - The provider instance to register.
   */
  register(provider: DebridProvider): void {
    this.providers.set(provider.id, provider);
    console.log(`[${new Date().toISOString()}][providers] registered: ${provider.displayName} (${provider.id})`);
  }

  /**
   * Retrieves a provider by its unique identifier.
   *
   * @param id - The provider identifier (e.g. `'realdebrid'`).
   * @returns The provider instance, or `undefined` if not registered.
   */
  get(id: string): DebridProvider | undefined {
    return this.providers.get(id);
  }

  /** Returns all registered providers (configured or not). */
  all(): DebridProvider[] {
    return Array.from(this.providers.values());
  }

  /** Returns only providers that have valid API credentials configured. */
  configured(): DebridProvider[] {
    return this.all().filter(p => p.isConfigured());
  }

  /**
   * Returns configured providers in the user's preferred order.
   *
   * The order is determined by the `PROVIDERS` environment variable
   * (e.g. `'torbox,realdebrid'`). Any configured providers not listed
   * in the env var are appended at the end.
   *
   * @returns An ordered array of configured providers.
   */
  ordered(): DebridProvider[] {
    const order = config.providers; // e.g. ['torbox', 'realdebrid']
    const configured = this.configured();
    const ordered: DebridProvider[] = [];
    for (const id of order) {
      const p = configured.find(c => c.id === id);
      if (p) ordered.push(p);
    }
    // Append any configured providers not in the order list
    for (const p of configured) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    return ordered;
  }

  /**
   * Checks all configured providers for an existing torrent with a similar title.
   *
   * Uses bi-directional substring matching (same as individual provider
   * implementations) to catch partial matches.
   *
   * @param title - The title to search for.
   * @returns An object indicating whether a match was found and which provider.
   */
  async checkExistingAcrossAll(title: string): Promise<{ exists: boolean; provider?: string }> {
    for (const p of this.configured()) {
      try {
        if (await p.checkExisting(title)) {
          return { exists: true, provider: p.id };
        }
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][providers] ${p.id} duplicate check failed`, { err: e?.message });
      }
    }
    return { exists: false };
  }

  /**
   * Adds a magnet link using the configured strategy.
   *
   * - `'all'` (default): Add to ALL configured providers for redundancy.
   * - `'failover'`: Try first provider, fall back to next on failure.
   * - `'single'`: Only add to the first configured provider.
   *
   * @param magnet - The magnet URI to add.
   * @param name - Optional human-readable name for the torrent.
   * @param strategy - The distribution strategy. Defaults to `'all'`.
   * @returns An object containing per-provider results.
   */
  async addMagnetWithStrategy(
    magnet: string,
    name?: string,
    strategy: AddStrategy = 'all',
  ): Promise<{ results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> }> {
    const providers = this.ordered();
    const results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> = [];

    for (const p of providers) {
      try {
        console.log(`[${new Date().toISOString()}][providers] adding magnet to ${p.id}`, { name });
        const result = await p.addMagnet(magnet, name);
        console.log(`[${new Date().toISOString()}][providers] ✅ added to ${p.id}`, { id: result.id });
        results.push({ provider: p.id, success: true, result });

        if (strategy === 'failover' || strategy === 'single') {
          break; // Success — don't try more providers
        }
      } catch (err: any) {
        const error = err?.message || String(err);
        console.warn(`[${new Date().toISOString()}][providers] ❌ ${p.id} add failed`, { error });
        results.push({ provider: p.id, success: false, error });

        if (strategy === 'single') {
          break; // Only try one
        }
        // 'all' and 'failover' continue to next provider
      }
    }

    return { results };
  }
}

/** Singleton registry instance shared across the application. */
export const registry = new ProviderRegistry();

// ===========================================================================
// Auto-register providers
// ===========================================================================

// Import providers here so they self-register on module load.
// These imports MUST come AFTER registry is defined to avoid circular
// import issues — each provider file imports registry from this module.
import './realdebrid';
import './torbox';
import './alldebrid';
import './premiumize';
