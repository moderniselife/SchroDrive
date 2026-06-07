"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MegaAdapter = void 0;
const megajs_1 = require("megajs");
// ===========================================================================
// Adapter
// ===========================================================================
class MegaAdapter {
    /**
     * Creates a new MEGA adapter for a public shared folder link.
     *
     * @param url - MEGA public folder URL (e.g. https://mega.nz/folder/ID#KEY)
     * @param name - Display name for the mount directory.
     */
    constructor(url, name) {
        this.type = 'mega';
        this.loaded = false;
        this.fileMap = new Map();
        this.name = name;
        this.folder = megajs_1.File.fromURL(url);
    }
    /**
     * Load the folder's attribute tree from MEGA.
     * This fetches the full directory structure in one API call.
     */
    async init() {
        if (this.loaded)
            return;
        console.log(`[${new Date().toISOString()}][cloud-links][mega] Loading attributes for "${this.name}"...`);
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
    buildFileMap(node) {
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
    async listFolder(subPath) {
        if (!this.loaded)
            await this.init();
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
        return target.children.map((child) => ({
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
    async getStream(fileId) {
        if (!this.loaded)
            await this.init();
        const file = this.fileMap.get(fileId);
        if (!file) {
            throw new Error(`MEGA file not found: ${fileId}`);
        }
        if (file.directory) {
            throw new Error(`Cannot stream a directory: ${file.name}`);
        }
        console.log(`[${new Date().toISOString()}][cloud-links][mega] Streaming file: ${file.name} (${this.formatSize(file.size)})`);
        return file.download();
    }
    /**
     * MEGA does not support direct download URLs (encrypted streams only).
     */
    async getDirectUrl(_fileId) {
        return null;
    }
    /**
     * Returns the size of a specific file.
     */
    async getFileSize(fileId) {
        if (!this.loaded)
            await this.init();
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
    navigateToPath(subPath) {
        const segments = subPath.split('/').filter(Boolean);
        let current = this.folder;
        for (const seg of segments) {
            if (!current.children)
                return null;
            const match = current.children.find((c) => c.name?.toLowerCase() === seg.toLowerCase());
            if (!match)
                return null;
            current = match;
        }
        return current;
    }
    /**
     * Guesses MIME type from file extension.
     */
    guessMimeType(filename) {
        const ext = (filename || '').split('.').pop()?.toLowerCase();
        const mimeMap = {
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
    formatSize(bytes) {
        if (bytes < 1024)
            return `${bytes}B`;
        if (bytes < 1048576)
            return `${(bytes / 1024).toFixed(1)}KB`;
        if (bytes < 1073741824)
            return `${(bytes / 1048576).toFixed(1)}MB`;
        return `${(bytes / 1073741824).toFixed(2)}GB`;
    }
}
exports.MegaAdapter = MegaAdapter;
