export function SoftwareAppJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'SchröDrive',
    operatingSystem: 'Linux, macOS, Windows, Docker',
    applicationCategory: 'MultimediaApplication',
    description:
      'Open-source media automation orchestrator for Plex, Jellyfin & Emby with 11 debrid providers, Prowlarr/Jackett, Stremio scrapers, and a fake qBittorrent bridge for Sonarr/Radarr. One container.',
    url: 'https://schrodrive.org',
    author: { '@type': 'Person', name: 'Joseph Shenton', url: 'https://github.com/moderniselife' },
    maintainer: { '@type': 'Person', name: 'Joseph Shenton' },
    publisher: { '@type': 'Organization', name: 'Mojolayers', url: 'https://mojolayers.com' },
    license: 'https://github.com/moderniselife/SchroDrive/blob/main/LICENSE',
    codeRepository: 'https://github.com/moderniselife/SchroDrive',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      '11 debrid providers',
      'Prowlarr and Jackett',
      'Torrentio, Comet, Zilean, Mediafusion scrapers',
      'Plex, Jellyfin, Emby watchlists',
      'Fake qBittorrent bridge for Sonarr/Radarr',
      'rclone FUSE mounts via WebDAV bridge',
      '10-page Next.js dashboard',
    ],
    keywords: 'plex debrid, realdebrid alternative, sonarr download client, rclone webdav, prowlerr jackett',
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
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }} />;
}
