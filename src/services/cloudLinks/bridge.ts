/**
 * SchroDrive — Cloud Link Manager WebDAV Bridge
 *
 * A WebDAV server that exposes public shared folder links (Mega, Google Drive,
 * Dropbox) as a virtual filesystem. rclone mounts this bridge to make cloud
 * link content appear alongside debrid mounts.
 *
 * Architecture:
 * - Reads cloud link config from JSON file or env var
 * - Creates adapters for each configured link
 * - Exposes a WebDAV endpoint that rclone can mount
 * - For GDrive/Dropbox: 302 redirects to direct download URLs
 * - For MEGA: Proxies the decrypted stream (uses server bandwidth)
 *
 * Directory structure:
 *   /mega/Australian.Survivor/Season 01/S01E01.mkv
 *   /gdrive/Shared.Collection/file.mp4
 *   /dropbox/Team.Media/video.mkv
 *
 * @module cloudLinks/bridge
 */

import express, { type Request, type Response } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from '../../core/config';
import type { CloudLinkConfig, CloudLinkAdapter, CloudFile, CloudLinkProvider } from './types';
import { MegaAdapter } from './megaAdapter';
import { GDriveAdapter } from './gdriveAdapter';
import { DropboxAdapter } from './dropboxAdapter';
import { HttpAdapter } from './httpAdapter';

// ===========================================================================
// Constants
// ===========================================================================

const LOG_PREFIX = '[cloud-links]';

// ===========================================================================
// Configuration Loading
// ===========================================================================

/**
 * Loads cloud link configurations from JSON file and/or env var.
 * File takes priority; env var is merged in (deduped by URL).
 *
 * @returns Array of validated cloud link configs.
 */
function loadCloudLinks(): CloudLinkConfig[] {
  const links: CloudLinkConfig[] = [];
  const seenUrls = new Set<string>();

  // 1. Try JSON file first
  const configFile = config.cloudLinksFile;
  if (configFile && fs.existsSync(configFile)) {
    try {
      const raw = fs.readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isValidCloudLink(item) && !seenUrls.has(item.url)) {
            links.push(item);
            seenUrls.add(item.url);
          }
        }
        console.log(`${LOG_PREFIX} Loaded ${links.length} cloud link(s) from ${configFile}`);
      }
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Failed to parse cloud links file ${configFile}: ${err?.message}`);
    }
  }

  // 2. Merge in env var (CLOUD_LINKS JSON)
  const envJson = config.cloudLinksJson;
  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (isValidCloudLink(item) && !seenUrls.has(item.url)) {
            links.push(item);
            seenUrls.add(item.url);
          }
        }
        console.log(`${LOG_PREFIX} Merged ${links.length} total cloud link(s) (incl. env var)`);
      }
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Failed to parse CLOUD_LINKS env var: ${err?.message}`);
    }
  }

  return links;
}

/**
 * Validates that a config object has the required fields.
 */
function isValidCloudLink(item: any): item is CloudLinkConfig {
  return (
    item &&
    typeof item.type === 'string' &&
    ['mega', 'gdrive', 'dropbox', 'http'].includes(item.type) &&
    typeof item.url === 'string' &&
    item.url.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0
  );
}

// ===========================================================================
// Adapter Factory
// ===========================================================================

/**
 * Creates the appropriate adapter for a cloud link config.
 * Returns null if the required credentials are missing.
 */
function createAdapter(link: CloudLinkConfig): CloudLinkAdapter | null {
  switch (link.type) {
    case 'mega':
      return new MegaAdapter(link.url, link.name);

    case 'gdrive':
      if (!config.gdriveApiKey) {
        console.warn(`${LOG_PREFIX} Skipping GDrive link "${link.name}" — GDRIVE_API_KEY not set`);
        return null;
      }
      return new GDriveAdapter(link.url, link.name, config.gdriveApiKey);

    case 'dropbox':
      if (!config.dropboxToken) {
        console.warn(`${LOG_PREFIX} Skipping Dropbox link "${link.name}" — DROPBOX_TOKEN not set`);
        return null;
      }
      return new DropboxAdapter(link.url, link.name, config.dropboxToken);

    case 'http':
      return new HttpAdapter(link.url, link.name, link.headers, link.rateLimitMs);

    default:
      console.warn(`${LOG_PREFIX} Unknown cloud link type: ${link.type}`);
      return null;
  }
}

// ===========================================================================
// State
// ===========================================================================

/** Active adapters grouped by provider type. */
const adaptersByProvider = new Map<CloudLinkProvider, Map<string, CloudLinkAdapter>>();

/** HTTP server instance. */
let server: http.Server | null = null;

// ===========================================================================
// WebDAV Response Helpers
// ===========================================================================

/**
 * Generates a WebDAV PROPFIND multistatus response for a directory listing.
 */
function generatePropfindResponse(
  requestPath: string,
  entries: Array<{ href: string; isDirectory: boolean; size: number; name: string }>,
): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<D:multistatus xmlns:D="DAV:">',
  ];

  // Add the directory itself
  lines.push(`  <D:response>`);
  lines.push(`    <D:href>${encodeURI(requestPath.endsWith('/') ? requestPath : requestPath + '/')}</D:href>`);
  lines.push(`    <D:propstat>`);
  lines.push(`      <D:prop>`);
  lines.push(`        <D:resourcetype><D:collection/></D:resourcetype>`);
  lines.push(`        <D:displayname>${escapeXml(requestPath.split('/').filter(Boolean).pop() || 'root')}</D:displayname>`);
  lines.push(`      </D:prop>`);
  lines.push(`      <D:status>HTTP/1.1 200 OK</D:status>`);
  lines.push(`    </D:propstat>`);
  lines.push(`  </D:response>`);

  // Add children
  for (const entry of entries) {
    const href = entry.href.endsWith('/') || !entry.isDirectory
      ? entry.href
      : entry.href + '/';

    lines.push(`  <D:response>`);
    lines.push(`    <D:href>${encodeURI(href)}</D:href>`);
    lines.push(`    <D:propstat>`);
    lines.push(`      <D:prop>`);
    if (entry.isDirectory) {
      lines.push(`        <D:resourcetype><D:collection/></D:resourcetype>`);
    } else {
      lines.push(`        <D:resourcetype/>`);
      lines.push(`        <D:getcontentlength>${entry.size}</D:getcontentlength>`);
    }
    lines.push(`        <D:displayname>${escapeXml(entry.name)}</D:displayname>`);
    lines.push(`      </D:prop>`);
    lines.push(`      <D:status>HTTP/1.1 200 OK</D:status>`);
    lines.push(`    </D:propstat>`);
    lines.push(`  </D:response>`);
  }

  lines.push('</D:multistatus>');
  return lines.join('\n');
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ===========================================================================
// Request Handlers
// ===========================================================================

/**
 * Handles OPTIONS requests (WebDAV capability discovery).
 */
function handleOptions(_req: Request, res: Response): void {
  res.setHeader('Allow', 'OPTIONS, PROPFIND, GET, HEAD');
  res.setHeader('DAV', '1, 2');
  res.status(200).end();
}

/**
 * Handles PROPFIND requests (directory listings).
 *
 * Path structure:
 * /          → lists provider types (mega/, gdrive/, dropbox/)
 * /mega/     → lists configured MEGA folder links
 * /mega/Name/ → lists files in that folder
 * /mega/Name/Sub/ → lists files in subfolder
 */
async function handlePropfind(req: Request, res: Response): Promise<void> {
  const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  const segments = reqPath.split('/').filter(Boolean);

  try {
    // Root: list provider types
    if (segments.length === 0) {
      const entries: Array<{ href: string; isDirectory: boolean; size: number; name: string }> = [];
      for (const providerType of adaptersByProvider.keys()) {
        entries.push({
          href: `/${providerType}/`,
          isDirectory: true,
          size: 0,
          name: providerType,
        });
      }

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(207).send(generatePropfindResponse('/', entries));
      return;
    }

    const providerType = segments[0] as CloudLinkProvider;
    const providerMap = adaptersByProvider.get(providerType);

    if (!providerMap) {
      res.status(404).end();
      return;
    }

    // Provider level: list configured links
    if (segments.length === 1) {
      const entries = [];
      for (const [name] of providerMap) {
        entries.push({
          href: `/${providerType}/${name}/`,
          isDirectory: true,
          size: 0,
          name,
        });
      }

      res.setHeader('Content-Type', 'application/xml; charset=utf-8');
      res.status(207).send(generatePropfindResponse(`/${providerType}`, entries));
      return;
    }

    // Link level: list files in the shared folder
    const linkName = segments[1];
    const adapter = providerMap.get(linkName);

    if (!adapter) {
      res.status(404).end();
      return;
    }

    const subPath = segments.slice(2).join('/');
    const files = await adapter.listFolder(subPath || undefined);

    const basePath = `/${providerType}/${linkName}${subPath ? '/' + subPath : ''}`;
    const entries = files.map((f: CloudFile) => ({
      href: `${basePath}/${f.name}`,
      isDirectory: f.isDirectory,
      size: f.size,
      name: f.name,
    }));

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.status(207).send(generatePropfindResponse(basePath, entries));
  } catch (err: any) {
    console.error(`${LOG_PREFIX} PROPFIND error for ${reqPath}: ${err?.message}`);
    res.status(500).send('Internal server error');
  }
}

/**
 * Handles GET requests (file downloads / stream proxying).
 *
 * - For GDrive/Dropbox: 302 redirect to direct download URL
 * - For MEGA: Proxy the decrypted stream
 */
async function handleGet(req: Request, res: Response): Promise<void> {
  const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  const segments = reqPath.split('/').filter(Boolean);

  if (segments.length < 3) {
    res.status(404).end();
    return;
  }

  const providerType = segments[0] as CloudLinkProvider;
  const linkName = segments[1];
  const filePath = segments.slice(2).join('/');

  const providerMap = adaptersByProvider.get(providerType);
  const adapter = providerMap?.get(linkName);

  if (!adapter) {
    res.status(404).end();
    return;
  }

  try {
    // Find the file in the parent directory listing
    const parentPath = segments.slice(2, -1).join('/');
    const fileName = segments[segments.length - 1];
    const parentFiles = await adapter.listFolder(parentPath || undefined);
    const file = parentFiles.find((f: CloudFile) => f.name === fileName);

    if (!file) {
      res.status(404).end();
      return;
    }

    if (file.isDirectory) {
      res.status(404).end();
      return;
    }

    // Try direct URL first (GDrive, Dropbox)
    if (adapter.getDirectUrl) {
      const directUrl = await adapter.getDirectUrl(file.id);
      if (directUrl) {
        console.log(`${LOG_PREFIX}[${providerType}] GET ${filePath} → 302 redirect`);
        res.redirect(302, directUrl);
        return;
      }
    }

    // Fall back to stream proxying (MEGA)
    console.log(`${LOG_PREFIX}[${providerType}] GET ${filePath} → stream proxy (${file.size} bytes)`);
    const stream = await adapter.getStream(file.id);

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    if (file.size > 0) {
      res.setHeader('Content-Length', String(file.size));
    }
    res.setHeader('Accept-Ranges', 'none');

    // Pipe the stream to the response
    (stream as any).pipe(res);
    (stream as any).on('error', (err: any) => {
      console.error(`${LOG_PREFIX}[${providerType}] Stream error for ${filePath}: ${err?.message}`);
      if (!res.headersSent) {
        const errorVideoPath = path.resolve(__dirname, '../../../assets/not_found.mp4');
        if (fs.existsSync(errorVideoPath)) {
          res.setHeader('Content-Type', 'video/mp4');
          fs.createReadStream(errorVideoPath).pipe(res);
        } else {
          res.status(503).send('Stream error');
        }
      }
    });
  } catch (err: any) {
    console.error(`${LOG_PREFIX}[${providerType}] GET error for ${filePath}: ${err?.message}`);
    if (!res.headersSent) {
      res.status(500).send('Failed to fetch file');
    }
  }
}

/**
 * Handles HEAD requests (file metadata without body).
 */
async function handleHead(req: Request, res: Response): Promise<void> {
  const reqPath = decodeURIComponent(req.path).replace(/\/+$/, '') || '/';
  const segments = reqPath.split('/').filter(Boolean);

  if (segments.length < 3) {
    res.status(404).end();
    return;
  }

  const providerType = segments[0] as CloudLinkProvider;
  const linkName = segments[1];

  const providerMap = adaptersByProvider.get(providerType);
  const adapter = providerMap?.get(linkName);

  if (!adapter) {
    res.status(404).end();
    return;
  }

  try {
    const parentPath = segments.slice(2, -1).join('/');
    const fileName = segments[segments.length - 1];
    const parentFiles = await adapter.listFolder(parentPath || undefined);
    const file = parentFiles.find((f: CloudFile) => f.name === fileName);

    if (!file || file.isDirectory) {
      res.status(404).end();
      return;
    }

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    if (file.size > 0) {
      res.setHeader('Content-Length', String(file.size));
    }
    res.status(200).end();
  } catch (err: any) {
    res.status(500).end();
  }
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Starts the Cloud Links WebDAV bridge server.
 *
 * @returns Promise that resolves when the server is listening.
 */
export async function startCloudLinksBridge(): Promise<void> {
  const links = loadCloudLinks();
  if (links.length === 0) {
    console.log(`${LOG_PREFIX} No cloud links configured — bridge not started`);
    return;
  }

  console.log(`${LOG_PREFIX} Initialising ${links.length} cloud link adapter(s)...`);

  // Create and initialise adapters
  for (const link of links) {
    const adapter = createAdapter(link);
    if (!adapter) continue;

    try {
      await adapter.init();

      if (!adaptersByProvider.has(link.type)) {
        adaptersByProvider.set(link.type, new Map());
      }
      adaptersByProvider.get(link.type)!.set(link.name, adapter);

      console.log(`${LOG_PREFIX} ✅ ${link.type}/${link.name} — ready`);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} ❌ Failed to initialise ${link.type}/${link.name}: ${err?.message}`);
    }
  }

  if (adaptersByProvider.size === 0) {
    console.warn(`${LOG_PREFIX} No adapters initialised successfully — bridge not started`);
    return;
  }

  // Create Express app
  const app = express();

  // Health check
  app.get('/health', (_req, res) => {
    const providers: Record<string, string[]> = {};
    for (const [type, adapters] of adaptersByProvider) {
      providers[type] = [...adapters.keys()];
    }
    res.json({ status: 'ok', service: 'cloud-links', providers });
  });

  // WebDAV methods
  app.use((req, res, next) => {
    switch (req.method) {
      case 'OPTIONS':
        handleOptions(req, res);
        break;
      case 'PROPFIND':
        handlePropfind(req, res).catch(next);
        break;
      case 'GET':
        handleGet(req, res).catch(next);
        break;
      case 'HEAD':
        handleHead(req, res).catch(next);
        break;
      default:
        res.status(405).send('Method not allowed');
    }
  });

  // Start listening
  const port = config.cloudLinksBridgePort;
  return new Promise((resolve, reject) => {
    server = app.listen(port, () => {
      console.log(`${LOG_PREFIX} Cloud Links WebDAV bridge listening on port ${port}`);
      const totalLinks = [...adaptersByProvider.values()].reduce((sum, m) => sum + m.size, 0);
      console.log(`${LOG_PREFIX} Serving ${totalLinks} cloud link(s) across ${adaptersByProvider.size} provider(s)`);
      resolve();
    });

    server.on('error', (err: any) => {
      console.error(`${LOG_PREFIX} Failed to start Cloud Links bridge: ${err?.message}`);
      reject(err);
    });
  });
}

/**
 * Stops the Cloud Links bridge server gracefully.
 */
export function stopCloudLinksBridge(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }

    server.close(() => {
      console.log(`${LOG_PREFIX} Cloud Links bridge stopped`);
      server = null;
      resolve();
    });
  });
}
