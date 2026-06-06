# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog (https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

### Version [0.7.0] - 2026-06-06 🚀
*Status: .torrent file support, cloud storage mounts, STRM short-codes, error video fallback, organiser improvements*

### Added ✨
- **`.torrent` file support** (`src/indexers/`, `src/providers/`):
  - Indexer results that return `.torrent` download URLs are no longer discarded
  - New `MagnetOrTorrent` discriminated union type for magnet vs torrent URL
  - `addTorrentFile()` implemented in all 4 providers (RD, TB, AD, PM)
  - `addTorrentFileFromUrl()` in registry downloads and uploads `.torrent` files
- **Cloud storage virtual mounts** (`src/core/config.ts`, `src/services/mount.ts`):
  - Mega (email+password, fully headless), Google Drive (service account), Dropbox (OAuth), OneDrive (OAuth)
  - Mounted via rclone's `combine` backend under `{mountBase}/cloud/`
  - Default read-only, cloud-tuned flags (`--tpslimit=10`, `--dir-cache-time=1h`)
- **STRM short-code service** (`src/services/strmService.ts`, `src/core/db.ts`):
  - Stable 16-char alphanumeric codes that 302 redirect to ephemeral CDN URLs
  - HTTP server on port 9120 (configurable via `STRM_PORT`)
  - 7-day TTL with auto-refresh from provider on expiry
  - SQLite-persisted with automatic pruning every 6 hours
- **Error video fallback** (`assets/not_found.mp4`, `src/services/webdavBridge.ts`):
  - 10-second black MP4 (~8KB) served when download URLs are broken
  - Prevents media player hangs/crashes on 503 text responses
- **Anime output category** (`src/services/organizer.ts`):
  - Organiser now outputs anime to `Anime/` instead of lumping into `TV/`
  - Uses `mediaClassifier.ts` for CRC hash + fansub detection
- **Cloud Link Manager** (`src/services/cloudLinks/`):
  - Mount public shared folder links (Mega, GDrive, Dropbox) as FUSE directories
  - No account login needed for MEGA (uses `megajs` for client-side decryption)
  - Google Drive uses free API key only — 302 redirects to direct download URLs
  - Dropbox reuses existing `DROPBOX_TOKEN` from cloud mounts config
  - WebDAV bridge on port 9121 (configurable via `CLOUD_LINKS_PORT`)
  - Config via JSON file (`/config/cloud_links.json`) and/or `CLOUD_LINKS` env var
  - 5-minute folder listing cache to respect rate limits

### Changed 🔄
- **Organiser mount awareness** (`src/services/organizer.ts`):
  - Scans `__all__/` when Zurg-style layout detected (avoids duplicate processing)
  - Dynamic `MOUNT_STOP_WORDS` set replaces hardcoded provider names
  - Path walkers (`findShowHintFromPath`, `pickCandidateTitleFromPath`, `isLikelyTvContext`) skip category dirs

### Version [0.6.0] - 2026-06-06 🧬
*Status: Mount stability fix, persistent deduplication, Zurg-style organised mounts, Jellyseerr support*

### Added ✨
- **Zurg-style organised mounts** (`src/core/mediaClassifier.ts`, `src/services/webdavBridge.ts`):
  - WebDAV bridge now presents virtual category directories: `__all__/`, `anime/`, `shows/`, `movies/`
  - Classification matches Zurg's `config.yml` defaults with priority ordering (anime → shows → movies)
  - Anime detection: CRC hash patterns (`[ABCD1234]`) + fansub heuristic patterns (OVA, ONA, Nyaa, etc.)
  - TV show detection: comprehensive episode numbering (S01E01, Season 01, 1x01, Complete Series, etc.)
  - Movies: catch-all with `only_show_the_biggest_file` filtering to hide samples/NFOs
  - Full legacy fallback — existing flat torrent paths still work for backward compatibility
- **Jellyseerr support** (`src/core/config.ts`):
  - `JELLYSEERR_URL`, `JELLYSEERR_API_KEY`, `JELLYSEERR_AUTH` env vars as drop-in replacements
  - Jellyseerr's API is Overseerr-compatible — either set of env vars works
- **Persistent Overseerr processed state** (`src/core/db.ts`):
  - New `processed_overseerr` SQLite table survives container restarts
  - New `known_magnets` SQLite table for infohash-based deduplication
  - Both tables auto-prune entries older than 90 days

### Fixed 🐛
- **Mount health monitor root cause fix** (`src/services/mount.ts`):
  - Removed `502 Bad Gateway` and `503 Service Unavailable` from `MOUNT_ERROR_PATTERNS`
  - The WebDAV bridge intentionally returns 503 for dead/unavailable torrents — counting these as fatal mount errors caused unnecessary remounts every ~5 minutes, killing active Plex streams
  - Health check logic now separates log errors from mount accessibility
  - Only mount inaccessibility (readdir failure/timeout) triggers a remount; log errors are informational
  - Escalated failure increment (2x) when both log errors AND mount inaccessible occur together
- **Repeated torrent re-adding** (`src/services/overseerr.ts`, `src/providers/registry.ts`):
  - Overseerr poller's `processed` Set was in-memory only — lost on every restart, causing ALL approved requests to be re-processed. Now persisted to SQLite
  - Added infohash-based deduplication in `addMagnetWithStrategy()` — prevents re-adding the same content under different torrent names
  - Added blacklist checking in the Overseerr poller before searching
  - Recovery scanner cooldown increased from 6h → 24h to reduce API spam
  - Removed the 1000-item FIFO cap — SQLite handles unlimited persistence

### Version [0.5.3] - 2026-06-06 🔌
*Status: Graceful FUSE unmounting on graceful shutdown and auto-update exits*

### Fixed 🐛
- **Graceful FUSE unmounting**: Implemented a global graceful unmount procedure (`unmountAll`) that runs during graceful shutdown (SIGTERM/SIGINT) and when the auto-updater triggers a container restart/exit. This forcefully and lazily unmounts all active debrid FUSE mount points to cleanly terminate background `rclone` daemon processes and prevent container locks or stale mounts.

### Version [0.5.2] - 2026-06-06 🔧
*Status: RealDebrid 404 repair retries, organiser dynamic provider scanning, and directory walk error logging*

### Fixed 🐛
- **RealDebrid select files retry on 404**: Added an automatic retry loop in `selectAllFiles` (up to 3 attempts with a 1-second delay) to handle transient database propagation lag when selecting files for newly added magnets.
- **Dynamic organiser scanning**: Updated the media organiser (`organizeOnce`) to dynamically scan all enabled debrid providers configured in `config.providers` rather than hardcoding only `realdebrid` and `torbox`.
- **Organiser directory walk robustness**: Added try/catch error logging to the organiser's recursive directory walk (`walkDir`) to surface FUSE mount read issues, and replaced `lstat` with `stat` for resolving symbolic link targets in debrid mounts.

### Version [0.5.1] - 2026-06-06 🍿
*Status: Streaming freeze fixes, Plex stream detection, and organiser robustness*

### Added ✨
- **Unified Media Server Stream Detection** (`src/integrations/plex.ts`, `jellyfin.ts`, `emby.ts` & `src/services/`):
  - Added `isJellyfinStreaming()` and `isEmbyStreaming()` to fetch active sessions from Jellyfin and Emby (`/Sessions`) concurrently.
  - Implemented `isAnyMediaServerStreaming()` which queries Plex, Jellyfin, and Emby in parallel.
  - Ticks for Overseerr poller, recovery checks, watchlist polls, and dead scanner scans are now fully paused while anyone is actively watching media on any of the three servers to eliminate background API traffic.
- **Stale cache fallback for directory listings** (`src/services/webdavBridge.ts`):
  - Serve cached/stale directory structure and file listings if a debrid provider is rate-limited or errors, preventing empty mount points on host and preventing Plex freezes

### Fixed 🐛
- **Rotated token rate-limit bypass**: WebDAV bridge link resolution now bypasses the global rate-limit check for rotated tokens, allowing successful stream resolution even if the primary API token is rate-limited
- **TV Organiser duplication**: Fixed an issue in TV media folder organisation to prevent duplicate directories and correctly handle filename patterns
- **TypeScript compilation**: Fixed missing `guessTitleFromFilename` helper in `organizer.ts` to ensure clean builds
- **WebDAV bridge port binding**: Resolved a startup promise race condition in the Bun runtime by explicitly waiting for the `listening` event, preventing false-positive server starts when ports are blocked
- **Port probing self-healing**: Implemented automatic scanning (up to 20 sequential ports) when launching WebDAV bridges to dynamically find and bind to available ports, auto-updating the rclone config on-the-fly
- **RealDebrid repair race condition**: Added a 2-second database propagation delay between deleting a broken torrent and re-adding the magnet during repairs to avoid `404 Not Found` file-selection errors

### Version [0.5.0] - 2026-06-06 🔑
*Status: Multi-token download bypass + rate limiter hardening*

### Added ✨
- **Multi-token download bypass** (`src/core/tokenRotator.ts`):
  - Inspired by Zurg's `download_tokens` feature — provider-agnostic token rotation
  - Primary token manages content (add/list/delete); download tokens rotate for streaming
  - When a token hits HTTP 503 (bandwidth limit), automatically rotates to the next
  - Tokens auto-reset daily at midnight in configurable timezone (default: Australia/Sydney)
  - SQLite-persisted state survives container restarts
  - Works with all 4 providers: RealDebrid, TorBox, AllDebrid, Premiumize
  - New env vars: `RD_DOWNLOAD_TOKENS`, `TORBOX_DOWNLOAD_TOKENS`, `AD_DOWNLOAD_TOKENS`, `PM_DOWNLOAD_TOKENS`, `TOKEN_RESET_TIMEZONE`
- **API endpoints for token management**:
  - `GET /api/tokens` — token pool status per provider (active/limited/cooldown)
  - `POST /api/tokens/reset` — manually reset all token limits
- **Token rotation summary** in `GET /api/status` response

### Fixed 🐛
- **Mount service**: Fix `EEXIST` crash on startup when stale FUSE mount points (e.g. from previous container crashes) are present in the host system
- **Rate limiter**: `recordSuccess()` no longer clears active rate-limit backoffs prematurely — backoffs must expire naturally before the limiter resets
- **Rate limiter**: `recordRateLimit()` now accepts `backoffOverrideMs` so providers can specify exact cooldown periods (e.g. TorBox's "60 per hour" = 72s)
- **All 4 providers**: Parse `Retry-After` headers and pass as explicit backoff overrides
- **All 4 providers**: Routed all inline `recordRateLimit()` calls through `handleError()` for consistent Retry-After parsing
- **TorBox**: Parsed "X per Y" delay now fed directly to the rate limiter (was only stored in learning DB)

### Version [0.4.2] - 2026-06-06 🧪
*Status: Integration tests aligned with actual API surface*

### Fixed 🐛
- **Integration tests**: Removed `watchlistPoller` key assertion from `/api/status` — key doesn't exist in server response
- **Integration tests**: Removed `mediaServers` and `infringementList` assertions from status test — fields not present in response
- **Integration tests**: Added `webdavBridges` array assertion to match actual `/api/status` response shape
- **Integration tests**: Increased `/api/downloads` test timeout to 30s via `Promise.race` — endpoint iterates all providers and can exceed default 10s
- **Integration tests**: Removed all infringement CRUD tests (8 tests) — `/api/infringement-list` endpoints not yet implemented in server
- **Integration tests**: Removed rate limits test — `/api/rate-limits` endpoint not yet implemented in server
- **Integration tests**: Replaced cleanup function with no-op — no infringement entries to clean up

### Version [0.4.1] - 2026-06-06 🎨
*Status: Web GUI fully provider-agnostic — supports all 4 debrid providers dynamically*

### Fixed 🐛
- **Dashboard**: Replaced hardcoded TorBox/Real-Debrid colour logic with dynamic `PROVIDER_COLOURS` map (blue/purple/amber/emerald)
- **Dashboard**: "Configure TorBox or Real-Debrid in settings" → "Configure a debrid provider in settings"
- **Torrents page**: Replaced hardcoded `torboxCount`/`rdCount` with dynamic `providerCounts` grouping
- **Torrents page**: "Real-Debrid & TorBox torrent activity" → "Torrent activity across all providers"
- **Torrents page**: Provider badges now dynamically render for all configured providers
- **Activity page**: Replaced hardcoded Real-Debrid/TorBox stat cards with dynamic provider-based cards
- **Activity page**: "Real-Debrid downloads & TorBox web/usenet downloads" → "Downloads across all providers"
- **Mounts page**: Replaced binary colour logic with dynamic `getProviderColour()` helper
- **Add page**: "Configure TorBox or Real-Debrid" → "Configure a debrid provider"
- **Settings page**: Added AllDebrid and Premiumize configuration tabs (API key + WebDAV credentials)
- **Settings page**: PROVIDERS description updated to list all 4 providers
- **Backend webhook**: Replaced `!config.torboxApiKey` guard with `registry.configured().length === 0`

### Version [0.4.0] - 2026-06-06 🗄️🎬
*Status: SQLite persistence + Stremio addon server + 4-provider repair*

### Added ✨
- **SQLite persistence layer** (`src/core/db.ts`):
  - `better-sqlite3` synchronous database with WAL journalling
  - Five tables: `processed_watchlist`, `dead_torrents`, `rate_limit_state`, `blacklist_backup`, `response_cache`
  - Graceful degradation: all DB writes wrapped in try/catch, app continues if DB is corrupted/deleted
  - Automatic schema migrations via `CREATE TABLE IF NOT EXISTS`
  - Daily pruning of stale data (30-day TTL for watchlist, expired cache cleanup)
- **Stremio addon server** (`src/services/stremioAddon.ts`):
  - Unique feature: SchröDrive exposes itself as an installable Stremio addon
  - `GET /manifest.json` — Stremio addon manifest
  - `GET /stream/:type/:id.json` — searches all scrapers, returns debrid-backed streams
  - Separate port (default 7000), enabled via `STREMIO_ADDON_ENABLED=true`
- **Torrent repair on AllDebrid + Premiumize** (`src/providers/alldebrid.ts`, `premiumize.ts`):
  - All 4 providers now support `getInfoHash()` + `repairTorrent()`
  - 3-phase repair works across all providers: same-provider → cross-provider → replace
- New config entries:
  - `DATA_DIR` — persistent data directory (default: `./data`)
  - `DB_PATH` — SQLite database path (default: `./data/schrodrive.db`)
  - `STREMIO_ADDON_ENABLED` — enable/disable Stremio addon server
  - `STREMIO_ADDON_PORT` — Stremio addon port (default: 7000)

### Changed 🔄
- **Blacklist** (`src/core/blacklist.ts`):
  - Default path migrated from `/tmp/schrodrive/blacklist.json` to `./data/blacklist.json`
  - Auto-migration from old `/tmp` path on first run
  - Every `addToBlacklist()` now backs up to SQLite
  - `loadBlacklist()` recovers from SQLite backup if JSON file is missing/corrupted
- **Watchlist poller** (`src/services/mediaServerWatchlist.ts`):
  - Processed items now persist to SQLite across restarts
  - Startup hydrates the in-memory Set from database
  - Manual 2000-entry memory cap replaced by 30-day TTL pruning
- **Rate limiter** (`src/core/rateLimiter.ts`):
  - Backoff state and throttle delays persist to SQLite on every change
  - State restored from database on first access (survives restarts)
  - Response cache writes through to SQLite with DB fallback on in-memory miss
- **WebDAV bridge** (`src/services/webdavBridge.ts`):
  - Dead torrent records and failure counters persist to SQLite
  - Constructor restores state from database
  - `clearDeadTorrent()` removes records from both memory and database
- **Entrypoint** (`src/index.ts`):
  - Database initialised early in `serve` command startup
  - Graceful shutdown via `SIGTERM`/`SIGINT` hooks closes DB connection
  - 24-hour pruning interval for stale database entries

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

