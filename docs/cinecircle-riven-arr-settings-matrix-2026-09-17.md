# CineCircle Riven and Arr settings matrix

Read-only recovery and proposed configuration matrix, 2026-09-17. This
document is a prerequisite for catalog construction and cutover. It contains
no credentials, provider data, media names, IDs, or runtime database content.
No configuration was changed.

## Recovered Riven search/crawler settings

Evidence was read from the deployed Riven configuration at
`/home/samtruman/docker/cinecircle/riven/data/settings.json` and from the
local fork at `/home/samtruman/docker/cinecircle/mediabridge-riven`.

| Concern | Recovered setting/implementation | What SchröDrive must replicate or retain | Status |
| --- | --- | --- | --- |
| Torrentio in Riven | Riven `scraping.torrentio.enabled=true`; configured HTTPS base URL; filter requests Italian language and rejects 720p/480p/scr/cam/unknown; timeout 30s | Recreate Torrentio as a Prowlarr indexer using the same base URL, filter semantics, timeout, Italian-first priority, and low-quality exclusions | Riven evidence confirmed; Prowlarr editor mapping requires approval |
| KnightCrawler/vendor | Riven `scraping.knightcrawler.enabled=false`; configured as a disabled fallback vendor | Keep disabled unless explicitly approved; do not silently activate it | Evidence confirmed |
| Prowlarr | Riven `scraping.prowlarr.enabled=true`; configured internal endpoint and redacted API key; timeout 180s and limiter 60s | Preserve Prowlarr as the active indexer/search path; add the approved Torrentio indexer there and keep credentials/URLs in Portainer secrets/config, never in Git | Evidence confirmed; values remain secret/owner-controlled |
| Other vendors | Jackett, Orionoid, MediaFusion, Zilean, and Comet are disabled in the recovered settings | Do not activate during catalog preparation | Evidence confirmed |
| Search/crawler implementation | Historical fork files `src/event_processor.py`, `src/riven_watcher.py`, `src/riven_source_reconcile.py`, `src/media_parser.py`, and `src/plex_parser_v2.py`; TMDb suggestion/search routes are in `event_processor.py` and `review_console.py` | Keep search/crawler responsibility separate from Arr metadata matching; use Review for unresolved normalization | Code paths identified; complete runtime parity remains a gate |
| Ranking/language | Italian token required (`ita`/`italian`/`italiano`); `it` required; 2160p and 1080p enabled; lower resolutions disabled; unknown languages removed; English fallback disabled | Candidate selection must prioritize Italian, retain both 1080p and 2160p, and not discard subtitle siblings | Evidence confirmed; owner approval of exact ranking is required |
| Indexer schedule | `indexer.update_interval=3600` | Retain a one-hour refresh unless the owner approves a different schedule | Evidence confirmed |

The historical pipeline remains: Prowlarr/Torrentio indexer search → result ranking and
filename parsing → Movies/Shows classification → TMDb/TVDb suggestion or
Review → source/download handling → Arr metadata matching and import. Arr,
not SchröDrive, remains responsible for final metadata association and import.

## Canonical two-Arr proposal

These are approval inputs, not deployed settings. `TBD` means the value was
not evidenced by the read-only inventory and must be selected before catalog
construction.

## Torrentio → Prowlarr proposed configuration

This is an editor-ready, sanitized proposal only. It must be entered and
approved in the existing Prowlarr configuration; no live Prowlarr or Portainer
configuration was changed.

| Prowlarr field | Proposed value/mapping | Rationale and blocker |
| --- | --- | --- |
| Indexer implementation | Torrentio-compatible Stremio indexer adapter available in the installed Prowlarr version; exact adapter name/version `TBD` | Confirm the installed adapter supports the recovered Torrentio URL/filter contract |
| Base URL | Recovered from Riven `scraping.torrentio.url`; value intentionally omitted from versioned docs | Copy the existing value into Portainer/Prowlarr without exposing it in Git |
| Filter/query parameters | Preserve Riven filter semantics: quality-size sort; Italian language; exclude 720p, 480p, screener, cam, and unknown | Exact Prowlarr field names/encoding are adapter-version dependent and must be mapped before approval |
| Timeout | 30 seconds | Directly evidenced in Riven settings |
| Rate limiting | Riven Torrentio `ratelimit=false`; Prowlarr global/indexer limits remain owner-controlled | Confirm Prowlarr does not apply a conflicting limit |
| Categories | Map movie results to Prowlarr/Arr Movies categories; TV/episode results to TV/Shows categories; preserve indexer-provided season/episode fields | Verify the installed adapter’s Torznab category IDs and Arr mappings |
| Languages | Italian required/prioritized (`it`, aliases `ita`/`italian`/`italiano`); no English fallback unless approved | Align Torrentio filter, Prowlarr language metadata, and Arr language profiles |
| Quality priority | 2160p first, 1080p second; lower/unknown quality excluded by recovered filter | Align Prowlarr sorting with Radarr/Sonarr quality profiles; do not create a third priority |
| Download client | Prowlarr and both Arr instances use SchröDrive qBittorrent-compatible bridge; `rdtclient` is removed after operational bridge verification | Cutover operation; no live connection was changed |

Dependency order is: approve Torrentio mapping → configure Prowlarr → point
Radarr/Sonarr to Prowlarr and SchröDrive → verify categories/languages/quality
and bridge behavior → build the catalog. Until these mappings are approved,
the catalog and cutover remain blocked.

| Setting | Radarr film instance | Sonarr series instance | Approval/evidence |
| --- | --- | --- | --- |
| Responsibility | Movies classification and movie import | Shows classification and episode/series import | Required architecture contract |
| Instance/service | `radarr` (production name TBD) | `sonarr` (production name TBD) | No production Arr containers were found in the accessible runtime; test services are not production evidence |
| Optional 1080p/2160p instances | Preferred: one instance with separate approved quality profiles; second 4K instance only if owner confirms | Preferred: one instance with separate approved quality profiles; second 4K instance only if owner confirms | TBD; do not invent service names |
| Root folder | Exact production Movies root: `TBD` | Exact production Shows root: `TBD` | Blocking; no `AR/adjustment` folder was found in the accessible inventory |
| Quality profiles | 1080p profile: `TBD`; 2160p profile: `TBD` | 1080p profile: `TBD`; 2160p profile: `TBD` | Blocking; retrieve IDs/names from Arr before editor save |
| Resolution priority | 2160p first, 1080p second, both retained as distinct versions | 2160p first, 1080p second, both retained as distinct versions | Proposed from recovered Riven ranking; owner approval required |
| Language | Italian prioritized; English fallback only if approved | Italian prioritized; English fallback only if approved | Proposed from Riven `required=[it]`; exact Arr language profile is TBD |
| Naming | Arr-native naming and folder format; exact format TBD | Arr-native naming and folder format; exact format TBD | Arr owns final naming; retrieve current Arr format |
| Monitored state | `TBD` per existing library/request policy | `TBD` per existing library/request policy | Arr configuration prerequisite |
| Download client | SchröDrive qBittorrent-compatible API/bridge; Prowlarr/Arr point to it | SchröDrive qBittorrent-compatible API/bridge; Prowlarr/Arr point to it | Operational cutover step; replaces `rdtclient` only after endpoint check |
| File command | Radarr `POST /api/v3/command`, `DownloadedMoviesScan` with Arr-visible path | Sonarr `POST /api/v3/command`, `DownloadedEpisodesScan` with Arr-visible path | Contract documented in `cinecircle-arr-single-file-contract-2026-09-17.md` |
| Metadata matching | Arr matches movie using existing record/IDs and path | Arr matches series/episode using existing record/IDs and path | Arr responsibility; SchröDrive does not duplicate it |
| Double version behavior | Separate 1080p/2160p files remain available according to profile and upgrade policy | Separate 1080p/2160p files remain available according to profile and upgrade policy | Must be explicitly accepted in Arr profiles before catalog |

## Operational dependencies and blockers

1. Before catalog work, an authorized read-only Arr inspection must provide
   the production instance names, root folders, quality-profile IDs, naming
   formats, monitored defaults, language profiles, and download-client
   records. The current test paths under
   `/home/samtruman/docker/cinecircle-test` are test-only and must not be
   promoted.
2. The cutover editor must point Prowlarr and both Arr instances to the
   SchröDrive qBittorrent-compatible bridge, verify command acceptance, and
   only then remove `rdtclient` and its existing mounts.
3. The existing retained service ports and mounts remain unchanged. No new
   `/data`, `/config`, media, root-folder, or `AR/adjustment` path may be
   invented.
4. Catalog construction and cutover remain **BLOCKED** until this matrix is
   approved and the missing Arr values are recovered without exposing
   secrets or real media data.

## Source pointers

- Riven settings: `/home/samtruman/docker/cinecircle/riven/data/settings.json`
- Riven parser: `/home/samtruman/docker/cinecircle/mediabridge-riven/src/media_parser.py`
- Parser fallback: `/home/samtruman/docker/cinecircle/mediabridge-riven/src/plex_parser_v2.py`
- Search/event path: `/home/samtruman/docker/cinecircle/mediabridge-riven/src/event_processor.py`
- Review/search routes: `/home/samtruman/docker/cinecircle/mediabridge-riven/src/review_console.py`
- Arr contract: `docs/cinecircle-arr-single-file-contract-2026-09-17.md`
- Three-input plan: `docs/cinecircle-three-input-e2e-plan.md`
