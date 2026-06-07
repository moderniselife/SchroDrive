/**
 * SchroDrive — MEGA Cloud Link Adapter
 *
 * Handles public MEGA shared folder links using the `megajs` npm package.
 * No MEGA account is required — the encryption key is embedded in the URL.
 *
 * **Important**: MEGA uses client-side encryption, so there are no direct
 * download URLs. Files must be streamed through the bridge (decrypted by
 * megajs), which means MEGA files use server bandwidth.
 *
 * Rate limits: ~1–5GB per 6-hour window (dynamic, IP-based) for free/anonymous.
 *
 * @module cloudLinks/megaAdapter
 */

import { File } from 'megajs';
import type { CloudLinkAdapter, CloudFile, CloudLinkProvider } from './types';

// ===========================================================================
// File Node Cache
// ===========================================================================

/** Flat map of file ID → MEGA File node for fast lookup. */
type MegaFileMap = Map<string, any>;

// ===========================================================================
// Adapter
// ===========================================================================

export class MegaAdapter implements CloudLinkAdapter {
  readonly type: CloudLinkProvider = 'mega';
  readonly name: string;

  private folder: any;
  private loaded = false;
  private fileMap: MegaFileMap = new Map();
  private url: string;

  /**
   * Creates a new MEGA adapter for a public shared folder link.
   * The MEGA URL is validated and loaded lazily during {@link init}.
   *
   * @param url - MEGA public folder URL (e.g. https://mega.nz/folder/ID#KEY)
   * @param name - Display name for the mount directory.
   */
  constructor(url: string, name: string) {
    this.name = name;
    this.url = url;
    // Defer File.fromURL() to init() so invalid URLs don't crash the constructor
    this.folder = null;
  }

  /**
   * Load the folder's attribute tree from MEGA.
   * This validates the URL and fetches the full directory structure in one API call.
   */
  async init(): Promise<void> {
    if (this.loaded) return;

    console.log(`[${new Date().toISOString()}][cloud-links][mega] Loading attributes for "${this.name}"...`);

    // Parse the MEGA URL — throws if the URL has no hash/decryption key
    this.folder = File.fromURL(this.url);

    await this.folder.loadAttributes();
    this.loaded = true;

    // Build flat file map for fast ID-based lookups
    this.buildFileMap(this.folder);

    const totalFiles = this.fileMap.size;
    console.log(`[${new Date().toISOString()}][cloud-links][mega] Loaded "${this.name}" — ${totalFiles} files/directories`);
  }

  /**
   * Recursively indexes all files in the folder tree for fast ID lookup.
   */
  private buildFileMap(node: any): void {
    if (node.children) {
      for (const child of node.children) {
        // Use nodeId if available, fall back to a deterministic path-based ID
        const id = child.nodeId || child.downloadId?.[1] || `${node.nodeId || 'root'}/${child.name}`;
        this.fileMap.set(id, child);
        if (child.directory) {
          this.buildFileMap(child);
        }
      }
    }
  }

  /**
   * Lists files and directories at the given sub-path.
   */
  async listFolder(subPath?: string): Promise<CloudFile[]> {
    if (!this.loaded) await this.init();

    let target = this.folder;

    if (subPath && subPath !== '' && subPath !== '/') {
      target = this.navigateToPath(subPath);
      if (!target) {
        console.warn(`[${new Date().toISOString()}][cloud-links][mega] Path not found: ${subPath}`);
        return [];
      }
    }

    if (!target.children || target.children.length === 0) {
      return [];
    }

    return target.children.map((child: any) => ({
      id: child.nodeId || child.downloadId?.[1] || `${target.nodeId || 'root'}/${child.name}`,
      name: child.name || 'Unknown',
      size: child.size || 0,
      isDirectory: !!child.directory,
      mimeType: child.directory ? 'application/directory' : this.guessMimeType(child.name),
    }));
  }

  /**
   * Returns a readable stream of a file's decrypted content.
   * MEGA encrypts all files client-side — megajs handles decryption transparently.
   */
  async getStream(fileId: string): Promise<NodeJS.ReadableStream> {
    if (!this.loaded) await this.init();

    const file = this.fileMap.get(fileId);
    if (!file) {
      throw new Error(`MEGA file not found: ${fileId}`);
    }

    if (file.directory) {
      throw new Error(`Cannot stream a directory: ${file.name}`);
    }

    console.log(`[${new Date().toISOString()}][cloud-links][mega] Streaming file: ${file.name} (${this.formatSize(file.size)})`);
    return file.download() as NodeJS.ReadableStream;
  }

  /**
   * MEGA does not support direct download URLs (encrypted streams only).
   */
  async getDirectUrl(_fileId: string): Promise<string | null> {
    return null;
  }

  /**
   * Returns the size of a specific file.
   */
  async getFileSize(fileId: string): Promise<number> {
    if (!this.loaded) await this.init();
    const file = this.fileMap.get(fileId);
    return file?.size || 0;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Navigates to a sub-path within the folder tree.
   * Path segments are matched case-insensitively.
   */
  private navigateToPath(subPath: string): any | null {
    const segments = subPath.split('/').filter(Boolean);
    let current = this.folder;

    for (const seg of segments) {
      if (!current.children) return null;
      const match = current.children.find(
        (c: any) => c.name?.toLowerCase() === seg.toLowerCase()
      );
      if (!match) return null;
      current = match;
    }

    return current;
  }

  /**
   * Guesses MIME type from file extension.
   */
  private guessMimeType(filename: string): string {
    const ext = (filename || '').split('.').pop()?.toLowerCase();
    const mimeMap: Record<string, string> = {
      mkv: 'video/x-matroska',
      mp4: 'video/mp4',
      avi: 'video/x-msvideo',
      wmv: 'video/x-ms-wmv',
      mov: 'video/quicktime',
      flv: 'video/x-flv',
      ts: 'video/mp2t',
      srt: 'application/x-subrip',
      ass: 'text/x-ssa',
      sub: 'text/x-sub',
      nfo: 'text/plain',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      mp3: 'audio/mpeg',
      flac: 'audio/flac',
    };
    return mimeMap[ext || ''] || 'application/octet-stream';
  }

  /**
   * Formats a byte count as a human-readable string.
   */
  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)}MB`;
    return `${(bytes / 1073741824).toFixed(2)}GB`;
  }
}
