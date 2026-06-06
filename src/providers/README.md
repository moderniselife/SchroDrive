# SchroDrive — Provider Abstraction Layer

This directory contains the **debrid provider abstraction layer** — the standard
interface all debrid services implement, plus the registry that manages them.

## Architecture

```
providers/
├── index.ts        # DebridProvider interface, types, ProviderRegistry
├── realdebrid.ts   # RealDebrid implementation
├── torbox.ts       # TorBox implementation
└── README.md       # This file
```

### How It Works

1. **`index.ts`** exports the `DebridProvider` interface, shared types
   (`TorrentInfo`, `VirtualDirectory`, etc.), and a singleton `registry`.
2. Each provider file (e.g. `realdebrid.ts`) defines a class implementing
   `DebridProvider` and **self-registers** at module level.
3. `index.ts` imports each provider file at the bottom, triggering
   registration on first load.

```
index.ts defines registry
  └─→ imports './realdebrid'
        └─→ realdebrid.ts imports { registry } from './index' (already defined)
        └─→ calls registry.register(new RealDebridProvider())
  └─→ imports './torbox'
        └─→ torbox.ts imports { registry } from './index' (already defined)
        └─→ calls registry.register(new TorBoxProvider())
```

## DebridProvider Interface

### Required Methods

| Method | Description |
|---|---|
| `isConfigured()` | Whether the provider has API credentials set |
| `isRateLimited()` | Whether requests are in a backoff period |
| `getWaitTime()` | Seconds remaining until backoff expires |
| `listTorrents()` | Fetch all torrents from the provider |
| `addMagnet(magnet, name?)` | Add a magnet link for downloading |
| `checkExisting(title)` | Check if a similar torrent already exists |
| `isTorrentDead(torrent)` | Detect dead/failed torrents |
| `fetchDirectories()` | Get virtual directories for the WebDAV bridge |
| `resolveDownloadUrl(torrentId, fileId, linkIndex?)` | Resolve a direct download URL |
| `hasDirectWebDAV()` | Whether native WebDAV credentials are configured |
| `hasApiKey()` | Whether the API key/token is set |
| `getWebDAVConfig()` | Return WebDAV connection details |
| `getBridgePort()` | Local port for the WebDAV bridge |

### Optional Methods

| Method | Description |
|---|---|
| `listTorrentsStream()` | Async generator for SSE streaming |
| `listDownloads()` | List completed/unrestricted downloads |
| `listDownloadsStream()` | Async generator for download streaming |
| `listWebDownloads()` | List web downloads (TorBox only) |
| `listUsenetDownloads()` | List Usenet downloads (TorBox only) |
| `fetchTorrentFiles(torrentId)` | Fetch file details for a single torrent (RD only) |

## How to Add a New Provider

Follow these steps to add support for a new debrid service (e.g. AllDebrid):

### 1. Create the provider file

Create `src/providers/alldebrid.ts`:

```typescript
import { config } from '../core/config';
import { rateLimiter } from '../core/rateLimiter';
import type {
  DebridProvider,
  TorrentInfo,
  AddMagnetResult,
  VirtualDirectory,
  VirtualFile,
} from './index';

const PROVIDER_NAME = 'alldebrid';

export class AllDebridProvider implements DebridProvider {
  readonly id = 'alldebrid' as const;
  readonly displayName = 'AllDebrid';

  // --- Status ---
  isConfigured(): boolean {
    // TODO: Check config.alldebridApiKey
    return false;
  }

  isRateLimited(): boolean {
    return rateLimiter.isRateLimited(PROVIDER_NAME);
  }

  getWaitTime(): number {
    return rateLimiter.getWaitTimeSeconds(PROVIDER_NAME);
  }

  // --- Torrent Operations ---
  async listTorrents(): Promise<TorrentInfo[]> {
    // TODO: Implement AllDebrid torrent listing
    return [];
  }

  async addMagnet(magnet: string, name?: string): Promise<AddMagnetResult> {
    // TODO: Implement AllDebrid magnet addition
    throw new Error('Not implemented');
  }

  async checkExisting(title: string): Promise<boolean> {
    // TODO: Implement duplicate checking
    return false;
  }

  isTorrentDead(torrent: TorrentInfo): boolean {
    // TODO: Implement dead torrent detection
    return false;
  }

  // --- WebDAV Bridge Support ---
  async fetchDirectories(): Promise<VirtualDirectory[]> {
    // TODO: Implement directory fetching
    return [];
  }

  async resolveDownloadUrl(
    torrentId: string,
    fileId: string,
    linkIndex?: number,
  ): Promise<string | null> {
    // TODO: Implement URL resolution
    return null;
  }

  // --- Mount Configuration ---
  hasDirectWebDAV(): boolean {
    return false; // AllDebrid doesn't offer native WebDAV
  }

  hasApiKey(): boolean {
    // TODO: Check config.alldebridApiKey
    return false;
  }

  getWebDAVConfig(): { url: string; username: string; password: string } | null {
    return null;
  }

  getBridgePort(): number {
    // TODO: Add WEBDAV_BRIDGE_PORT_AD to config
    return 9117;
  }
}

// Self-register
import { registry } from './index';
registry.register(new AllDebridProvider());
```

### 2. Add configuration

In `src/core/config.ts`, add the required environment variables:

```typescript
// AllDebrid
alldebridApiKey: process.env.ALLDEBRID_API_KEY || '',
webdavBridgePortAD: Number(process.env.WEBDAV_BRIDGE_PORT_AD || 9117),
```

### 3. Register the provider

In `src/providers/index.ts`, add the import at the bottom:

```typescript
import './alldebrid';
```

### 4. Update the PROVIDERS environment variable

Add `alldebrid` to the `PROVIDERS` env var to include it in the provider order:

```
PROVIDERS=torbox,realdebrid,alldebrid
```

## Using the Registry

```typescript
import { registry } from './providers';

// Get all configured providers
const providers = registry.configured();

// Get providers in user-preferred order
const ordered = registry.ordered();

// Look up a specific provider
const rd = registry.get('realdebrid');

// Check for existing torrents across all providers
const { exists, provider } = await registry.checkExistingAcrossAll('Movie Title');

// Add a magnet with strategy
const { results } = await registry.addMagnetWithStrategy(
  magnetUri,
  'Movie Title',
  'failover', // Try first provider, fall back on failure
);
```

## Shared Types

The following types are exported from `index.ts` and used across the codebase:

- **`TorrentInfo`** / **`TorrentFile`** — Normalised torrent representation
- **`DownloadInfo`** — Normalised download representation
- **`AddMagnetResult`** — Result of adding a magnet
- **`VirtualDirectory`** / **`VirtualFile`** — WebDAV bridge filesystem types
- **`AddStrategy`** — Magnet distribution strategy (`'all'` | `'failover'` | `'single'`)
