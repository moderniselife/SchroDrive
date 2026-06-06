# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog (https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning (https://semver.org/spec/v2.0.0.html).

### Version [0.2.1] - 2026-06-06 🚀
*Status: AllDebrid provider support*

### Added ✨
- **AllDebrid provider** (`src/providers/alldebrid.ts`):
  - Full `DebridProvider` interface implementation for AllDebrid v4 API
  - Auth via `apikey` + `agent` query parameters
  - Magnet management: list, add (upload + selectFiles), delete
  - Status code mapping: 0–3 downloading, 4 finished, 5–7 error
  - Embedded file info in magnet status (no separate file fetch needed)
  - Link resolution via `/v4/link/unlock` endpoint
  - WebDAV bridge support with inline file population
  - Rate limiting via shared `rateLimiter` singleton
  - IPv4-forced axios for Docker compatibility
  - Self-registers with provider registry on module load
- New config options (already in config.ts):
  - `ALLDEBRID_API_KEY`, `ALLDEBRID_API_BASE`, `ALLDEBRID_AGENT`
  - `ALLDEBRID_WEBDAV_URL`, `ALLDEBRID_WEBDAV_USERNAME`, `ALLDEBRID_WEBDAV_PASSWORD`
  - `WEBDAV_BRIDGE_PORT_AD` (default: 9117)

---

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

