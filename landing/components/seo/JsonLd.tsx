export function SoftwareAppJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SchröDrive',
    operatingSystem: 'Linux, macOS, Windows, Docker',
    applicationCategory: 'MultimediaApplication',
    description:
      'Open-source media automation orchestrator for Plex, Jellyfin, Emby & Silo with 11 debrid providers, Prowlarr/Jackett, Stremio scrapers, and a fake qBittorrent bridge for Sonarr/Radarr. One container. Silo speaks Jellyfin protocol on :8096.',
    url: 'https://schrodrive.org',
    author: { '@type': 'Person', name: 'Joseph Shenton', url: 'https://github.com/moderniselife' },
    maintainer: { '@type': 'Person', name: 'Joseph Shenton' },
    publisher: { '@type': 'Organization', name: 'Mojolayers', url: 'https://mojolayers.com' },
    license: 'https://github.com/moderniselife/SchroDrive/blob/main/LICENSE',
    codeRepository: 'https://github.com/moderniselife/SchroDrive',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      '11 debrid providers — TorBox, RealDebrid, AllDebrid, Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr, PikPak',
      'Add strategies: all (redundant), failover (primary+backup), single',
      'Prowlarr and Jackett with auto-detect (INDEXER_PROVIDER=auto)',
      'Torrentio, Comet, Zilean, Mediafusion Stremio scrapers (SCRAPER_MODE=merge|fallback)',
      'Plex, Jellyfin, Emby & Silo watchlists + library refresh (isAnyMediaServerStreaming pause) — Silo via Jellyfin protocol on :8096',
      'Trakt, Mdblist, Listrr watchlists',
      'Overseerr / Jellyseerr / Seerr webhook + poller (SEERR_* > OVERSEERR_*)',
      'Fake qBittorrent Web API v2 on :8282 for Sonarr/Radarr (no Decypharr/RDT-Client)',
      'rclone FUSE mounts via WebDAV bridge (no native creds needed)',
      'Cloud storage mounts: MEGA, Dropbox, Google Drive, OneDrive',
      'Public shared folder links (Mega, GDrive, Dropbox, HTTP) via Cloud Links bridge :9121',
      'External WebDAV mounts for NAS/seedboxes',
      'WebDAV bridge ports 9115-9127 per provider, 4h download URL cache',
      'Dead torrent 3-phase repair: same-provider → cross-provider → delete/blacklist/replace',
      'Pre-emptive stall detection, persistent blacklist, SQLite WAL',
      'Media organizer with TMDB/TVMaze, symlink/copy/move, 4 views (__all__/anime/shows/movies)',
      'STRM short codes :9120 (stable 16-char URLs)',
      'Multi-token download rotation (11 providers) with 429/503 bypass',
      'Rate limiter with Retry-After + exponential backoff',
      '10-page Next.js dashboard on :3000 (RUN_WEB_GUI)',
      'Stremio addon server on :7000',
      'Single container, embedded SQLite — no Postgres/Redis',
      'Docker Compose generator on schrodrive.org/docs/docker',
    ],
    keywords:
      'plex debrid, realdebrid alternative, torbox plex, alldebrid premiumize, sonarr qBittorrent download client, radarr debrid, rclone webdav bridge, prowlerr jackett auto, overseerr seerr jellyseerr, jellyfin debrid, emby debrid, trakt mdblist listrr, stremio torrentio comet, zurg alternative, riven alternative, selfhosted media automation, schrodrive',
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}

export function FaqJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
      {
        '@type': 'Question',
        name: 'What is SchröDrive?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'SchröDrive is an open-source media automation orchestrator that connects Overseerr/Seerr, Prowlarr/Jackett, and 11 debrid providers (TorBox, RealDebrid, AllDebrid, etc.) to a FUSE mount for Plex, Jellyfin or Emby. It runs as a single container with an embedded SQLite database.',
        },
      },
      {
        '@type': 'Question',
        name: 'How does the *arr bridge work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'SchröDrive exposes a fake qBittorrent Web API v2 on port 8282. Add it in Radarr/Sonarr as a qBittorrent client (host: schrodrive, port: 8282, no auth). It accepts magnets, submits them to your configured debrid providers, polls status, and symlinks completed files for import.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need Prowlarr or Jackett?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Either works. Set INDEXER_PROVIDER to auto, prowlarr or jackett. SchröDrive auto-detects. You can also enable Stremio scrapers (Torrentio, Comet, Zilean, Mediafusion) as fallback.',
        },
      },
      {
        '@type': 'Question',
        name: 'Which debrid providers are supported?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: '11: TorBox, RealDebrid, AllDebrid (stable) and Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr, PikPak (untested but implemented). Use PROVIDERS=torbox,realdebrid and ADD_STRATEGY=all|failover|single.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is SchröDrive free and open source?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, MIT licensed at github.com/moderniselife/SchroDrive. No external database needed — embedded SQLite WAL, single container, ghcr.io/moderniselife/schrodrive.',
        },
      },
      {
        '@type': 'Question',
        name: 'How do I install with Docker?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Use Docker Compose: git clone, cp .env.example .env, fill PROWLARR_URL, TORBOX_API_KEY etc., docker-compose up -d. Or docker run with ghcr.io/moderniselife/schrodrive:latest. See schrodrive.org/docs and the Docker Generator at /docs/docker.',
        },
      },
      {
        '@type': 'Question',
        name: 'How is it different from Riven or Zurg?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'SchröDrive is single-container with 11-provider redundancy, 3-phase repair, 4 scrapers, 6 watchlists, native *arr bridge without Decypharr, and embedded SQLite vs Riven’s Postgres+Redis. Zurg is a WebDAV server only; SchröDrive is full automation.',
        },
      },
      {
        '@type': 'Question',
        name: 'How does the WebDAV bridge work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The bridge translates debrid API keys into WebDAV endpoints for rclone, so you need no native WebDAV creds. Each provider gets a port 9115-9127, with 30s directory cache and 4h download URL cache.',
        },
      },
      {
        '@type': 'Question',
        name: 'What does the organizer do?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'It classifies torrents into __all__/anime/shows/movies (CRC > episode pattern > biggest file) and creates symlinked views in ORGANIZED_BASE via TMDB/TVMaze, with a review queue for ambiguous titles at /api/organizer/review.',
        },
      },
      {
        '@type': 'Question',
        name: 'How does dead torrent handling work?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Background dead scanner checks provider statuses and mount health. After 10 failures it tries same-provider repair (re-add magnet), then cross-provider, then deletes, blacklists, and re-searches via indexers/scrapers.',
        },
      },
      {
        '@type': 'Question',
        name: 'What are download tokens?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Additional debrid accounts for downloads (RD_DOWNLOAD_TOKENS etc.) that rotate on 429/503 to bypass per-account limits, auto-reset daily at midnight TOKEN_RESET_TIMEZONE.',
        },
      },
      {
        '@type': 'Question',
        name: 'Do I need a separate database?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'No. SchröDrive uses embedded SQLite WAL at ./data/schrodrive.db for watchlist, dead torrents, rate limits, etc., and degrades gracefully if deleted.',
        },
      },
      {
        '@type': 'Question',
        name: 'Is there a web dashboard?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes, 10-page Next.js dashboard on port 3000 when RUN_WEB_GUI=true — torrents, files, search, mounts, logs, settings.',
        },
      },
      {
        '@type': 'Question',
        name: 'Does it support Silo Server?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'Yes. Silo (siloserver.org) is a modern Go + Postgres media server that speaks the Jellyfin protocol on :8096. Point JELLYFIN_URL to http://silo:8096 and use your Silo credentials — watchlist and library refresh work like Jellyfin, with native Silo features (Go, pgvector, gRPC plugins, hardware transcode, worker nodes) unchanged.',
        },
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
