/**
 * SchroDrive — STRM Short-Code Service
 *
 * Provides stable, permanent URLs for media files by mapping 16-character
 * alphanumeric short-codes to ephemeral debrid provider download URLs.
 *
 * Inspired by zurg-serverless's STRM cache approach:
 * - Media players get a permanent URL: `http://host:9120/strm/{CODE}`
 * - The service resolves the code to the current download URL via 302 redirect
 * - Download URLs auto-refresh when expired (7-day TTL)
 * - Broken content falls back to a `not_found.mp4` error video
 *
 * Benefits:
 * - URLs never change even when CDN links expire
 * - Media player bookmarks/playlists remain valid indefinitely
 * - Reduces redundant API calls via cached download links
 *
 * @module strmService
 */

import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from '../core/config';
import {
  getStrmCode,
  upsertStrmCode,
  findStrmByContent,
  pruneExpiredStrmCodes,
  type StrmCodeRecord,
} from '../core/db';

// ===========================================================================
// Constants
// ===========================================================================

/** Default port for the STRM service. */
const STRM_PORT = Number(process.env.STRM_PORT || 9120);

/** TTL for STRM codes in milliseconds (7 days). */
const STRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Characters used for generating short-codes (alphanumeric, no ambiguous chars). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Length of generated short-codes. */
const CODE_LENGTH = 16;

/** Path to the error video file. */
const NOT_FOUND_VIDEO_PATH = path.resolve(__dirname, '../../assets/not_found.mp4');

// ===========================================================================
// Code Generation
// ===========================================================================

/**
 * Generates a cryptographically random alphanumeric short-code.
 * Uses `crypto.getRandomValues` for uniform distribution.
 *
 * @param length - Length of the code to generate. Default: 16.
 * @returns A random alphanumeric string.
 */
function generateCode(length: number = CODE_LENGTH): string {
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += CODE_CHARS[values[i] % CODE_CHARS.length];
  }
  return result;
}

// ===========================================================================
// Download URL Resolution
// ===========================================================================

/**
 * Callback type for resolving a fresh download URL from a provider.
 * The STRM service doesn't directly depend on providers — it receives
 * a resolver callback from the caller (typically the WebDAV bridge).
 */
export type DownloadUrlResolver = (
  provider: string,
  torrentId: string,
  fileId: string,
) => Promise<string | null>;

/** The registered download URL resolver. Set by the WebDAV bridge at startup. */
let urlResolver: DownloadUrlResolver | null = null;

/**
 * Registers a download URL resolver function.
 * Called by the WebDAV bridge during initialisation.
 */
export function setStrmUrlResolver(resolver: DownloadUrlResolver): void {
  urlResolver = resolver;
  console.log(`[${new Date().toISOString()}][strm] Download URL resolver registered`);
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Gets or creates a STRM short-code for a specific file.
 * If a code already exists for this provider/torrent/file combination,
 * it's reused (even if the download URL has expired — it will be
 * refreshed on next access).
 *
 * @param provider - The debrid provider name.
 * @param torrentId - The provider-side torrent identifier.
 * @param fileId - The file identifier within the torrent.
 * @param downloadUrl - Optional current download URL to cache.
 * @returns The 16-character short-code.
 */
export function getOrCreateStrmCode(
  provider: string,
  torrentId: string,
  fileId: string,
  downloadUrl?: string,
): string {
  // Check if a code already exists for this content
  const existing = findStrmByContent(provider, torrentId, fileId);
  if (existing) {
    // Refresh the download URL if we have a fresh one
    if (downloadUrl && downloadUrl !== existing.downloadUrl) {
      upsertStrmCode(
        existing.code,
        provider,
        torrentId,
        fileId,
        downloadUrl,
        Date.now() + STRM_TTL_MS,
      );
    }
    return existing.code;
  }

  // Generate a new unique code
  const code = generateCode();
  upsertStrmCode(
    code,
    provider,
    torrentId,
    fileId,
    downloadUrl || null,
    Date.now() + STRM_TTL_MS,
  );

  return code;
}

/**
 * Resolves a STRM short-code to a download URL.
 * If the cached URL has expired, attempts to refresh it from the provider.
 *
 * @param code - The 16-character short-code.
 * @returns The download URL, or null if resolution fails.
 */
export async function resolveStrmCode(code: string): Promise<string | null> {
  const entry = getStrmCode(code);
  if (!entry) return null;

  // If URL exists and not expired, return it directly
  if (entry.downloadUrl && entry.expiresAt > Date.now()) {
    return entry.downloadUrl;
  }

  // URL expired or missing — try to refresh from the provider
  if (!urlResolver) {
    console.warn(`[${new Date().toISOString()}][strm] No URL resolver registered — cannot refresh code ${code}`);
    return entry.downloadUrl; // Return stale URL as best effort
  }

  try {
    const freshUrl = await urlResolver(entry.provider, entry.torrentId, entry.fileId);
    if (freshUrl) {
      upsertStrmCode(
        code,
        entry.provider,
        entry.torrentId,
        entry.fileId,
        freshUrl,
        Date.now() + STRM_TTL_MS,
      );
      return freshUrl;
    }
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][strm] Failed to refresh URL for code ${code}: ${err?.message}`);
  }

  // Return stale URL as fallback (better than nothing)
  return entry.downloadUrl;
}

/**
 * Returns the full STRM URL for a given code.
 * This is the URL that media players should bookmark.
 */
export function getStrmUrl(code: string, hostname?: string): string {
  const host = hostname || `localhost:${STRM_PORT}`;
  return `http://${host}/strm/${code}`;
}

// ===========================================================================
// HTTP Server
// ===========================================================================

/** The HTTP server instance (if running). */
let server: http.Server | null = null;

/**
 * Starts the STRM short-code HTTP server.
 * Listens on the configured port (default: 9120) and handles:
 * - `GET /strm/:code` — resolves a code to a 302 redirect
 * - `GET /not_found.mp4` — serves the error video
 * - `GET /health` — health check endpoint
 *
 * @returns Promise that resolves when the server is listening.
 */
export function startStrmServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const app = express();

    // Health check
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', service: 'strm', port: STRM_PORT });
    });

    // Error video fallback
    app.get('/not_found.mp4', (_req, res) => {
      if (fs.existsSync(NOT_FOUND_VIDEO_PATH)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        fs.createReadStream(NOT_FOUND_VIDEO_PATH).pipe(res);
      } else {
        res.status(404).send('Error video not found');
      }
    });

    // STRM code resolution — the main endpoint
    app.get('/strm/:code', async (req, res) => {
      const { code } = req.params;

      if (!code || code.length !== CODE_LENGTH) {
        res.status(400).send('Invalid STRM code');
        return;
      }

      try {
        const downloadUrl = await resolveStrmCode(code);

        if (!downloadUrl) {
          console.warn(`[${new Date().toISOString()}][strm] Code ${code} resolved to null — serving error video`);
          // Redirect to error video instead of returning an error page
          res.redirect(302, '/not_found.mp4');
          return;
        }

        // Success — redirect to the actual download URL
        res.redirect(302, downloadUrl);
      } catch (err: any) {
        console.error(`[${new Date().toISOString()}][strm] Error resolving code ${code}: ${err?.message}`);
        res.redirect(302, '/not_found.mp4');
      }
    });

    server = app.listen(STRM_PORT, () => {
      console.log(`[${new Date().toISOString()}][strm] STRM short-code service listening on port ${STRM_PORT}`);
      resolve();
    });

    server.on('error', (err: any) => {
      console.error(`[${new Date().toISOString()}][strm] Failed to start STRM server: ${err?.message}`);
      reject(err);
    });

    // Start periodic pruning of expired codes (every 6 hours)
    setInterval(() => {
      pruneExpiredStrmCodes();
    }, 6 * 60 * 60 * 1000);
  });
}

/**
 * Stops the STRM HTTP server gracefully.
 */
export function stopStrmServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log(`[${new Date().toISOString()}][strm] STRM server stopped`);
      server = null;
      resolve();
    });
  });
}
