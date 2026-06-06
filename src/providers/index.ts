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
  /**
   * Uploads a .torrent file buffer to the debrid provider.
   * Optional — providers that don't support this should not implement it.
   */
  addTorrentFile?(fileBuffer: Buffer, name?: string): Promise<AddMagnetResult>;
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

export { registry } from './registry';

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

