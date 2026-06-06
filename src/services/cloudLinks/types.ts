/**
 * SchroDrive — Cloud Link Manager Types
 *
 * Shared types for the Cloud Link Manager service, which mounts public
 * shared folder links (Mega, Google Drive, Dropbox) as FUSE directories.
 *
 * @module cloudLinks/types
 */

// ===========================================================================
// Configuration
// ===========================================================================

/** Supported cloud link provider types. */
export type CloudLinkProvider = 'mega' | 'gdrive' | 'dropbox';

/**
 * A configured cloud link from the user's config file or env var.
 *
 * Example:
 * ```json
 * {
 *   "type": "mega",
 *   "url": "https://mega.nz/folder/sKxxzSYI#cz5spJH9KLxotRD--a5c2A",
 *   "name": "Australian.Survivor"
 * }
 * ```
 */
export interface CloudLinkConfig {
  /** Cloud provider type. */
  type: CloudLinkProvider;
  /** Public shared folder URL. */
  url: string;
  /** Display name for the mount directory. */
  name: string;
}

// ===========================================================================
// Virtual Filesystem
// ===========================================================================

/** A file or directory in a cloud link folder. */
export interface CloudFile {
  /** Provider-specific file identifier. */
  id: string;
  /** File or directory name. */
  name: string;
  /** File size in bytes (0 for directories). */
  size: number;
  /** Whether this entry is a directory. */
  isDirectory: boolean;
  /** MIME type (if known). */
  mimeType?: string;
}

// ===========================================================================
// Adapter Interface
// ===========================================================================

/**
 * Adapter interface for cloud link providers.
 *
 * Each cloud storage service implements this interface to provide
 * folder listing and file streaming capabilities for public shared links.
 */
export interface CloudLinkAdapter {
  /** Provider type identifier. */
  readonly type: CloudLinkProvider;

  /** Human-readable name of the configured link. */
  readonly name: string;

  /**
   * Initialise the adapter (load folder attributes, authenticate, etc.).
   * Must be called before listFolder() or getStream().
   */
  init(): Promise<void>;

  /**
   * List files and directories at the given sub-path.
   *
   * @param subPath - Relative path within the shared folder (empty = root).
   * @returns Array of files and directories.
   */
  listFolder(subPath?: string): Promise<CloudFile[]>;

  /**
   * Get a readable stream for a file.
   *
   * @param fileId - Provider-specific file identifier.
   * @returns A Node.js ReadableStream of the file content.
   */
  getStream(fileId: string): Promise<NodeJS.ReadableStream>;

  /**
   * Get a direct download URL for a file (if supported).
   * Returns null for providers that require stream proxying (e.g. MEGA).
   *
   * @param fileId - Provider-specific file identifier.
   * @returns Direct download URL, or null if proxying is required.
   */
  getDirectUrl?(fileId: string): Promise<string | null>;

  /**
   * Get the size of a specific file.
   *
   * @param fileId - Provider-specific file identifier.
   * @returns File size in bytes, or 0 if unknown.
   */
  getFileSize(fileId: string): Promise<number>;
}
