# SchroDrive — Provider Abstraction Layer

This directory contains the **debrid provider abstraction layer** — the standard
interface all debrid services implement, the registry that manages them, and all
11 provider implementations.

## Directory Contents (14 Files)

```
providers/
├── index.ts        # DebridProvider interface, types, re-exports registry, auto-imports all providers
├── registry.ts     # ProviderRegistry singleton (register, get, configured, ordered, checkExistingAcrossAll, addMagnetWithStrategy, addTorrentFileFromUrl)
├── realdebrid.ts   # RealDebrid implementation
├── torbox.ts       # TorBox implementation
├── alldebrid.ts    # AllDebrid implementation
├── premiumize.ts   # Premiumize implementation
├── debridlink.ts   # Debrid-Link implementation
├── deepbrid.ts     # Deepbrid implementation
├── offcloud.ts     # Offcloud implementation
├── putio.ts        # Put.io implementation
├── megadebrid.ts   # MegaDebrid implementation (no WebDAV)
├── seedr.ts        # Seedr implementation
├── pikpak.ts       # PikPak implementation (JWT auth)
└── README.md       # This file
```

## Architecture

### How It Works

1. **`index.ts`** exports the `DebridProvider` interface, shared types
   (`TorrentInfo`, `VirtualDirectory`, `AddStrategy`, etc.), and re-exports
   the `registry` singleton from `./registry`.
2. **`registry.ts`** defines the `ProviderRegistry` class and exports the
   singleton `registry` instance. It does **not** import any provider files.
3. Each provider file (e.g. `debridlink.ts`) imports types from `'./index'`
   and imports `{ registry }` from `'./registry'` — this avoids circular
   dependency issues.
4. Each provider **self-registers** at module level by calling
   `registry.register(new XxxProvider())` and
   `tokenRotator.registerProvider(...)`.
5. `index.ts` imports each provider file at the bottom, triggering
   registration on first load.

```
index.ts defines types + re-exports { registry } from './registry'
  └─→ imports './realdebrid'
        └─→ realdebrid.ts imports types from './index'
        └─→ realdebrid.ts imports { registry } from './registry'
        └─→ calls registry.register(new RealDebridProvider())
        └─→ calls tokenRotator.registerProvider('realdebrid', ...)
  └─→ imports './torbox'
        └─→ (same pattern)
  └─→ imports './alldebrid'
  └─→ imports './premiumize'
  └─→ imports './debridlink'
  └─→ imports './deepbrid'
  └─→ imports './offcloud'
  └─→ imports './putio'
  └─→ imports './megadebrid'
  └─→ imports './seedr'
  └─→ imports './pikpak'
```

### Why the Split?

Provider files import `{ registry }` from `'./registry'` (not `'./index'`)
to avoid circular imports. If a provider imported from `'./index'`, it would
trigger `index.ts` to run, which in turn tries to import *all* provider files
— including the one that started the cycle. Importing from `'./registry'`
breaks the cycle because `registry.ts` is a leaf node with no provider imports.

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
| `deleteTorrent(torrentId)` | Delete a torrent from the provider |
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
| `addTorrentFile(fileBuffer, name?)` | Upload a `.torrent` file buffer |
| `getInfoHash(torrentId)` | Returns infohash/magnet URI for repair |
| `repairTorrent(torrentId)` | Re-add a dead torrent's magnet to the same provider |
| `listDownloads()` | List completed/unrestricted downloads |
| `listDownloadsStream()` | Async generator for download streaming |
| `listWebDownloads()` | List web downloads (TorBox only) |
| `listUsenetDownloads()` | List Usenet downloads (TorBox only) |
| `fetchTorrentFiles(torrentId)` | Fetch file details for a single torrent (RD only) |

## ProviderRegistry (registry.ts)

The `ProviderRegistry` class is a singleton exported as `registry`. It provides:

| Method | Description |
|---|---|
| `register(provider)` | Register a provider instance (called at module level) |
| `get(id)` | Look up a specific provider by ID |
| `all()` | All registered providers (configured or not) |
| `configured()` | Only providers with valid API credentials |
| `ordered()` | Configured providers in user-preferred order (`PROVIDERS` env) |
| `checkExistingAcrossAll(title)` | Check for existing torrents across all providers |
| `addMagnetWithStrategy(magnet, name?, strategy?)` | Add a magnet with distribution strategy |
| `addTorrentFileFromUrl(url, name, strategy?)` | Download a `.torrent` file and upload to providers |

## How to Add a New Provider

Use `debridlink.ts` as the reference template. The pattern is:

### 1. Create the provider file

Create `src/providers/yourprovider.ts`:

```typescript
import axios from 'axios';
import https from 'https';
import http from 'http';
import { config } from '../core/config';
import { rateLimiter } from '../core/rateLimiter';
import { tokenRotator } from '../core/tokenRotator';
import { UnplayableTorrentError } from '../core/errors';
import type {
  DebridProvider,
  TorrentInfo,
  TorrentFile,
  AddMagnetResult,
  VirtualDirectory,
  VirtualFile,
} from './index';
import { registry } from './registry';

const PROVIDER_NAME = 'yourprovider';

const httpAgent = new http.Agent({ family: 4 });
const httpsAgent = new https.Agent({ family: 4 });
const axiosIPv4 = axios.create({ httpAgent, httpsAgent });

export class YourProvider implements DebridProvider {
  readonly id = 'yourprovider' as const;
  readonly displayName = 'YourProvider';

  // Implement all required DebridProvider methods...
  // See debridlink.ts for the full pattern including:
  //   - Rate-limit-aware API calls
  //   - Response caching during backoff
  //   - Error handling with handleError()
  //   - Torrent normalisation
}

// ---------------------------------------------------------------------------
// Self-Registration
// ---------------------------------------------------------------------------

registry.register(new YourProvider());

// Register with token rotator for download token cycling
tokenRotator.registerProvider(PROVIDER_NAME, config.yourproviderApiKey, config.yourproviderDownloadTokens);
```

### 2. Add configuration

In `src/core/config.ts`, add the required environment variables:

```typescript
// YourProvider
yourproviderApiKey: process.env.YOURPROVIDER_API_KEY || '',
yourproviderApiBase: process.env.YOURPROVIDER_API_BASE || 'https://api.yourprovider.com',
webdavBridgePortYP: Number(process.env.WEBDAV_BRIDGE_PORT_YP || 9130),
yourproviderDownloadTokens: (process.env.YP_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
```

### 3. Register the provider

In `src/providers/index.ts`, add the import at the bottom (alongside the other providers):

```typescript
import './yourprovider';
```

### 4. Update the PROVIDERS environment variable

Add `yourprovider` to the `PROVIDERS` env var to include it in the provider order:

```
PROVIDERS=torbox,realdebrid,yourprovider
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

// Upload a .torrent file from URL
const { results: fileResults } = await registry.addTorrentFileFromUrl(
  'https://example.com/file.torrent',
  'Movie Title',
  'all',
);
```

## Shared Types

The following types are exported from `index.ts` and used across the codebase:

- **`TorrentInfo`** / **`TorrentFile`** — Normalised torrent representation
- **`DownloadInfo`** — Normalised download representation
- **`AddMagnetResult`** — Result of adding a magnet
- **`VirtualDirectory`** / **`VirtualFile`** — WebDAV bridge filesystem types
- **`AddStrategy`** — Magnet distribution strategy (`'all'` | `'failover'` | `'single'`)
