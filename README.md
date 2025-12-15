<p align="center">
  <a href="https://github.com/moderniselife/SchroDrive">
    <img src="assets/logo.png" alt="SchröDrive Logo" height="150">
  </a>
</p>

<p align="center">
  <a href="https://github.com/moderniselife/SchroDrive">
    <img src="https://img.shields.io/github/v/release/moderniselife/SchroDrive?style=for-the-badge&logo=github" alt="Release">
  </a>
  <a href="https://github.com/moderniselife/SchroDrive/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/moderniselife/SchroDrive/build-push.yml?branch=main&style=for-the-badge&logo=github-actions" alt="Build Status">
  </a>
  <a href="https://github.com/moderniselife/SchroDrive/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/moderniselife/SchroDrive?style=for-the-badge&logo=gnu" alt="License">
  </a>
  <a href="https://ghcr.io/moderniselife/schrodrive">
    <img src="https://img.shields.io/docker/pulls/ghcr.io/moderniselife/schrodrive?style=for-the-badge&logo=docker" alt="Docker Pulls">
  </a>
</p>

# SchröDrive

The ultimate media automation orchestrator. SchröDrive seamlessly integrates with Overseerr to automatically search Prowlarr or Jackett for the best torrents and deliver them to your preferred debrid service. Currently supporting TorBox with upcoming support for Real-Debrid, All-Debrid, and Premiumize.

## Releases
- [Latest Release](https://github.com/moderniselife/SchroDrive/releases/latest) - Auto-incremented version and release notes
- Docker image: `ghcr.io/moderniselife/schrodrive:latest` and `ghcr.io/moderniselife/schrodrive:vX.Y.Z`
- Develop image (auto-built on pushes to `develop`): `ghcr.io/moderniselife/schrodrive:develop`

## Features
- Webhook endpoint for Overseerr notifications
- **Dual indexer support**: Prowlarr (`/api/v1/search`) and Jackett (`/api/v2.0/indexers`)
- Auto-detection: configure one or both indexers, SchroDrive picks the active one
- Picks best result by seeders (fallback by size)
- Adds magnet to TorBox
- CLI for manual search/add
- Docker image

- Virtual Drive mounts via rclone (WebDAV): TorBox and Real‑Debrid
- Dead‑torrent scanner: searches indexer and re‑adds to the opposite provider
- Multi‑provider support: TorBox and Real‑Debrid

## 🚀 Future
- Additional providers (e.g., All‑Debrid, Premiumize)

## Modes
- **Webhook mode (default)**
  - Endpoint: `POST /webhook/overseerr`
  - Now responds immediately with `202 Accepted` and processes in the background to avoid Overseerr's 20s timeout window.
  - Optional auth header via `OVERSEERR_AUTH`.

- **Overseerr API Poller (optional)**
  - Polls Overseerr for `approved` requests via `GET /request?filter=approved`.
  - Requires: `OVERSEERR_URL` (must include `/api/v1`) and `OVERSEERR_API_KEY`.
  - Enable with `RUN_POLLER=true` (and optionally set `RUN_WEBHOOK=false`).
  - Poll interval configurable via `POLL_INTERVAL_S` (default 30s).

## Auto-Update
- SchröDrive can check GitHub Releases and auto-restart when a newer version is available.
- Works best with Docker using a supervisor (e.g., restart policy) plus Watchtower to pull the new image.

Environment:
- `AUTO_UPDATE_ENABLED` (default `false`)
- `AUTO_UPDATE_INTERVAL_S` (default `3600`)
- `AUTO_UPDATE_STRATEGY` = `exit` | `git`
  - `exit`: process exits when an update is found; your supervisor/Compose restarts it. For Docker, add Watchtower to pull new images.
  - `git`: runs `git pull --ff-only` then exits (for bare-metal/git installs).
- `REPO_OWNER` (default `moderniselife`)
- `REPO_NAME` (default `SchroDrive`)

Example (Docker Compose .env):
```
AUTO_UPDATE_ENABLED=true
AUTO_UPDATE_INTERVAL_S=1800
AUTO_UPDATE_STRATEGY=exit
```

Watchtower service (optional):
```yaml
  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    command: --interval 900 --cleanup
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```
This will pull `ghcr.io/moderniselife/schrodrive` updates automatically and restart the container when the app exits.

## Requirements
- Node.js 18+
- **Indexer**: Either Prowlarr OR Jackett (URL and API key)
- TorBox API key
- Optional secret for Overseerr webhook Authorization

## Environment Variables

### Indexer Selection
- `INDEXER_PROVIDER` (`auto` | `prowlarr` | `jackett`, default `auto`)
  - `auto`: Uses Jackett if configured, otherwise Prowlarr
  - `prowlarr`: Force Prowlarr
  - `jackett`: Force Jackett

### Prowlarr Configuration
- `PROWLARR_URL` (e.g. `http://localhost:9696`)
- `PROWLARR_API_KEY`
- `PROWLARR_CATEGORIES` (comma-separated category IDs, optional)
- `PROWLARR_INDEXER_IDS` (comma-separated indexer IDs, optional)
- `PROWLARR_SEARCH_LIMIT` (default `100`)
- `PROWLARR_TIMEOUT_MS` (default `120000`)

### Jackett Configuration
- `JACKETT_URL` (e.g. `http://localhost:9117`)
- `JACKETT_API_KEY`
- `JACKETT_CATEGORIES` (comma-separated category IDs, optional)
- `JACKETT_INDEXER_IDS` (comma-separated indexer IDs, optional)
- `JACKETT_SEARCH_LIMIT` (default `100`)
- `JACKETT_TIMEOUT_MS` (default `120000`)

### General
- `PORT` (default `8978`)
- `TORBOX_API_KEY`
- `TORBOX_BASE_URL` (default `https://api.torbox.app`)
- `OVERSEERR_AUTH` (optional Authorization value to require on webhook)
- `OVERSEERR_URL` (must include `/api/v1`)
- `OVERSEERR_API_KEY`
- `POLL_INTERVAL_S` (default 30s)
- `RUN_WEBHOOK` (default true)
- `RUN_POLLER` (default false)

Virtual Drive and multi‑provider configuration:

- `PROVIDERS` (default `torbox,realdebrid`)
- Real‑Debrid API: `RD_API_BASE` (default `https://api.real-debrid.com/rest/1.0`), `RD_ACCESS_TOKEN`
- Real‑Debrid WebDAV: `RD_WEBDAV_URL` (default `https://dav.real-debrid.com`), `RD_WEBDAV_USERNAME`, `RD_WEBDAV_PASSWORD`
- TorBox WebDAV: `TORBOX_WEBDAV_URL` (default `https://webdav.torbox.app`), `TORBOX_WEBDAV_USERNAME`, `TORBOX_WEBDAV_PASSWORD`
- Mount settings: `MOUNT_BASE` (default `/Volumes/SchroDrive` on macOS or `/mnt/schrodrive` on Linux), `RCLONE_PATH` (default `rclone`)
- Mount flags (fully configurable):
  - `MOUNT_VFS_CACHE_MODE` (default `full`)
  - `MOUNT_DIR_CACHE_TIME` (default `12h`)
  - `MOUNT_POLL_INTERVAL` (default `0`)
  - `MOUNT_BUFFER_SIZE` (default `64M`)
  - `MOUNT_VFS_READ_CHUNK_SIZE` (optional)
  - `MOUNT_VFS_READ_CHUNK_SIZE_LIMIT` (optional)
  - `MOUNT_VFS_CACHE_MAX_AGE` (optional)
  - `MOUNT_VFS_CACHE_MAX_SIZE` (optional)
  - `MOUNT_OPTIONS` (optional extra flags appended)
- Dead scanner: `DEAD_SCAN_INTERVAL_S` (default `600`), `DEAD_IDLE_MIN` (default `120`)

## Install & Build
```bash
npm ci
npm run build
```

## Run (Local)
```bash
# With Jackett
JACKETT_URL=http://localhost:9117 \
JACKETT_API_KEY=xxxxx \
TORBOX_API_KEY=tb_xxxxx \
node dist/index.js serve

# Or with Prowlarr
PROWLARR_URL=http://localhost:9696 \
PROWLARR_API_KEY=xxxxx \
TORBOX_API_KEY=tb_xxxxx \
node dist/index.js serve
```

Health check:
```bash
curl http://localhost:8978/health
```

## Overseerr Webhook Setup
- Add a Webhook notification agent in Overseerr Settings -> Notifications
- Webhook URL: `http://<host>:8978/webhook/overseerr`
- Authorization Header (optional): set the value to your chosen secret and set `OVERSEERR_AUTH` to the same value in this service
- JSON Payload (example):
```json
{
  "notification_type": "{{notification_type}}",
  "event": "{{event}}",
  "subject": "{{subject}}",
  "message": "{{message}}",
  "image": "{{image}}",
  "{{media}}": {
    "media_type": "{{media_type}}",
    "tmdbId": "{{media_tmdbid}}",
    "tvdbId": "{{media_tvdbid}}",
    "status": "{{media_status}}",
    "status4k": "{{media_status4k}}"
  },
  "{{request}}": {
    "request_id": "{{request_id}}",
    "requestedBy_email": "{{requestedBy_email}}",
    "requestedBy_username": "{{requestedBy_username}}",
    "requestedBy_avatar": "{{requestedBy_avatar}}",
    "requestedBy_settings_discordId": "{{requestedBy_settings_discordId}}",
    "requestedBy_settings_telegramChatId": "{{requestedBy_settings_telegramChatId}}"
  },
  "{{issue}}": {
    "issue_id": "{{issue_id}}",
    "issue_type": "{{issue_type}}",
    "issue_status": "{{issue_status}}",
    "reportedBy_email": "{{reportedBy_email}}",
    "reportedBy_username": "{{reportedBy_username}}",
    "reportedBy_avatar": "{{reportedBy_avatar}}",
    "reportedBy_settings_discordId": "{{reportedBy_settings_discordId}}",
    "reportedBy_settings_telegramChatId": "{{reportedBy_settings_telegramChatId}}"
  },
  "{{comment}}": {
    "comment_message": "{{comment_message}}",
    "commentedBy_email": "{{commentedBy_email}}",
    "commentedBy_username": "{{commentedBy_username}}",
    "commentedBy_avatar": "{{commentedBy_avatar}}",
    "commentedBy_settings_discordId": "{{commentedBy_settings_discordId}}",
    "commentedBy_settings_telegramChatId": "{{commentedBy_settings_telegramChatId}}"
  },
  "{{extra}}": []
}
```
- Recommended events: Request Approved (or as desired)

## CLI
Search indexer (Prowlarr or Jackett) and print the best result:
```bash
node dist/index.js search "Big Buck Bunny 2008"
```

Add a magnet directly to TorBox:
```bash
node dist/index.js add --magnet "magnet:?xt=urn:btih:..."
```

Search and add the best result automatically:
```bash
node dist/index.js add --query "Ubuntu 24.04"
```

Mount configured WebDAV providers via rclone (requires rclone + FUSE on host/container):
```bash
node dist/index.js mount
```

Scan for dead torrents and attempt re‑add via indexer to the opposite provider:
```bash
# One‑shot
node dist/index.js scan-dead

# Watch mode (interval from DEAD_SCAN_INTERVAL_S)
node dist/index.js scan-dead --watch
```

## Docker Compose
### Prerequisites
- Docker and Docker Compose installed
- Prowlarr API key
- TorBox API key

### Step 1: Clone the repository
```bash
git clone https://github.com/moderniselife/SchroDrive.git
cd SchroDrive
```

### Step 2: Configure environment variables
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```env
# Prowlarr Configuration
PROWLARR_URL=http://prowlarr:9696
PROWLARR_API_KEY=your_prowlarr_api_key_here
PROWLARR_CATEGORIES=5000,2000

# TorBox Configuration
TORBOX_API_KEY=tb_your_torbox_api_key_here
TORBOX_BASE_URL=https://api.torbox.app

# Providers (comma separated)
PROVIDERS=torbox,realdebrid

# Real‑Debrid API (optional but required for RD re‑add and scanner)
# RD_API_BASE=https://api.real-debrid.com/rest/1.0
# RD_ACCESS_TOKEN=your_rd_access_token

# Real‑Debrid WebDAV (for mounting)
# RD_WEBDAV_URL=https://dav.real-debrid.com
# RD_WEBDAV_USERNAME=your_rd_username
# RD_WEBDAV_PASSWORD=your_rd_webdav_password

# TorBox WebDAV (for mounting)
# TORBOX_WEBDAV_URL=https://webdav.torbox.app
# TORBOX_WEBDAV_USERNAME=you@example.com
# TORBOX_WEBDAV_PASSWORD=your_torbox_password

# Mount settings (rclone must be available in container or on host)
# MOUNT_BASE=/mnt/schrodrive
# RCLONE_PATH=rclone
# MOUNT_VFS_CACHE_MODE=full
# MOUNT_DIR_CACHE_TIME=12h
# MOUNT_POLL_INTERVAL=0
# MOUNT_BUFFER_SIZE=64M
# MOUNT_VFS_READ_CHUNK_SIZE=
# MOUNT_VFS_READ_CHUNK_SIZE_LIMIT=
# MOUNT_VFS_CACHE_MAX_AGE=
# MOUNT_VFS_CACHE_MAX_SIZE=
# MOUNT_OPTIONS=--no-modtime

# Overseerr Webhook (optional)
OVERSEERR_AUTH=your_secret_auth_header_value

# Service Port (optional)
PORT=8978
```

### Step 3: Start the services
```bash
docker-compose up -d
```

### Step 4: Verify the services
Health check for SchröDrive:
```bash
curl http://localhost:8978/health
```

Access Prowlarr web UI:
```bash
open http://localhost:9696
```

### Step 5: Configure Overseerr webhook
In Overseerr Settings → Notifications → Add Webhook:
- Webhook URL: `http://<your-host>:8978/webhook/overseerr`
- Authorization Header (optional): set to your `OVERSEERR_AUTH` value if used
- JSON Payload:
```json
{
  "notification_type": "{{notification_type}}",
  "event": "{{event}}",
  "subject": "{{subject}}",
  "message": "{{message}}",
  "image": "{{image}}",
  "{{media}}": {
    "media_type": "{{media_type}}",
    "tmdbId": "{{media_tmdbid}}",
    "tvdbId": "{{media_tvdbid}}",
    "status": "{{media_status}}",
    "status4k": "{{media_status4k}}"
  },
  "{{request}}": {
    "request_id": "{{request_id}}",
    "requestedBy_email": "{{requestedBy_email}}",
    "requestedBy_username": "{{requestedBy_username}}",
    "requestedBy_avatar": "{{requestedBy_avatar}}",
    "requestedBy_settings_discordId": "{{requestedBy_settings_discordId}}",
    "requestedBy_settings_telegramChatId": "{{requestedBy_settings_telegramChatId}}"
  },
  "{{issue}}": {
    "issue_id": "{{issue_id}}",
    "issue_type": "{{issue_type}}",
    "issue_status": "{{issue_status}}",
    "reportedBy_email": "{{reportedBy_email}}",
    "reportedBy_username": "{{reportedBy_username}}",
    "reportedBy_avatar": "{{reportedBy_avatar}}",
    "reportedBy_settings_discordId": "{{reportedBy_settings_discordId}}",
    "reportedBy_settings_telegramChatId": "{{reportedBy_settings_telegramChatId}}"
  },
  "{{comment}}": {
    "comment_message": "{{comment_message}}",
    "commentedBy_email": "{{commentedBy_email}}",
    "commentedBy_username": "{{commentedBy_username}}",
    "commentedBy_avatar": "{{commentedBy_avatar}}",
    "commentedBy_settings_discordId": "{{commentedBy_settings_discordId}}",
    "commentedBy_settings_telegramChatId": "{{commentedBy_settings_telegramChatId}}"
  },
  "{{extra}}": []
}
```
- Recommended events: Request Approved

### Step 6: Test the webhook
```bash
curl -X POST http://localhost:8978/webhook/overseerr \
  -H "Content-Type: application/json" \
  -H "Authorization: your_secret_auth_header_value" \
  -d '{"subject":"Big Buck Bunny 2008","media":{"title":"Big Buck Bunny","year":2008}}'
```

### Stack details
- `schrodrive` on port 8978
- `prowlarr` on port 9696 (LinuxServer image)
- Shared `media` network
- Persistent `prowlarr_config` volume

### Optional: Mounting WebDAV inside Docker
If you plan to run `node dist/index.js mount` inside the container, you need rclone and FUSE available in the container and permissions to use `/dev/fuse`.

You can either:

- Build a custom image that installs rclone and fuse3, or
- Install rclone and fuse3 at runtime (not recommended for production), and
- Add the following to your compose service (security sensitive):

```yaml
    devices:
      - "/dev/fuse:/dev/fuse"
    cap_add:
      - SYS_ADMIN
    security_opt:
      - apparmor:unconfined
    # privileged: true  # last resort; prefer fine-grained caps above
    # Ensure your mount base exists and is bind-mounted as needed
    # volumes:
    #   - /mnt/schrodrive:/mnt/schrodrive:rshared
```

Note: In many deployments it’s simpler to run the mount on the host and only use the app for scanning/automation.

### Stop and clean up
```bash
docker-compose down
# Remove volumes (optional)
docker-compose down -v
```

## GitHub Actions
This repository includes two workflows:

- **build-push.yml**: Builds and pushes to GHCR for linux/amd64 (fast, default)
- **build-push-multi.yml**: Multi-platform build for linux/amd64 and linux/arm64 (slower)

Both trigger on pushes to `main`/`master` and manual dispatch.

Build locally and push manually:
```bash
docker build -t ghcr.io/moderniselife/schrodrive:latest .
docker push ghcr.io/moderniselife/schrodrive:latest
```

Pull and run:
```bash
docker run --rm -p 8978:8978 \
  -e PROWLARR_URL=http://prowlarr:9696 \
  -e PROWLARR_API_KEY=xxxxx \
  -e TORBOX_API_KEY=tb_xxxxx \
  -e OVERSEERR_AUTH=supersecret \
  ghcr.io/moderniselife/schrodrive:latest
```

## Notes
- The webhook handler derives the search query from `subject` or `media.title/name` and `media.year/releaseYear`.
- Prowlarr categories can be constrained via `PROWLARR_CATEGORIES`.
- A git pre-commit hook automatically increments the package version when committing to main/master branches to prevent auto-update conflicts.
- The system checks for existing torrents in TorBox before adding new ones to prevent duplicates, using case-insensitive title matching.

## Troubleshooting
### Webhook returns 503 "Service not configured"
This means required environment variables are missing. Check your container logs and ensure:
- **Indexer configured**: Either set `JACKETT_URL` + `JACKETT_API_KEY` OR `PROWLARR_URL` + `PROWLARR_API_KEY`
- `TORBOX_API_KEY` is set to a valid TorBox API key

For Docker Compose, edit your `.env` file and restart:
```bash
docker-compose down
docker-compose up -d
```

### Webhook returns 504 "Request timed out while searching indexer"
The search request exceeded the timeout. This can happen if:
- Your indexer (Prowlarr/Jackett) is slow or has many trackers
- Network connectivity issues
- Indexers are unresponsive

Try:
1. Test your indexer directly:
   - Prowlarr: `curl http://localhost:9696/api/v1/search?query=test&apikey=YOUR_KEY`
   - Jackett: `curl "http://localhost:9117/api/v2.0/indexers/all/results?apikey=YOUR_KEY&Query=test"`
2. Reduce categories or indexers
3. Increase timeout via `PROWLARR_TIMEOUT_MS` or `JACKETT_TIMEOUT_MS`
4. Check indexer logs for issues
5. Retry the webhook request

### Health check fails
Ensure the service is running and accessible:
```bash
curl http://localhost:8080/health
```
