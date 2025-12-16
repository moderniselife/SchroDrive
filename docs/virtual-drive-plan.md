# SchroDrive Virtual Drive Feature Plan

Timestamp: 2025-11-11 09:06:00 +11:00

## Previous steps
- Researched TorBox and Real-Debrid WebDAV.
- Reviewed pd_zurg rclone setup for WebDAV mounts and obscure password usage.
- Reviewed SchroDrive (TorBoxUpdater) Prowlarr and TorBox integration.
- Located zurg-testing repo for inspiration on WebDAV and mounting flows.

## Current step
- Implement Virtual Drive mounting with rclone for TorBox and Real-Debrid and add a dead-torrent scanner that triggers Prowlarr refresh and re-sends to TorBox or Real-Debrid.

## Next steps
- Wire CLI commands: `mount` and `scan-dead`.
- Validate on macOS with macFUSE+rclone; validate on Linux with fuse3+rclone.
- Iterate on dead-torrent heuristics using provider-specific statuses.

## Architecture
- Services
  - WebDAV Mount Service (rclone-based)
    - Mount TorBox WebDAV: `https://webdav.torbox.app` with user/pass.
    - Mount Real-Debrid WebDAV: `https://dav.real-debrid.com` with RD WebDAV creds.
    - Uses rclone config generated at runtime; `rclone obscure` for password.
    - Runs mounts as child processes; health logging.
  - Dead Torrent Scanner
    - Provider sources: TorBox API, Real-Debrid API.
    - Heuristics: status indicates error/failed/stalled or progress < 100 with 0 seeders for a threshold duration.
    - For each dead item, build a search query (name/year if known), call Prowlarr, pick best, add magnet to target provider, optionally remove/retry original.
- Existing Integrations
  - Prowlarr search (`searchProwlarr`, `pickBestResult`, `getMagnet`, `getMagnetOrResolve`).
  - TorBox add magnet (`addMagnetToTorbox`).
- New Integrations
  - Real-Debrid REST API for add/list/select files; WebDAV mount.

## Configuration
- Providers
  - `PROVIDERS`: comma list: `torbox`, `realdebrid`.
- TorBox WebDAV
  - `TORBOX_WEBDAV_URL` (default `https://webdav.torbox.app`)
  - `TORBOX_WEBDAV_USERNAME`
  - `TORBOX_WEBDAV_PASSWORD`
- Real-Debrid WebDAV
  - `RD_WEBDAV_URL` (default `https://dav.real-debrid.com`)
  - `RD_WEBDAV_USERNAME`
  - `RD_WEBDAV_PASSWORD`
- Real-Debrid API
  - `RD_ACCESS_TOKEN` (Bearer token)
- Mount
  - `MOUNT_BASE` (e.g. `/mnt/schrodrive`)
  - `RCLONE_PATH` (default `rclone`)
  - `MOUNT_OPTIONS` (additional rclone flags string)
  - Granular cache flags (now fully configurable):
    - `MOUNT_VFS_CACHE_MODE` (default `full`)
    - `MOUNT_DIR_CACHE_TIME` (default `12h`)
    - `MOUNT_POLL_INTERVAL` (default `0`)
    - `MOUNT_BUFFER_SIZE` (default `64M`)
    - `MOUNT_VFS_READ_CHUNK_SIZE` (optional)
    - `MOUNT_VFS_READ_CHUNK_SIZE_LIMIT` (optional)
    - `MOUNT_VFS_CACHE_MAX_AGE` (optional)
    - `MOUNT_VFS_CACHE_MAX_SIZE` (optional)
- Dead Scanner
  - `DEAD_SCAN_INTERVAL_S` (default `600`)
  - `DEAD_IDLE_MIN` (default `120`)
  - `DEAD_SEEDERS_THRESHOLD` (default `0`)

## CLI additions
- `schrodrive mount` options:
  - `--providers`, `--mount-base`, `--rclone-path`, `--options`.
- `schrodrive scan-dead` options:
  - `--providers`, `--interval`, `--idle-min`.

## Open questions
- Which OS targets must be supported initially (macOS, Linux)?
- Preferred mounting approach: rclone mount vs OS-native (davfs2) vs direct FUSE lib?
- Should ‘dead’ also include content removed by DMCA (404 from provider)?
- Where should the mounted drive be exposed on macOS (e.g. `/Volumes/SchroDrive`)?

## Risks
- macOS requires macFUSE installed; Linux requires fuse3 and permissions.
- Real-Debrid WebDAV credentials differ from login password (needs WebDAV password from account).
- Heuristics for ‘dead’ may need tuning per provider.

---

Updated: 2025-11-11 09:32:00 +11:00

- Added granular rclone cache configuration envs and updated mount.ts to consume them in place of hardcoded flags.

Updated: 2025-11-11 09:47:00 +11:00

- Docker image now installs rclone and fuse3 (plus curl/ca-certificates) to support in-container rclone mounts.

Updated: 2025-11-11 09:52:00 +11:00

- Added GitHub Actions workflow to build/push a `develop` image on pushes to the `develop` branch: `.github/workflows/build-push-develop.yml`. Tags: `develop` and `develop-<sha>`.

Updated: 2025-06-20 20:23 UTC - Added dev version tag to develop workflow
- Added a step to extract package version from package.json in the develop build workflow
- Added a dev version tag `develop:<version>-dev` alongside existing tags in build-push-develop.yml
- This ensures the develop image is tagged with both `develop`, `develop-<sha>`, and `develop:0.1.25-dev` style tags

Updated: 2025-11-11 10:48:00 +11:00

- Added Organizer feature to classify media and expose a symlinked organized view under `ORGANIZED_BASE` (default `${MOUNT_BASE}/organized`).
- Organizer supports TMDB (if `TMDB_API_KEY` is set) and no-key fallback via TVMaze (TV) and iTunes Search (Movies).
- Folder layout:
  - Movies → `organized/Movies/Title (Year)/Title (Year).ext`
  - TV → `organized/TV/Show Name (Year)/Season 01/Show Name S01E02.ext`
  - Anime/absolute episodes → `organized/TV/Show Name/Show Name - 0637.ext`
- New envs: `TMDB_API_KEY`, `ORGANIZED_BASE`, `ORGANIZER_MODE` (symlink|copy|move), `RUN_ORGANIZER_WATCH`, `ORG_SCAN_INTERVAL_S`.
- New CLI: `schrodrive organize [--watch] [--dry-run]` and integrated watch into `serve` via `RUN_ORGANIZER_WATCH=true`.

Updated: 2025-11-11 11:24:00 +11:00

- Mount service now auto-cleans stale/busy mountpoints:
  - When `mkdir`/`readdir` fails with ENOTCONN/EBUSY/EIO, attempt `fusermount3 -uz`, then `fusermount -uz`, then `umount -l` (Linux). On macOS, `umount -f` then `diskutil unmount force`.
  - Retries directory creation after cleanup and logs a warning.
  - Also probes existing dirs with `readdir` to detect stale FUSE endpoints.
