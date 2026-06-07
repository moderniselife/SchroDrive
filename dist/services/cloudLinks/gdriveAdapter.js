"use strict";
/**
 * SchroDrive — Google Drive Cloud Link Adapter
 *
 * Handles public Google Drive shared folder links using the `googleapis` SDK.
 * Only requires a free API key (no OAuth2) for public "Anyone with the link" folders.
 *
 * Unlike MEGA, Google Drive provides direct download URLs, so the bridge
 * can 302 redirect without proxying file content through the server.
 *
 * Rate limits: 1,000,000 quota units/min per project, files.list = 100 units,
 * files.download = 200 units. 1TB egress/day/project.
 *
 * @module cloudLinks/gdriveAdapter
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GDriveAdapter = void 0;
const googleapis_1 = require("googleapis");
// ===========================================================================
// Helpers
// ===========================================================================
/**
 * Extracts the folder ID from various Google Drive URL formats.
 *
 * Supports:
 * - https://drive.google.com/drive/folders/{ID}
 * - https://drive.google.com/drive/folders/{ID}?usp=sharing
 * - https://drive.google.com/open?id={ID}
 * - Just a raw folder ID
 */
function extractFolderId(url) {
    // Check for /folders/{ID} pattern
    const foldersMatch = url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (foldersMatch)
        return foldersMatch[1];
    // Check for ?id={ID} pattern
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (idMatch)
        return idMatch[1];
    // Assume the whole string is a folder ID
    return url.trim();
}
// ===========================================================================
// Adapter
// ===========================================================================
class GDriveAdapter {
    /**
     * Creates a new Google Drive adapter for a public shared folder.
     *
     * @param url - Google Drive shared folder URL or folder ID.
     * @param name - Display name for the mount directory.
     * @param apiKey - Google Cloud API key with Drive API enabled.
     */
    constructor(url, name, apiKey) {
        this.type = 'gdrive';
        this.initialised = false;
        /** Cache of folder contents: folderId → files. */
        this.folderCache = new Map();
        this.name = name;
        this.apiKey = apiKey;
        this.folderId = extractFolderId(url);
        this.drive = googleapis_1.google.drive({ version: 'v3', auth: apiKey });
    }
    /**
     * Validates the folder is accessible with the API key.
     */
    async init() {
        if (this.initialised)
            return;
        console.log(`[${new Date().toISOString()}][cloud-links][gdrive] Initialising "${this.name}" (folder: ${this.folderId})...`);
        try {
            // Verify the folder exists and is accessible
            const res = await this.drive.files.get({
                fileId: this.folderId,
                fields: 'id, name, mimeType',
            });
            if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
                throw new Error(`URL does not point to a folder (got: ${res.data.mimeType})`);
            }
            console.log(`[${new Date().toISOString()}][cloud-links][gdrive] Verified folder "${res.data.name}" for "${this.name}"`);
            this.initialised = true;
        }
        catch (err) {
            if (err?.code === 404 || err?.response?.status === 404) {
                throw new Error(`Google Drive folder not found or not public: ${this.folderId}`);
            }
            throw err;
        }
    }
    /**
     * Lists files and directories at the given sub-path.
     * Uses pagination to handle large folders (1000+ files).
     */
    async listFolder(subPath) {
        if (!this.initialised)
            await this.init();
        // Resolve the target folder ID from the sub-path
        const targetFolderId = subPath ? await this.resolvePathToId(subPath) : this.folderId;
        if (!targetFolderId)
            return [];
        // Check cache
        const cached = this.folderCache.get(targetFolderId);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.files;
        }
        const files = [];
        let pageToken;
        do {
            const res = await this.drive.files.list({
                q: `'${targetFolderId}' in parents and trashed=false`,
                fields: 'nextPageToken, files(id, name, mimeType, size)',
                pageSize: 1000,
                pageToken,
                orderBy: 'name',
            });
            for (const f of res.data.files || []) {
                files.push({
                    id: f.id,
                    name: f.name,
                    size: Number(f.size || 0),
                    isDirectory: f.mimeType === 'application/vnd.google-apps.folder',
                    mimeType: f.mimeType || undefined,
                });
            }
            pageToken = res.data.nextPageToken || undefined;
        } while (pageToken);
        // Cache the results
        this.folderCache.set(targetFolderId, {
            files,
            expiresAt: Date.now() + GDriveAdapter.CACHE_TTL_MS,
        });
        return files;
    }
    /**
     * Returns a readable stream of the file content.
     * Used as fallback when the media player doesn't follow redirects.
     */
    async getStream(fileId) {
        if (!this.initialised)
            await this.init();
        console.log(`[${new Date().toISOString()}][cloud-links][gdrive] Streaming file: ${fileId}`);
        const res = await this.drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
        return res.data;
    }
    /**
     * Returns a direct download URL for a public GDrive file.
     * This is the preferred path — the bridge 302 redirects to this URL.
     */
    async getDirectUrl(fileId) {
        return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${this.apiKey}`;
    }
    /**
     * Returns the size of a specific file.
     */
    async getFileSize(fileId) {
        if (!this.initialised)
            await this.init();
        const res = await this.drive.files.get({
            fileId,
            fields: 'size',
        });
        return Number(res.data.size || 0);
    }
    // -------------------------------------------------------------------------
    // Private Helpers
    // -------------------------------------------------------------------------
    /**
     * Resolves a sub-path (e.g. "Season 01/S01E01.mkv") to a Google Drive folder ID.
     * Walks the path one segment at a time via API queries.
     */
    async resolvePathToId(subPath) {
        const segments = subPath.split('/').filter(Boolean);
        let currentId = this.folderId;
        for (const seg of segments) {
            const res = await this.drive.files.list({
                q: `'${currentId}' in parents and name='${seg.replace(/'/g, "\\'")}' and trashed=false`,
                fields: 'files(id, mimeType)',
                pageSize: 1,
            });
            const match = res.data.files?.[0];
            if (!match)
                return null;
            currentId = match.id;
        }
        return currentId;
    }
}
exports.GDriveAdapter = GDriveAdapter;
GDriveAdapter.CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
