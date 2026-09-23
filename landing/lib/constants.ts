import {
  Shield,
  Zap,
  Cloud,
  HardDrive,
  Monitor,
  Settings,
  Download,
  Search,
  RefreshCw,
  Eye,
  Layers,
  Radio,
  Server,
  Globe,
  Lock,
  Cpu,
  Database,
  Film,
  type LucideIcon,
} from 'lucide-react';

// ─────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────

export interface Feature {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface Provider {
  name: string;
  status: 'stable' | 'testing' | 'untested' | 'beta' | 'planned';
  features: string[];
}

export interface EnvVar {
  name: string;
  default: string;
  required: boolean;
  description: string;
}

export interface EnvVarCategory {
  title: string;
  description: string;
  variables: EnvVar[];
}

export interface Integration {
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'media-server' | 'indexer' | 'request-manager' | 'debrid';
}

export interface ServiceToggle {
  envName: string;
  label: string;
  description: string;
  defaultValue: boolean;
}

export interface NavLink {
  label: string;
  href: string;
}

export interface FooterLinkGroup {
  title: string;
  links: NavLink[];
}

export interface Stat {
  label: string;
  value: string;
  suffix?: string;
}

// ─────────────────────────────────────────────
// Features
// ─────────────────────────────────────────────

export const FEATURES: Feature[] = [
  {
    icon: Cloud,
    title: 'Multi-Debrid Orchestration',
    description:
      'Seamlessly manage 11 debrid providers — TorBox, RealDebrid, AllDebrid, Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr, and PikPak — from a single interface with automatic failover.',
  },
  {
    icon: Search,
    title: 'Intelligent Content Discovery',
    description:
      'Integrates with Prowlarr and Jackett to automatically search and resolve content from your preferred indexers.',
  },
  {
    icon: Monitor,
    title: 'Media Server Integration',
    description:
      'Native support for Plex, Jellyfin, and Emby. Automatically organises and serves your content library.',
  },
  {
    icon: HardDrive,
    title: 'rclone FUSE Mounts',
    description:
      'Mount your debrid cloud storage as local drives. Stream content directly without downloading first.',
  },
  {
    icon: RefreshCw,
    title: 'Automatic Content Management',
    description:
      'Dead link scanning, content re-acquisition, and library organisation — all running automatically in the background.',
  },
  {
    icon: Shield,
    title: 'Zero External Dependencies',
    description:
      'Single container deployment with no external databases required. Everything self-contained and portable.',
  },
  {
    icon: Zap,
    title: 'Lightning Fast Setup',
    description:
      'From zero to streaming in under 5 minutes. Docker Compose generator builds your perfect configuration.',
  },
  {
    icon: Layers,
    title: '*arr Bridge Compatibility',
    description:
      'Drop-in replacement for traditional download clients. Works with Sonarr, Radarr, and the entire *arr ecosystem.',
  },
  {
    icon: Eye,
    title: 'Web GUI Dashboard',
    description:
      '10-page Next.js dashboard for monitoring, configuration, and manual content management. Enable with RUN_WEB_GUI=true.',
  },
];

// ─────────────────────────────────────────────
// Providers
// ─────────────────────────────────────────────

export const PROVIDERS: Provider[] = [
  {
    name: 'TorBox',
    status: 'stable',
    features: ['Torrents', 'Usenet', 'Web downloads', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'RealDebrid',
    status: 'stable',
    features: ['Torrents', 'Cached content', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'AllDebrid',
    status: 'stable',
    features: ['Torrents', 'Cached content', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'Premiumize',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'Debrid-Link',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'Deepbrid',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'Offcloud',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'Put.io',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'MegaDebrid',
    status: 'untested',
    features: ['Torrents'],
  },
  {
    name: 'Seedr',
    status: 'untested',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts'],
  },
  {
    name: 'PikPak',
    status: 'testing',
    features: ['Torrents', 'WebDAV bridge', 'FUSE mounts', 'JWT auth'],
  },
];

// ─────────────────────────────────────────────
// Environment Variables (grouped by category)
// Factually correct as of src/core/config.ts — 2026-09-22
// ─────────────────────────────────────────────

export const ENV_VARS: Record<string, EnvVarCategory> = {
  core: {
    title: 'Core Settings',
    description: 'Essential configuration for SchröDrive operation.',
    variables: [
      {
        name: 'PORT',
        default: '8978',
        required: false,
        description: 'Port for the HTTP API server (and Web GUI when RUN_WEB_GUI=true).',
      },
      {
        name: 'PROVIDERS',
        default: 'torbox,realdebrid',
        required: false,
        description:
          'Comma-separated list of enabled debrid providers (torbox, realdebrid, alldebrid, premiumize, debridlink, deepbrid, offcloud, putio, megadebrid, seedr, pikpak). Order is priority.',
      },
      {
        name: 'ADD_STRATEGY',
        default: 'all',
        required: false,
        description:
          'Strategy for adding content: "all" (add to every provider), "failover" (try first then fallback), "single" (first only).',
      },
      {
        name: 'DATA_DIR',
        default: './data',
        required: false,
        description: 'Directory for SQLite DB and blacklist. Overridden by DB_PATH if set.',
      },
      {
        name: 'TOKEN_RESET_TIMEZONE',
        default: 'Australia/Sydney',
        required: false,
        description: 'Timezone for daily download-token reset (midnight).',
      },
    ],
  },
  debridTorbox: {
    title: 'TorBox',
    description: 'API and WebDAV configuration for TorBox.',
    variables: [
      { name: 'TORBOX_API_KEY', default: '', required: false, description: 'API key for TorBox. Required if torbox is in PROVIDERS.' },
      { name: 'TORBOX_API_BASE', default: 'https://api.torbox.app', required: false, description: 'Base URL for TorBox API.' },
      { name: 'TORBOX_WEBDAV_URL', default: 'https://webdav.torbox.app', required: false, description: 'WebDAV endpoint for TorBox.' },
      { name: 'TORBOX_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for TorBox.' },
      { name: 'TORBOX_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for TorBox.' },
    ],
  },
  debridRealdebrid: {
    title: 'RealDebrid',
    description: 'API and WebDAV configuration for RealDebrid.',
    variables: [
      { name: 'RD_ACCESS_TOKEN', default: '', required: false, description: 'Access token for RealDebrid. Required if realdebrid is in PROVIDERS.' },
      { name: 'RD_API_BASE', default: 'https://api.real-debrid.com/rest/1.0', required: false, description: 'Base URL for RealDebrid API.' },
      { name: 'RD_WEBDAV_URL', default: 'https://dav.real-debrid.com', required: false, description: 'WebDAV endpoint for RealDebrid.' },
      { name: 'RD_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for RealDebrid.' },
      { name: 'RD_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for RealDebrid.' },
    ],
  },
  debridAlldebrid: {
    title: 'AllDebrid',
    description: 'API and WebDAV configuration for AllDebrid.',
    variables: [
      { name: 'ALLDEBRID_API_KEY', default: '', required: false, description: 'API key for AllDebrid.' },
      { name: 'ALLDEBRID_API_BASE', default: 'https://api.alldebrid.com/v4', required: false, description: 'Base URL for AllDebrid API.' },
      { name: 'ALLDEBRID_AGENT', default: 'schrodrive', required: false, description: 'User agent for AllDebrid API requests.' },
      { name: 'ALLDEBRID_WEBDAV_URL', default: '', required: false, description: 'WebDAV endpoint for AllDebrid.' },
      { name: 'ALLDEBRID_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for AllDebrid.' },
      { name: 'ALLDEBRID_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for AllDebrid.' },
    ],
  },
  debridPremiumize: {
    title: 'Premiumize',
    description: 'API and WebDAV configuration for Premiumize. Untested.',
    variables: [
      { name: 'PREMIUMIZE_API_KEY', default: '', required: false, description: 'API key for Premiumize.' },
      { name: 'PREMIUMIZE_API_BASE', default: 'https://www.premiumize.me/api', required: false, description: 'Base URL for Premiumize API.' },
      { name: 'PREMIUMIZE_WEBDAV_URL', default: 'https://webdav.premiumize.me', required: false, description: 'WebDAV endpoint for Premiumize.' },
      { name: 'PREMIUMIZE_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Premiumize.' },
      { name: 'PREMIUMIZE_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Premiumize.' },
    ],
  },
  debridDebridlink: {
    title: 'Debrid-Link',
    description: 'API and WebDAV configuration for Debrid-Link. Untested.',
    variables: [
      { name: 'DEBRIDLINK_API_KEY', default: '', required: false, description: 'API key for Debrid-Link.' },
      { name: 'DEBRIDLINK_API_BASE', default: 'https://debrid-link.com/api/v2', required: false, description: 'Base URL for Debrid-Link API.' },
      { name: 'DEBRIDLINK_WEBDAV_URL', default: 'https://webdav.debrid.link', required: false, description: 'WebDAV endpoint for Debrid-Link.' },
      { name: 'DEBRIDLINK_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Debrid-Link.' },
      { name: 'DEBRIDLINK_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Debrid-Link.' },
    ],
  },
  debridDeepbrid: {
    title: 'Deepbrid',
    description: 'API and WebDAV configuration for Deepbrid. Untested.',
    variables: [
      { name: 'DEEPBRID_API_KEY', default: '', required: false, description: 'API key for Deepbrid.' },
      { name: 'DEEPBRID_API_BASE', default: 'https://www.deepbrid.com/api', required: false, description: 'Base URL for Deepbrid API.' },
      { name: 'DEEPBRID_WEBDAV_URL', default: '', required: false, description: 'WebDAV endpoint for Deepbrid.' },
      { name: 'DEEPBRID_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Deepbrid.' },
      { name: 'DEEPBRID_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Deepbrid.' },
    ],
  },
  debridOffcloud: {
    title: 'Offcloud',
    description: 'API and WebDAV configuration for Offcloud. Untested.',
    variables: [
      { name: 'OFFCLOUD_API_KEY', default: '', required: false, description: 'API key for Offcloud.' },
      { name: 'OFFCLOUD_API_BASE', default: 'https://offcloud.com/api', required: false, description: 'Base URL for Offcloud API.' },
      { name: 'OFFCLOUD_WEBDAV_URL', default: '', required: false, description: 'WebDAV endpoint for Offcloud.' },
      { name: 'OFFCLOUD_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Offcloud.' },
      { name: 'OFFCLOUD_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Offcloud.' },
    ],
  },
  debridPutio: {
    title: 'Put.io',
    description: 'API and WebDAV configuration for Put.io. Untested.',
    variables: [
      { name: 'PUTIO_OAUTH_TOKEN', default: '', required: false, description: 'OAuth token for Put.io.' },
      { name: 'PUTIO_API_BASE', default: 'https://api.put.io/v2', required: false, description: 'Base URL for Put.io API.' },
      { name: 'PUTIO_WEBDAV_URL', default: 'https://webdav.put.io', required: false, description: 'WebDAV endpoint for Put.io.' },
      { name: 'PUTIO_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Put.io.' },
      { name: 'PUTIO_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Put.io.' },
    ],
  },
  debridMegadebrid: {
    title: 'MegaDebrid',
    description: 'API configuration for MegaDebrid. No native WebDAV — uses bridge. Untested.',
    variables: [
      { name: 'MEGADEBRID_API_KEY', default: '', required: false, description: 'API key for MegaDebrid.' },
      { name: 'MEGADEBRID_API_BASE', default: 'https://www.mega-debrid.eu', required: false, description: 'Base URL for MegaDebrid API.' },
    ],
  },
  debridSeedr: {
    title: 'Seedr',
    description: 'API and WebDAV configuration for Seedr. Untested.',
    variables: [
      { name: 'SEEDR_API_KEY', default: '', required: false, description: 'API key for Seedr.' },
      { name: 'SEEDR_API_BASE', default: 'https://www.seedr.cc/rest', required: false, description: 'Base URL for Seedr API.' },
      { name: 'SEEDR_WEBDAV_URL', default: 'https://dav.seedr.cc', required: false, description: 'WebDAV endpoint for Seedr.' },
      { name: 'SEEDR_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for Seedr.' },
      { name: 'SEEDR_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for Seedr.' },
    ],
  },
  debridPikpak: {
    title: 'PikPak',
    description: 'API and WebDAV configuration for PikPak. JWT auth. Untested.',
    variables: [
      { name: 'PIKPAK_USERNAME', default: '', required: false, description: 'Username for PikPak.' },
      { name: 'PIKPAK_PASSWORD', default: '', required: false, description: 'Password for PikPak.' },
      { name: 'PIKPAK_API_BASE', default: 'https://api-drive.mypikpak.com', required: false, description: 'Base URL for PikPak API.' },
      { name: 'PIKPAK_WEBDAV_URL', default: '', required: false, description: 'WebDAV endpoint for PikPak.' },
      { name: 'PIKPAK_WEBDAV_USERNAME', default: '', required: false, description: 'WebDAV username for PikPak.' },
      { name: 'PIKPAK_WEBDAV_PASSWORD', default: '', required: false, description: 'WebDAV password for PikPak.' },
    ],
  },
  indexers: {
    title: 'Indexers',
    description: 'Configuration for Prowlarr / Jackett. Set INDEXER_PROVIDER to auto, prowlarr or jackett.',
    variables: [
      { name: 'INDEXER_PROVIDER', default: 'auto', required: false, description: 'Which indexer to use: auto, prowlarr, jackett.' },
      { name: 'PROWLARR_URL', default: '', required: false, description: 'URL for Prowlarr (e.g. http://prowlarr:9696).' },
      { name: 'PROWLARR_API_KEY', default: '', required: false, description: 'API key for Prowlarr.' },
      { name: 'JACKETT_URL', default: '', required: false, description: 'URL for Jackett (e.g. http://jackett:9117).' },
      { name: 'JACKETT_API_KEY', default: '', required: false, description: 'API key for Jackett.' },
    ],
  },
  overseerr: {
    title: 'Seerr (Overseerr / Jellyseerr)',
    description: 'Request manager. Seerr is the merged successor — SEERR_* takes priority, OVERSEERR_*/JELLYSEERR_* are fallbacks.',
    variables: [
      { name: 'SEERR_URL', default: '', required: false, description: 'URL for Seerr/Overseerr/Jellyseerr.' },
      { name: 'SEERR_API_KEY', default: '', required: false, description: 'API key for Seerr/Overseerr/Jellyseerr.' },
      { name: 'SEERR_AUTH', default: '', required: false, description: 'Optional webhook auth header for Seerr.' },
      { name: 'POLL_INTERVAL_S', default: '30', required: false, description: 'Seerr poller interval in seconds.' },
    ],
  },
  mediaServers: {
    title: 'Media Servers',
    description: 'Plex, Jellyfin, Emby — watchlist + library refresh.',
    variables: [
      { name: 'PLEX_URL', default: '', required: false, description: 'URL for Plex (e.g. http://plex:32400).' },
      { name: 'PLEX_TOKEN', default: '', required: false, description: 'Plex token.' },
      { name: 'JELLYFIN_URL', default: '', required: false, description: 'URL for Jellyfin.' },
      { name: 'JELLYFIN_API_KEY', default: '', required: false, description: 'API key for Jellyfin.' },
      { name: 'EMBY_URL', default: '', required: false, description: 'URL for Emby.' },
      { name: 'EMBY_API_KEY', default: '', required: false, description: 'API key for Emby.' },
    ],
  },
  mount: {
    title: 'Mount & WebDAV Bridge',
    description: 'rclone FUSE mounts and WebDAV bridge. MOUNT_OPTIONS is a full rclone override; when empty, individual MOUNT_* vars are composed.',
    variables: [
      { name: 'MOUNT_BASE', default: '/mnt/schrodrive', required: false, description: 'Base directory for FUSE mounts. /Volumes/SchroDrive on macOS.' },
      { name: 'RCLONE_PATH', default: 'rclone', required: false, description: 'Path to rclone binary.' },
      { name: 'MOUNT_OPTIONS', default: '', required: false, description: 'Full rclone mount options override. When empty, composed from MOUNT_*.' },
      { name: 'WEBDAV_BRIDGE_ENABLED', default: 'true', required: false, description: 'Enable API-to-WebDAV bridge.' },
      { name: 'WEBDAV_CACHE_TTL_S', default: '30', required: false, description: 'Directory listing cache TTL.' },
      { name: 'WEBDAV_DOWNLOAD_CACHE_TTL_S', default: '14400', required: false, description: 'Download URL cache TTL (4h).' },
    ],
  },
  webdavMounts: {
    title: 'External WebDAV Mounts',
    description: 'Mount third-party WebDAV servers as read-only FUSE filesystems.',
    variables: [
      { name: 'WEBDAV_MOUNTS_ENABLED', default: 'false', required: false, description: 'Enable external WebDAV mounting.' },
      { name: 'WEBDAV_MOUNTS_FILE', default: '/config/webdav.json', required: false, description: 'Path to JSON file for WebDAV mounts.' },
      { name: 'WEBDAV_MOUNTS', default: '', required: false, description: 'Inline JSON array for WebDAV mounts (fallback).' },
    ],
  },
  services: {
    title: 'Service Toggles',
    description: 'Enable or disable individual services.',
    variables: [
      { name: 'RUN_MOUNT', default: 'false', required: false, description: 'Enable rclone FUSE mounts.' },
      { name: 'RUN_WEBHOOK', default: 'true', required: false, description: 'Enable Seerr webhook listener.' },
      { name: 'RUN_POLLER', default: 'false', required: false, description: 'Enable Seerr API poller.' },
      { name: 'RUN_WATCHLIST_POLLER', default: 'false', required: false, description: 'Enable Plex/Jellyfin/Emby watchlist poller.' },
      { name: 'RUN_DEAD_SCANNER_WATCH', default: 'false', required: false, description: 'Enable dead link scanner + 3-phase repair.' },
      { name: 'RUN_ORGANIZER_WATCH', default: 'false', required: false, description: 'Enable media organiser (symlinks).' },
      { name: 'ARR_BRIDGE_ENABLED', default: 'false', required: false, description: 'Enable fake qBittorrent bridge for *arr.' },
      { name: 'RUN_WEB_GUI', default: 'false', required: false, description: 'Enable Next.js dashboard (port 3000).' },
    ],
  },
  arrBridge: {
    title: '*arr Bridge',
    description: 'Fake qBittorrent API for Radarr/Sonarr. Also respects Prowlarr/Jackett and provider ADD_STRATEGY.',
    variables: [
      { name: 'ARR_BRIDGE_ENABLED', default: 'false', required: false, description: 'Enable the *arr bridge.' },
      { name: 'ARR_BRIDGE_PORT', default: '8282', required: false, description: 'Port for *arr bridge (qBittorrent API).' },
    ],
  },
  downloadTokens: {
    title: 'Download Tokens (Multi-Account)',
    description: 'Rotate multiple debrid accounts for downloads to bypass per-account limits. All 11 providers support tokens.',
    variables: [
      { name: 'RD_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional RealDebrid tokens (comma-separated).' },
      { name: 'TORBOX_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional TorBox keys.' },
      { name: 'AD_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional AllDebrid keys.' },
      { name: 'PM_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Premiumize keys.' },
      { name: 'DL_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Debrid-Link keys.' },
      { name: 'DB_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Deepbrid keys.' },
      { name: 'OC_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Offcloud keys.' },
      { name: 'PUTIO_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Put.io tokens.' },
      { name: 'MD_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional MegaDebrid keys.' },
      { name: 'SEEDR_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional Seedr tokens.' },
      { name: 'PIKPAK_DOWNLOAD_TOKENS', default: '', required: false, description: 'Additional PikPak tokens.' },
    ],
  },
};

// ─────────────────────────────────────────────
// Integrations
// ─────────────────────────────────────────────

export const INTEGRATIONS: Integration[] = [
  {
    name: 'Plex',
    description: 'Stream your media library with Plex.',
    icon: Monitor,
    category: 'media-server',
  },
  {
    name: 'Jellyfin',
    description: 'Free and open-source media system.',
    icon: Film,
    category: 'media-server',
  },
  {
    name: 'Emby',
    description: 'Personal media server.',
    icon: Monitor,
    category: 'media-server',
  },
  {
    name: 'Prowlarr',
    description: 'Indexer manager for the *arr stack.',
    icon: Search,
    category: 'indexer',
  },
  {
    name: 'Jackett',
    description: 'API bridge for torrent indexers.',
    icon: Search,
    category: 'indexer',
  },
  {
    name: 'Seerr',
    description: 'Merged successor to Overseerr + Jellyseerr — the recommended request manager.',
    icon: Globe,
    category: 'request-manager',
  },
  {
    name: 'Overseerr',
    description: 'Media request and discovery tool. Still fully supported as a fallback.',
    icon: Globe,
    category: 'request-manager',
  },
  {
    name: 'Jellyseerr',
    description: 'Fork of Overseerr for Jellyfin. Still fully supported as a fallback.',
    icon: Globe,
    category: 'request-manager',
  },
  // Debrid Providers
  { name: 'TorBox', description: 'All-in-one debrid with torrents, usenet & web downloads.', icon: Cloud, category: 'debrid' },
  { name: 'RealDebrid', description: 'Unrestricted downloader.', icon: Cloud, category: 'debrid' },
  { name: 'AllDebrid', description: 'Multi-hoster and torrent downloader.', icon: Cloud, category: 'debrid' },
  { name: 'Premiumize', description: 'Cloud downloader and VPN service.', icon: Cloud, category: 'debrid' },
  { name: 'Debrid-Link', description: 'French multi-hoster debrid service.', icon: Cloud, category: 'debrid' },
  { name: 'Deepbrid', description: 'Free and premium link generator.', icon: Cloud, category: 'debrid' },
  { name: 'Offcloud', description: 'Cloud-based download manager.', icon: Cloud, category: 'debrid' },
  { name: 'Put.io', description: 'Cloud storage with torrent support.', icon: Cloud, category: 'debrid' },
  { name: 'MegaDebrid', description: 'Multi-hoster without WebDAV.', icon: Cloud, category: 'debrid' },
  { name: 'Seedr', description: 'Cloud torrent client.', icon: Cloud, category: 'debrid' },
  { name: 'PikPak', description: 'Cloud drive with JWT authentication.', icon: Cloud, category: 'debrid' },
];

// ─────────────────────────────────────────────
// Service Toggles (for Docker Compose generator)
// ─────────────────────────────────────────────

export const SERVICES: ServiceToggle[] = [
  {
    envName: 'RUN_MOUNT',
    label: 'rclone FUSE Mounts',
    description: 'Mount debrid cloud storage as local directories via FUSE.',
    defaultValue: false,
  },
  {
    envName: 'RUN_WEBHOOK',
    label: 'Seerr Webhook',
    description: 'Listen for incoming media requests from Seerr (Overseerr/Jellyseerr).',
    defaultValue: true,
  },
  {
    envName: 'RUN_POLLER',
    label: 'API Poller',
    description: 'Periodically poll for new content and status updates.',
    defaultValue: false,
  },
  {
    envName: 'RUN_WATCHLIST_POLLER',
    label: 'Watchlist Poller',
    description: 'Poll Plex watchlists for automatic media requests.',
    defaultValue: false,
  },
  {
    envName: 'RUN_DEAD_SCANNER_WATCH',
    label: 'Dead Scanner',
    description: 'Detect and replace broken or expired content links.',
    defaultValue: false,
  },
  {
    envName: 'RUN_ORGANIZER_WATCH',
    label: 'Media Organiser',
    description: 'Automatically organise media into structured library folders.',
    defaultValue: false,
  },
  {
    envName: 'ARR_BRIDGE_ENABLED',
    label: '*arr Bridge',
    description: 'Emulate a download client for Sonarr/Radarr integration.',
    defaultValue: false,
  },
  {
    envName: 'AUTO_UPDATE_ENABLED',
    label: 'Auto-Update',
    description: 'Automatically pull and restart with the latest SchröDrive version.',
    defaultValue: false,
  },
  {
    envName: 'RUN_WEB_GUI',
    label: 'Web GUI',
    description: 'Enable the 10-page Next.js management dashboard.',
    defaultValue: false,
  },
  {
    envName: 'WEBDAV_MOUNTS_ENABLED',
    label: 'External WebDAV Mounts',
    description: 'Mount third-party WebDAV servers as read-only FUSE filesystems.',
    defaultValue: false,
  },
];

