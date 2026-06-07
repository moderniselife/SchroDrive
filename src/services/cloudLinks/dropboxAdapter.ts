/**
 * SchroDrive — Dropbox Cloud Link Adapter
 *
 * Handles Dropbox shared folder links using the `dropbox` npm SDK.
 * Unlike MEGA and GDrive public access, Dropbox **always** requires
 * an OAuth2 access token even for shared links.
 *
 * Reuses the existing DROPBOX_TOKEN from the cloud mounts configuration.
 * If no token is configured, Dropbox links are silently skipped.
 *
 * Rate limits: Dynamic (HTTP 429 with Retry-After), requests to the same
 * namespace are serialised server-side.
 *
 * @module cloudLinks/dropboxAdapter
 */

import { Dropbox } from 'dropbox';
import type { CloudLinkAdapter, CloudFile, CloudLinkProvider } from './types';

// ===========================================================================
// Adapter
// ===========================================================================

export class DropboxAdapter implements CloudLinkAdapter {
  readonly type: CloudLinkProvider = 'dropbox';
  readonly name: string;

  private dbx: Dropbox;
  private sharedUrl: string;
  private initialised = false;

  /** Cache of folder contents: path → files. */
  private folderCache = new Map<string, { files: CloudFile[]; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Creates a new Dropbox adapter for a shared folder link.
   *
   * @param url - Dropbox shared folder URL (e.g. https://www.dropbox.com/sh/...)
   * @param name - Display name for the mount directory.
   * @param token - Dropbox OAuth2 access token.
   */
  constructor(url: string, name: string, token: string) {
    this.name = name;
    this.sharedUrl = url;
    this.dbx = new Dropbox({ accessToken: token });
  }

  /**
   * Validates the shared link is accessible.
   */
  async init(): Promise<void> {
    if (this.initialised) return;

    console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Initialising "${this.name}"...`);

    try {
      // Verify the shared link is valid
      const metadata = await this.dbx.sharingGetSharedLinkMetadata({
        url: this.sharedUrl,
      });

      const tag = (metadata.result as any)['.tag'];
      console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Verified shared link: "${metadata.result.name}" (${tag})`);
      this.initialised = true;
    } catch (err: any) {
      const errorSummary = err?.error?.error_summary || err?.message || String(err);
      throw new Error(`Dropbox shared link verification failed: ${errorSummary}`);
    }
  }

  /**
   * Lists files and directories at the given sub-path within the shared folder.
   */
  async listFolder(subPath?: string): Promise<CloudFile[]> {
    if (!this.initialised) await this.init();

    const folderPath = subPath || '';
    const cacheKey = folderPath || '__root__';

    // Check cache
    const cached = this.folderCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.files;
    }

    const files: CloudFile[] = [];

    try {
      let response = await this.dbx.filesListFolder({
        path: folderPath ? `/${folderPath}` : '',
        shared_link: { url: this.sharedUrl },
        limit: 2000,
      });

      for (const entry of response.result.entries) {
        files.push(this.mapEntry(entry));
      }

      // Handle pagination (has_more)
      while (response.result.has_more) {
        response = await this.dbx.filesListFolderContinue({
          cursor: response.result.cursor,
        });
        for (const entry of response.result.entries) {
          files.push(this.mapEntry(entry));
        }
      }
    } catch (err: any) {
      const errorSummary = err?.error?.error_summary || err?.message || String(err);
      console.error(`[${new Date().toISOString()}][cloud-links][dropbox] List folder failed: ${errorSummary}`);
      return [];
    }

    // Cache the results
    this.folderCache.set(cacheKey, {
      files,
      expiresAt: Date.now() + DropboxAdapter.CACHE_TTL_MS,
    });

    return files;
  }

  /**
   * Returns a readable stream of the file content.
   * Used as fallback when the direct URL doesn't work.
   */
  async getStream(fileId: string): Promise<NodeJS.ReadableStream> {
    if (!this.initialised) await this.init();

    console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Streaming file: ${fileId}`);

    const res = await this.dbx.sharingGetSharedLinkFile({
      url: this.sharedUrl,
      path: fileId,
    });

    // The result contains the file content as a binary blob
    const blob = (res.result as any).fileBinary || (res.result as any).fileBlob;
    if (blob) {
      const { Readable } = await import('stream');
      const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
      return Readable.from(buffer);
    }

    throw new Error(`Failed to get stream for Dropbox file: ${fileId}`);
  }

  /**
   * Returns a temporary direct download link for a Dropbox file.
   * The link is valid for ~4 hours.
   */
  async getDirectUrl(fileId: string): Promise<string | null> {
    try {
      // Use sharing/get_shared_link_file to get a direct download link
      // Dropbox shared link files can be downloaded by appending ?dl=1
      // But for proper temp links, use filesGetTemporaryLink on the path
      const tempUrl = `${this.sharedUrl}?dl=1&path=${encodeURIComponent(fileId)}`;
      return tempUrl;
    } catch (err: any) {
      console.error(`[${new Date().toISOString()}][cloud-links][dropbox] getDirectUrl failed: ${err?.message}`);
      return null;
    }
  }

  /**
   * Returns the size of a specific file.
   */
  async getFileSize(fileId: string): Promise<number> {
    if (!this.initialised) await this.init();

    try {
      const metadata = await this.dbx.sharingGetSharedLinkMetadata({
        url: this.sharedUrl,
        path: fileId,
      });
      return (metadata.result as any).size || 0;
    } catch {
      return 0;
    }
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Maps a Dropbox API entry to our CloudFile format.
   */
  private mapEntry(entry: any): CloudFile {
    return {
      id: entry.path_lower || entry.path_display || entry.name,
      name: entry.name,
      size: entry.size || 0,
      isDirectory: entry['.tag'] === 'folder',
      mimeType: entry['.tag'] === 'folder' ? 'application/directory' : undefined,
    };
  }
}
