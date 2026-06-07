"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DropboxAdapter = void 0;
const dropbox_1 = require("dropbox");
// ===========================================================================
// Adapter
// ===========================================================================
class DropboxAdapter {
    /**
     * Creates a new Dropbox adapter for a shared folder link.
     *
     * @param url - Dropbox shared folder URL (e.g. https://www.dropbox.com/sh/...)
     * @param name - Display name for the mount directory.
     * @param token - Dropbox OAuth2 access token.
     */
    constructor(url, name, token) {
        this.type = 'dropbox';
        this.initialised = false;
        /** Cache of folder contents: path → files. */
        this.folderCache = new Map();
        this.name = name;
        this.sharedUrl = url;
        this.dbx = new dropbox_1.Dropbox({ accessToken: token });
    }
    /**
     * Validates the shared link is accessible.
     */
    async init() {
        if (this.initialised)
            return;
        console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Initialising "${this.name}"...`);
        try {
            // Verify the shared link is valid
            const metadata = await this.dbx.sharingGetSharedLinkMetadata({
                url: this.sharedUrl,
            });
            const tag = metadata.result['.tag'];
            console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Verified shared link: "${metadata.result.name}" (${tag})`);
            this.initialised = true;
        }
        catch (err) {
            const errorSummary = err?.error?.error_summary || err?.message || String(err);
            throw new Error(`Dropbox shared link verification failed: ${errorSummary}`);
        }
    }
    /**
     * Lists files and directories at the given sub-path within the shared folder.
     */
    async listFolder(subPath) {
        if (!this.initialised)
            await this.init();
        const folderPath = subPath || '';
        const cacheKey = folderPath || '__root__';
        // Check cache
        const cached = this.folderCache.get(cacheKey);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.files;
        }
        const files = [];
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
        }
        catch (err) {
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
    async getStream(fileId) {
        if (!this.initialised)
            await this.init();
        console.log(`[${new Date().toISOString()}][cloud-links][dropbox] Streaming file: ${fileId}`);
        const res = await this.dbx.sharingGetSharedLinkFile({
            url: this.sharedUrl,
            path: fileId,
        });
        // The result contains the file content as a binary blob
        const blob = res.result.fileBinary || res.result.fileBlob;
        if (blob) {
            const { Readable } = await Promise.resolve().then(() => __importStar(require('stream')));
            const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
            return Readable.from(buffer);
        }
        throw new Error(`Failed to get stream for Dropbox file: ${fileId}`);
    }
    /**
     * Returns a temporary direct download link for a Dropbox file.
     * The link is valid for ~4 hours.
     */
    async getDirectUrl(fileId) {
        try {
            // Use sharing/get_shared_link_file to get a direct download link
            // Dropbox shared link files can be downloaded by appending ?dl=1
            // But for proper temp links, use filesGetTemporaryLink on the path
            const tempUrl = `${this.sharedUrl}?dl=1&path=${encodeURIComponent(fileId)}`;
            return tempUrl;
        }
        catch (err) {
            console.error(`[${new Date().toISOString()}][cloud-links][dropbox] getDirectUrl failed: ${err?.message}`);
            return null;
        }
    }
    /**
     * Returns the size of a specific file.
     */
    async getFileSize(fileId) {
        if (!this.initialised)
            await this.init();
        try {
            const metadata = await this.dbx.sharingGetSharedLinkMetadata({
                url: this.sharedUrl,
                path: fileId,
            });
            return metadata.result.size || 0;
        }
        catch {
            return 0;
        }
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Maps a Dropbox API entry to our CloudFile format.
     */
    mapEntry(entry) {
        return {
            id: entry.path_lower || entry.path_display || entry.name,
            name: entry.name,
            size: entry.size || 0,
            isDirectory: entry['.tag'] === 'folder',
            mimeType: entry['.tag'] === 'folder' ? 'application/directory' : undefined,
        };
    }
}
exports.DropboxAdapter = DropboxAdapter;
DropboxAdapter.CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
