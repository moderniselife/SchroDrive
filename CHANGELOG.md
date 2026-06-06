# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog (https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

### Version [0.3.0] - 2026-06-06 🏆
*Status: Feature parity with all competitors — zero gaps in comparison table*

### Added ✨
- **Trakt watchlist integration** (`src/integrations/trakt.ts`):
  - Dual auth: OAuth2 (private lists) + API key (public lists)
  - Automatic token refresh on 401 (logs new token for env var update)
  - Fetches both movie and show watchlists with TMDB/IMDB IDs
- **Mdblist watchlist integration** (`src/integrations/mdblist.ts`):
  - API key auth, fetches from specific list IDs or all user lists
  - Deduplicates items across lists
- **Listrr watchlist integration** (`src/integrations/listrr.ts`):
  - API key auth via `X-Api-Key` header
  - Fetches movie and show lists with TMDB IDs
- **Torrentio scraper** (`src/indexers/torrentio.ts`):
  - Stremio addon protocol search for movies and series
  - Configurable via `TORRENTIO_URL` and `TORRENTIO_CONFIG`
- **Comet scraper** (`src/indexers/comet.ts`):
  - Stremio addon protocol with Base64 config support
- **Zilean DMM scraper** (`src/indexers/zilean.ts`):
  - Text-based hash search (no IMDB ID required)
  - Default public instance + self-hosted URL support
- **Mediafusion scraper** (`src/indexers/mediafusion.ts`):
  - Stremio addon protocol with config string
- **Shared Stremio helpers** (`src/indexers/stremioScraper.ts`):
  - `parseStremioStreams()`, `parseQualityFromName()`, `buildStremioUrl()`
  - Extracts quality, size, seeders from stream names
- **Unified search layer** (refactored `src/indexers/index.ts`):
  - `searchAll()` — merges indexer + scraper results with deduplication
  - `SCRAPER_MODE=merge|fallback` — user-configurable search strategy
  - Backward-compatible `searchIndexer()`, `pickBestResult()`, `getMagnet()`
- **3-phase torrent repair** (enhanced `src/services/deadScanner.ts`):
  - Phase A: Same-provider repair (re-add magnet via `repairTorrent()`)
  - Phase B: Cross-provider repair (add magnet to OTHER providers)
  - Phase C: Delete + blacklist + replacement search (existing flow)
- **Pre-emptive repair**:
  - Detects stalling torrents (stuck progress for >30min) and repairs before they die
  - Configurable via `PREEMPTIVE_REPAIR` and `PREEMPTIVE_REPAIR_STALL_MIN`
- **Provider repair methods**:
  - `getInfoHash()` and `repairTorrent()` on RealDebrid and TorBox providers
  - Extracts info hash → deletes broken torrent → re-adds same magnet
- **Stremio addon server** config (`STREMIO_ADDON_ENABLED`, `STREMIO_ADDON_PORT`)

### Changed 🔄
- `UnifiedWatchlistItem.source` type widened to include `"trakt" | "mdblist" | "listrr"`
- `DebridProvider` interface: added optional `getInfoHash()` and `repairTorrent()` methods
- Watchlist poller now auto-detects and polls all configured sources (6 total)
- Dead scanner summary now includes `repaired`, `crossRepaired`, and `preemptive` counts
- README comparison table: zero dashes remaining in SchröDrive's column
- Architecture diagrams updated to show all new integrations and scrapers

### Version [0.2.1] - 2026-06-06 🚀
*Status: Multi-provider expansion + self-healing mount resilience*

### Added ✨
- **AllDebrid provider** (`src/providers/alldebrid.ts`):
  - Full `DebridProvider` interface implementation for AllDebrid v4 API
  - Auth via `apikey` + `agent` query parameters
  - Magnet management: list, add (upload + selectFiles), delete
  - Status code mapping: 0–3 downloading, 4 finished, 5–7 error
  - Link resolution via `/v4/link/unlock` endpoint
  - WebDAV bridge support with inline file population
  - **⚠️ Untested** — awaiting live account verification
- **Premiumize provider** (`src/providers/premiumize.ts`):
  - Full `DebridProvider` interface implementation for Premiumize API
  - Bearer token authentication
  - Transfer management: list, create, delete
  - Folder-based file resolution with direct download links
  - WebDAV bridge support (native WebDAV at `webdav.premiumize.me`)
  - **⚠️ Untested** — awaiting live account verification
- **Persistent torrent blacklist** (`src/core/blacklist.ts`):
  - JSON-backed blacklist stored at `/tmp/schrodrive/blacklist.json`
  - Bi-directional substring matching to catch naming variants
  - Load/save/add/remove/check API
  - Checked during dead torrent replacement to prevent re-adding bad content
- **Stale-while-locked cache** in WebDAV bridge:
  - Expired CDN URLs moved to stale cache instead of deleted
  - Served as fallback when fresh URL resolution fails (423 Locked, etc.)
  - CDN URLs typically live 6–12 hours past cache expiry
- **Dead torrent auto-lifecycle**:
  - Tracks per-torrent consecutive download failures
  - After 10 failures: delete from provider → blacklist → search replacement
  - Two-phase scanning: provider status + bridge-detected failures
  - `getDeadTorrents()` / `clearDeadTorrent()` API on WebDAV bridge
- **Mount health monitor** in `mount.ts`:
  - Background process monitoring rclone log patterns (423, IO error)
  - Async readdir health checks
  - Auto-remount after 5 consecutive failures
- **`deleteTorrent()`** method on `DebridProvider` interface:
  - RealDebrid: `DELETE /torrents/delete/{id}`
  - TorBox: `POST /v1/api/torrents/controltorrent` (operation: delete)
  - AllDebrid: `GET /v4/magnet/delete?id=ID`
  - Premiumize: `POST /transfer/delete`
- New config options:
  - `ALLDEBRID_API_KEY`, `ALLDEBRID_API_BASE`, `ALLDEBRID_AGENT`
  - `ALLDEBRID_WEBDAV_*`, `WEBDAV_BRIDGE_PORT_AD` (9117)
  - `PREMIUMIZE_API_KEY`, `PREMIUMIZE_API_BASE`
  - `PREMIUMIZE_WEBDAV_*`, `WEBDAV_BRIDGE_PORT_PM` (9118)
  - `BLACKLIST_PATH`

### Changed 🔄
- **WebDAV bridge** refactored to be provider-agnostic:
  - Uses provider registry for directory fetching and URL resolution
  - New providers work automatically without bridge code changes
  - Legacy inline helpers retained for RD/TB backwards compatibility
- **Dead scanner** rewritten with two-phase scanning:
  - Phase 1: Provider-status scan (error/failed/stalled)
  - Phase 2: Bridge-detected scan (persistent download failures)
  - Dead torrents now deleted from provider, not just re-added elsewhere
- **Mount service** extended for 4-provider support:
  - `hasDirectWebDAV()` / `hasApiKey()` support AllDebrid + Premiumize
  - rclone config generation for all 4 providers
  - Bridge startup blocks for all 4 providers
- **README** completely rewritten:
  - Added competition comparison table (vs pd_zurg, Zurg, Riven)
  - Dead torrent lifecycle Mermaid diagram
  - AllDebrid + Premiumize documentation with untested warnings
  - New troubleshooting section for 423 Locked errors

### Fixed 🐛
- WebDAV bridge `503 Retry-After` response prevents rclone from treating transient locks as permanent errors
- Retry-with-backoff for download URL resolution (3 attempts: 1s, 2s, 4s)


### Version [0.2.0] - 2026-06-06 🚀
*Status: Major release — replaces PD Zurg + TorBox Media Center*

### Added ✨
- **Plex watchlist integration** (`src/plex.ts`):
  - Polls Plex watchlist via metadata.provider.plex.tv
  - Library section listing and refresh
  - TMDB/TVDB GUID extraction from Plex metadata
- **Jellyfin watchlist integration** (`src/jellyfin.ts`):
  - Polls user favourites as watchlist
  - Library refresh trigger
  - Provider ID extraction (TMDB, TVDB, IMDB)
- **Emby watchlist integration** (`src/emby.ts`):
  - Polls user favourites as watchlist
  - Library refresh trigger
  - Compatible auth headers (`X-Emby-Token`)
- **Unified watchlist poller** (`src/mediaServerWatchlist.ts`):
  - Normalises items from Plex, Jellyfin, and Emby
  - Deduplicates across media servers
  - Searches via Prowlarr/Jackett, adds best torrent to configured debrid provider
  - Auto-refreshes source library after successful add
  - Enable with `RUN_WATCHLIST_POLLER=true`
- **Dynamic rate limit learning** (`src/rateLimitStore.ts`):
  - Per-endpoint tracking of response times and error rates
  - Adaptive delay: decreases 5% on success, doubles on rate limit
  - Retry-After header parsing (numeric + HTTP-date formats)
  - Persists to `/config/rate-limit-store.json`
  - API: `GET /api/rate-limits`, `GET /api/rate-limits/:provider`, `POST /api/rate-limits/reset`
- **Infringing content blocklist** (`src/infringementList.ts`):
  - JSON-backed blocklist for DMCA/infringing patterns
  - Three match types: contains, exact, regex
  - Per-provider attribution (realdebrid, torbox, both)
  - Auto-detection of infringement error responses
  - API: `GET/POST/DELETE /api/infringement-list`, `GET /api/infringement-list/check`
- **Code documentation overhaul**:
  - JSDoc for all 6 core files (realdebrid, torbox, mount, rateLimiter, organiser, server)
  - Module headers, function docs, section dividers, Australian English
- New config options:
  - `PLEX_URL`, `PLEX_TOKEN`, `PLEX_MOUNT_DIR`
  - `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `JELLYFIN_USER_ID`
  - `EMBY_URL`, `EMBY_API_KEY`, `EMBY_USER_ID`
  - `RUN_WATCHLIST_POLLER`, `WATCHLIST_POLL_INTERVAL_S`
  - `REFRESH_LIBRARY_ON_ADD`

### Changed 🔄
- **Runtime migrated from Node.js to Bun** (latest):
  - Dockerfile: `node:20-alpine` → `oven/bun:latest`
  - All scripts use `bun` instead of `node`
  - `bun.lock` replaces `package-lock.json`
  - `@types/bun` replaces `ts-node`
- Version bumped from 0.1.26 to 0.2.0
- `/api/status` now includes media server configuration and blocklist info
- Description updated to reflect full feature set

---

### Version [0.1.25] - 2025-11-10 🚀
*Status: Ready for release*

### Added ✨
- Magnet resolution from info hash:
  - `getMagnet` builds a magnet URI from `infoHash/infohash/hash` when no direct magnet is present
  - Logs `[prowlarr] getMagnet built from infoHash` on success
- Candidate fallback scanning:
  - Overseerr poller now iterates over sorted Prowlarr results if the top result lacks a resolvable magnet
  - Results are sorted by seeders then size to prioritize quality

### Changed 🔄
- Overseerr poller only proceeds to TorBox once a magnet is resolved from any candidate

### Fixed 🐛
- Cases where `getMagnet { hasCandidate: true, ok: false }` would stop processing without attempting resolution

---

### Version [0.1.20] - 2025-11-10 🚀

### Added ✨
- Prowlarr client tuning via environment:
  - `PROWLARR_TIMEOUT_MS` (default 45000, clamped 5s–120s)
  - `PROWLARR_INDEXER_IDS` (comma-separated IDs) to limit queried indexers
  - `PROWLARR_SEARCH_LIMIT` to cap results
- Magnet/HTTP(S) resolver:
  - HEAD-first, multi-hop (up to `PROWLARR_REDIRECT_MAX_HOPS`) resolution of Prowlarr download URLs that redirect to `magnet:` or `.torrent`
  - New env: `PROWLARR_REDIRECT_MAX_HOPS` (default 5)
- Query sanitation and fallbacks:
  - Strip `TMDB####` tokens from search queries before calling Prowlarr
  - Retry without the year when zero results are returned
  - Retry without categories when still zero results
- Send `type=search` to `/api/v1/search`
- Overseerr auth: support either `X-Api-Key` or `Authorization: Bearer <token>`

### Changed 🔄
- Improved request/diagnostic logging for Prowlarr (timeouts, params, fallbacks) and Overseerr
- Default Prowlarr client timeout increased to 45s (configurable)
- Overseerr poller now attempts magnet resolution from HTTP/HTTPS links when a direct magnet is not provided

### Fixed 🐛
- 401 Unauthorized on Prowlarr search by including `X-Api-Key` header in `/api/v1/search`
- 401 Unauthorized on Overseerr API calls by honoring configured `X-Api-Key` or `Authorization: Bearer` headers

---

### Earlier (summary) 📜
- Core features and tooling:
  - Overseerr webhook endpoint with background processing
  - Optional Overseerr API poller mode
  - Prowlarr search integration and best-result selection by seeders (fallback by size)
  - TorBox integration: add magnets, duplicate detection
  - CLI commands to search and add
  - Docker image and Compose
  - Auto-update support via GitHub Releases

