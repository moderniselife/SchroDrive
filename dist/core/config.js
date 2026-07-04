"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.requireEnv = requireEnv;
exports.providersSet = providersSet;
const path_1 = __importDefault(require("path"));
const defaultMountBase = (process.env.MOUNT_BASE || (process.platform === 'darwin' ? "/Volumes/SchroDrive" : "/mnt/schrodrive"));
exports.config = {
    port: Number(process.env.PORT || 8978),
    prowlarrUrl: process.env.PROWLARR_URL || "",
    prowlarrApiKey: process.env.PROWLARR_API_KEY || "",
    prowlarrCategories: (process.env.PROWLARR_CATEGORIES || "").split(",").filter(Boolean),
    prowlarrIndexerIds: (process.env.PROWLARR_INDEXER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    prowlarrSearchLimit: Number(process.env.PROWLARR_SEARCH_LIMIT || 100),
    prowlarrTimeoutMs: Number(process.env.PROWLARR_TIMEOUT_MS || 120000),
    prowlarrRedirectMaxHops: Number(process.env.PROWLARR_REDIRECT_MAX_HOPS || 5),
    // Jackett configuration
    jackettUrl: process.env.JACKETT_URL || "",
    jackettApiKey: process.env.JACKETT_API_KEY || "",
    jackettCategories: (process.env.JACKETT_CATEGORIES || "").split(",").filter(Boolean),
    jackettIndexerIds: (process.env.JACKETT_INDEXER_IDS || "").split(",").map((s) => s.trim()).filter(Boolean),
    jackettSearchLimit: Number(process.env.JACKETT_SEARCH_LIMIT || 100),
    jackettTimeoutMs: Number(process.env.JACKETT_TIMEOUT_MS || 120000),
    jackettRedirectMaxHops: Number(process.env.JACKETT_REDIRECT_MAX_HOPS || 5),
    // Indexer selection: "prowlarr" | "jackett" | "auto" (auto tries jackett first if configured, then prowlarr)
    indexerProvider: (process.env.INDEXER_PROVIDER || "auto"),
    torboxApiKey: process.env.TORBOX_API_KEY || "",
    torboxBaseUrl: process.env.TORBOX_BASE_URL || "https://api.torbox.app",
    overseerrAuth: process.env.SEERR_AUTH || process.env.OVERSEERR_AUTH || process.env.JELLYSEERR_AUTH || "",
    // Seerr / Overseerr / Jellyseerr API (poller) configuration
    // Seerr is the merged successor to Overseerr + Jellyseerr — all three share the same API.
    // Priority: SEERR_* > OVERSEERR_* > JELLYSEERR_* (all are supported for backward compatibility)
    overseerrUrl: process.env.SEERR_URL || process.env.OVERSEERR_URL || process.env.JELLYSEERR_URL || "",
    overseerrApiKey: process.env.SEERR_API_KEY || process.env.OVERSEERR_API_KEY || process.env.JELLYSEERR_API_KEY || "",
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_S || 30),
    // Runtime toggles
    runWebhook: String(process.env.RUN_WEBHOOK ?? "true").toLowerCase() !== "false",
    runPoller: String(process.env.RUN_POLLER ?? "false").toLowerCase() === "true",
    // Auto-update
    autoUpdateEnabled: String(process.env.AUTO_UPDATE_ENABLED ?? "false").toLowerCase() === "true",
    autoUpdateIntervalSeconds: Number(process.env.AUTO_UPDATE_INTERVAL_S || 3600),
    autoUpdateStrategy: (process.env.AUTO_UPDATE_STRATEGY || "exit"),
    repoOwner: process.env.REPO_OWNER || "moderniselife",
    repoName: process.env.REPO_NAME || "SchroDrive",
    // Providers
    providers: (process.env.PROVIDERS || "torbox,realdebrid").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    // Add strategy: 'all' (add to all providers for redundancy), 'failover' (try first, fallback on failure), 'single' (first only)
    addStrategy: (process.env.ADD_STRATEGY || "all"),
    // Real-Debrid API
    rdApiBase: process.env.RD_API_BASE || "https://api.real-debrid.com/rest/1.0",
    rdAccessToken: process.env.RD_ACCESS_TOKEN || "",
    // Real-Debrid WebDAV
    rdWebdavUrl: process.env.RD_WEBDAV_URL || "https://dav.real-debrid.com",
    rdWebdavUsername: process.env.RD_WEBDAV_USERNAME || "",
    rdWebdavPassword: process.env.RD_WEBDAV_PASSWORD || "",
    // TorBox WebDAV
    torboxWebdavUrl: process.env.TORBOX_WEBDAV_URL || "https://webdav.torbox.app",
    torboxWebdavUsername: process.env.TORBOX_WEBDAV_USERNAME || "",
    torboxWebdavPassword: process.env.TORBOX_WEBDAV_PASSWORD || "",
    // AllDebrid API
    alldebridApiKey: process.env.ALLDEBRID_API_KEY || "",
    alldebridApiBase: process.env.ALLDEBRID_API_BASE || "https://api.alldebrid.com/v4",
    alldebridAgent: process.env.ALLDEBRID_AGENT || "schrodrive",
    // AllDebrid WebDAV (if supported)
    alldebridWebdavUrl: process.env.ALLDEBRID_WEBDAV_URL || "",
    alldebridWebdavUsername: process.env.ALLDEBRID_WEBDAV_USERNAME || "",
    alldebridWebdavPassword: process.env.ALLDEBRID_WEBDAV_PASSWORD || "",
    // Premiumize API
    premiumizeApiKey: process.env.PREMIUMIZE_API_KEY || "",
    premiumizeApiBase: process.env.PREMIUMIZE_API_BASE || "https://www.premiumize.me/api",
    // Premiumize WebDAV
    premiumizeWebdavUrl: process.env.PREMIUMIZE_WEBDAV_URL || "https://webdav.premiumize.me",
    premiumizeWebdavUsername: process.env.PREMIUMIZE_WEBDAV_USERNAME || "",
    premiumizeWebdavPassword: process.env.PREMIUMIZE_WEBDAV_PASSWORD || '',
    // --- Download Token Rotation (Zurg-style 503 bypass) ---
    rdDownloadTokens: (process.env.RD_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    torboxDownloadTokens: (process.env.TORBOX_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    alldebridDownloadTokens: (process.env.AD_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    premiumizeDownloadTokens: (process.env.PM_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Debrid-Link API
    debridlinkApiKey: process.env.DEBRIDLINK_API_KEY || "",
    debridlinkApiBase: process.env.DEBRIDLINK_API_BASE || "https://debrid-link.com/api/v2",
    // Debrid-Link WebDAV
    debridlinkWebdavUrl: process.env.DEBRIDLINK_WEBDAV_URL || "https://webdav.debrid.link",
    debridlinkWebdavUsername: process.env.DEBRIDLINK_WEBDAV_USERNAME || "",
    debridlinkWebdavPassword: process.env.DEBRIDLINK_WEBDAV_PASSWORD || "",
    debridlinkDownloadTokens: (process.env.DL_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Deepbrid API
    deepbridApiKey: process.env.DEEPBRID_API_KEY || "",
    deepbridApiBase: process.env.DEEPBRID_API_BASE || "https://www.deepbrid.com/api",
    // Deepbrid WebDAV
    deepbridWebdavUrl: process.env.DEEPBRID_WEBDAV_URL || "",
    deepbridWebdavUsername: process.env.DEEPBRID_WEBDAV_USERNAME || "",
    deepbridWebdavPassword: process.env.DEEPBRID_WEBDAV_PASSWORD || "",
    deepbridDownloadTokens: (process.env.DB_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Offcloud API
    offcloudApiKey: process.env.OFFCLOUD_API_KEY || "",
    offcloudApiBase: process.env.OFFCLOUD_API_BASE || "https://offcloud.com/api",
    offcloudWebdavUrl: process.env.OFFCLOUD_WEBDAV_URL || "",
    offcloudWebdavUsername: process.env.OFFCLOUD_WEBDAV_USERNAME || "",
    offcloudWebdavPassword: process.env.OFFCLOUD_WEBDAV_PASSWORD || "",
    offcloudDownloadTokens: (process.env.OC_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Put.io API
    putioOauthToken: process.env.PUTIO_OAUTH_TOKEN || "",
    putioApiBase: process.env.PUTIO_API_BASE || "https://api.put.io/v2",
    putioWebdavUrl: process.env.PUTIO_WEBDAV_URL || "https://webdav.put.io",
    putioWebdavUsername: process.env.PUTIO_WEBDAV_USERNAME || "",
    putioWebdavPassword: process.env.PUTIO_WEBDAV_PASSWORD || "",
    putioDownloadTokens: (process.env.PUTIO_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Mega-Debrid API
    megadebridApiKey: process.env.MEGADEBRID_API_KEY || "",
    megadebridApiBase: process.env.MEGADEBRID_API_BASE || "https://www.mega-debrid.eu",
    megadebridDownloadTokens: (process.env.MD_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // Seedr API
    seedrApiKey: process.env.SEEDR_API_KEY || "",
    seedrApiBase: process.env.SEEDR_API_BASE || "https://www.seedr.cc/rest",
    seedrWebdavUrl: process.env.SEEDR_WEBDAV_URL || "https://dav.seedr.cc",
    seedrWebdavUsername: process.env.SEEDR_WEBDAV_USERNAME || "",
    seedrWebdavPassword: process.env.SEEDR_WEBDAV_PASSWORD || "",
    seedrDownloadTokens: (process.env.SEEDR_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    // PikPak API
    pikpakUsername: process.env.PIKPAK_USERNAME || "",
    pikpakPassword: process.env.PIKPAK_PASSWORD || "",
    pikpakApiBase: process.env.PIKPAK_API_BASE || "https://api-drive.mypikpak.com",
    pikpakWebdavUrl: process.env.PIKPAK_WEBDAV_URL || "",
    pikpakWebdavUsername: process.env.PIKPAK_WEBDAV_USERNAME || "",
    pikpakWebdavPassword: process.env.PIKPAK_WEBDAV_PASSWORD || "",
    pikpakDownloadTokens: (process.env.PIKPAK_DOWNLOAD_TOKENS || '').split(',').filter(Boolean),
    tokenResetTimezone: process.env.TOKEN_RESET_TIMEZONE || 'Australia/Sydney',
    // Mount settings
    mountBase: defaultMountBase,
    rclonePath: process.env.RCLONE_PATH || "rclone",
    mountOptions: process.env.MOUNT_OPTIONS || "--vfs-cache-mode=full --dir-cache-time=12h --poll-interval=0 --buffer-size=64M",
    // Mount permissions/ownership
    mountAllowOther: String(process.env.MOUNT_ALLOW_OTHER ?? "true").toLowerCase() === "true",
    mountUid: (() => {
        const v = process.env.MOUNT_UID || process.env.PUID || "";
        return v ? Number(v) : undefined;
    })(),
    mountGid: (() => {
        const v = process.env.MOUNT_GID || process.env.PGID || "";
        return v ? Number(v) : undefined;
    })(),
    mountDirPerms: process.env.MOUNT_DIR_PERMS || "",
    mountFilePerms: process.env.MOUNT_FILE_PERMS || "",
    // Mount cache flags (individually configurable)
    mountDirCacheTime: process.env.MOUNT_DIR_CACHE_TIME || "12h",
    mountVfsCacheMode: process.env.MOUNT_VFS_CACHE_MODE || "full",
    mountPollInterval: process.env.MOUNT_POLL_INTERVAL || "0",
    mountBufferSize: process.env.MOUNT_BUFFER_SIZE || "64M",
    mountVfsReadChunkSize: process.env.MOUNT_VFS_READ_CHUNK_SIZE || "",
    mountVfsReadChunkSizeLimit: process.env.MOUNT_VFS_READ_CHUNK_SIZE_LIMIT || "",
    mountVfsCacheMaxAge: process.env.MOUNT_VFS_CACHE_MAX_AGE || "",
    mountVfsCacheMaxSize: process.env.MOUNT_VFS_CACHE_MAX_SIZE || "",
    // Dead scanner
    deadScanIntervalSeconds: Number(process.env.DEAD_SCAN_INTERVAL_S || 600),
    deadIdleMinutes: Number(process.env.DEAD_IDLE_MIN || 120),
    // Runtime toggles for additional services
    runMount: String(process.env.RUN_MOUNT ?? "false").toLowerCase() === "true",
    runDeadScanner: String(process.env.RUN_DEAD_SCANNER ?? "false").toLowerCase() === "true",
    runDeadScannerWatch: String(process.env.RUN_DEAD_SCANNER_WATCH ?? "false").toLowerCase() === "true",
    // Organiser (symlinked view)
    tmdbApiKey: process.env.TMDB_API_KEY || "",
    organizedBase: process.env.ORGANIZED_BASE || `${defaultMountBase}/organized`,
    organizerMode: (process.env.ORGANIZER_MODE || "symlink"),
    runOrganizerWatch: String(process.env.RUN_ORGANIZER_WATCH ?? "false").toLowerCase() === "true",
    orgScanIntervalSeconds: Number(process.env.ORG_SCAN_INTERVAL_S || 300),
    // --- Media Server Integration ---
    // Plex
    plexUrl: process.env.PLEX_URL || process.env.PLEX_ADDRESS || "",
    plexToken: process.env.PLEX_TOKEN || "",
    plexMountDir: process.env.PLEX_MOUNT_DIR || "",
    // Jellyfin
    jellyfinUrl: process.env.JELLYFIN_URL || process.env.JF_ADDRESS || "",
    jellyfinApiKey: process.env.JELLYFIN_API_KEY || process.env.JF_API_KEY || "",
    jellyfinUserId: process.env.JELLYFIN_USER_ID || "",
    // Emby
    embyUrl: process.env.EMBY_URL || "",
    embyApiKey: process.env.EMBY_API_KEY || "",
    embyUserId: process.env.EMBY_USER_ID || "",
    // Watchlist poller
    runWatchlistPoller: String(process.env.RUN_WATCHLIST_POLLER ?? "false").toLowerCase() === "true",
    watchlistPollIntervalSeconds: Number(process.env.WATCHLIST_POLL_INTERVAL_S || 60),
    // Refresh library after adding content
    refreshLibraryOnAdd: String(process.env.REFRESH_LIBRARY_ON_ADD ?? "true").toLowerCase() !== "false",
    // --- WebDAV Bridge (API-to-filesystem translation) ---
    webdavBridgeEnabled: String(process.env.WEBDAV_BRIDGE_ENABLED ?? "true").toLowerCase() !== "false",
    webdavBridgePortRD: Number(process.env.WEBDAV_BRIDGE_PORT_RD || 9115),
    webdavBridgePortTB: Number(process.env.WEBDAV_BRIDGE_PORT_TB || 9116),
    webdavBridgePortAD: Number(process.env.WEBDAV_BRIDGE_PORT_AD || 9117),
    webdavBridgePortPM: Number(process.env.WEBDAV_BRIDGE_PORT_PM || 9118),
    webdavBridgePortDL: Number(process.env.WEBDAV_BRIDGE_PORT_DL || 9119),
    webdavBridgePortDB: Number(process.env.WEBDAV_BRIDGE_PORT_DB || 9122),
    webdavBridgePortOC: Number(process.env.WEBDAV_BRIDGE_PORT_OC || 9123),
    webdavBridgePortPUTIO: Number(process.env.WEBDAV_BRIDGE_PORT_PUTIO || 9124),
    webdavBridgePortMD: Number(process.env.WEBDAV_BRIDGE_PORT_MD || 9125),
    webdavBridgePortSEEDR: Number(process.env.WEBDAV_BRIDGE_PORT_SEEDR || 9126),
    webdavBridgePortPIKPAK: Number(process.env.WEBDAV_BRIDGE_PORT_PIKPAK || 9127),
    webdavCacheTtlS: Number(process.env.WEBDAV_CACHE_TTL_S || 30),
    webdavDownloadCacheTtlS: Number(process.env.WEBDAV_DOWNLOAD_CACHE_TTL_S || 14400),
    // --- Trakt Integration ---
    traktClientId: process.env.TRAKT_CLIENT_ID || "",
    traktClientSecret: process.env.TRAKT_CLIENT_SECRET || "",
    traktAccessToken: process.env.TRAKT_ACCESS_TOKEN || "",
    traktRefreshToken: process.env.TRAKT_REFRESH_TOKEN || "",
    traktUsername: process.env.TRAKT_USERNAME || "",
    // --- Mdblist Integration ---
    mdblistApiKey: process.env.MDBLIST_API_KEY || "",
    mdblistListIds: (process.env.MDBLIST_LIST_IDS || "").split(",").map(s => s.trim()).filter(Boolean),
    // --- Listrr Integration ---
    listrrApiKey: process.env.LISTRR_API_KEY || "",
    // --- Stremio Addon Scrapers ---
    // Scraper mode: 'merge' (combine with indexer results), 'fallback' (only when indexer returns 0)
    scraperMode: (process.env.SCRAPER_MODE || "merge"),
    // Torrentio
    torrentioUrl: process.env.TORRENTIO_URL || "https://torrentio.strem.fun",
    torrentioConfig: process.env.TORRENTIO_CONFIG || "",
    // Auto-enable Torrentio when the Stremio addon is active (free public source)
    torrentioEnabled: process.env.TORRENTIO_ENABLED !== undefined
        ? String(process.env.TORRENTIO_ENABLED).toLowerCase() === "true"
        : String(process.env.STREMIO_ADDON_ENABLED ?? "false").toLowerCase() === "true",
    // Comet
    cometUrl: process.env.COMET_URL || "",
    cometConfig: process.env.COMET_CONFIG || "",
    cometEnabled: String(process.env.COMET_ENABLED ?? "false").toLowerCase() === "true",
    // Zilean (DMM hashlists)
    zileanUrl: process.env.ZILEAN_URL || "https://zilean.elfhosted.com",
    zileanEnabled: String(process.env.ZILEAN_ENABLED ?? "false").toLowerCase() === "true",
    // Mediafusion
    mediafusionUrl: process.env.MEDIAFUSION_URL || "https://mediafusion.elfhosted.com",
    mediafusionConfig: process.env.MEDIAFUSION_CONFIG || "",
    mediafusionEnabled: String(process.env.MEDIAFUSION_ENABLED ?? "false").toLowerCase() === "true",
    // --- *arr Bridge (fake qBittorrent API for Radarr/Sonarr) ---
    arrBridgeEnabled: String(process.env.ARR_BRIDGE_ENABLED ?? "false").toLowerCase() === "true",
    arrBridgePort: Number(process.env.ARR_BRIDGE_PORT || 8282),
    // --- Stremio Addon Server (expose SchröDrive as an addon) ---
    stremioAddonEnabled: String(process.env.STREMIO_ADDON_ENABLED ?? "false").toLowerCase() === "true",
    stremioAddonPort: Number(process.env.STREMIO_ADDON_PORT || 7000),
    // --- Torrent Repair ---
    enableRepair: String(process.env.ENABLE_REPAIR ?? "true").toLowerCase() !== "false",
    repairMaxAttempts: Number(process.env.REPAIR_MAX_ATTEMPTS || 3),
    // Pre-emptive repair: detect stalling torrents before they die
    preemptiveRepairEnabled: String(process.env.PREEMPTIVE_REPAIR ?? "true").toLowerCase() !== "false",
    preemptiveRepairStallMinutes: Number(process.env.PREEMPTIVE_REPAIR_STALL_MIN || 30),
    // --- Data Directory & Database ---
    dataDir: process.env.DATA_DIR || './data',
    dbPath: process.env.DB_PATH || path_1.default.join(process.env.DATA_DIR || './data', 'schrodrive.db'),
    // =========================================================================
    // Cloud Storage Mounts
    // =========================================================================
    /** Enable cloud storage mounting via rclone (Mega, Dropbox, GDrive, OneDrive). */
    cloudMountsEnabled: String(process.env.CLOUD_MOUNTS_ENABLED ?? 'false').toLowerCase() === 'true',
    /** Mount cloud storage as read-only (default: true — safer). */
    cloudMountReadOnly: String(process.env.CLOUD_MOUNT_READ_ONLY ?? 'true').toLowerCase() !== 'false',
    // MEGA (fully headless — email + password, no OAuth)
    megaEmail: process.env.MEGA_EMAIL || '',
    megaPassword: process.env.MEGA_PASSWORD || '',
    // Dropbox (OAuth — needs pre-generated token via `rclone authorize "dropbox"`)
    dropboxToken: process.env.DROPBOX_TOKEN || '',
    dropboxClientId: process.env.DROPBOX_CLIENT_ID || '',
    dropboxClientSecret: process.env.DROPBOX_CLIENT_SECRET || '',
    // Google Drive (service account recommended for headless)
    gdriveServiceAccountFile: process.env.GDRIVE_SERVICE_ACCOUNT_FILE || '',
    gdriveToken: process.env.GDRIVE_TOKEN || '',
    gdriveRootFolderId: process.env.GDRIVE_ROOT_FOLDER_ID || '',
    // OneDrive (OAuth — needs pre-generated token via `rclone authorize "onedrive"`)
    onedriveToken: process.env.ONEDRIVE_TOKEN || '',
    onedriveDriveId: process.env.ONEDRIVE_DRIVE_ID || '',
    onedriveDriveType: process.env.ONEDRIVE_DRIVE_TYPE || 'personal',
    // =========================================================================
    // Cloud Link Manager — Public Shared Folder Mounting
    // =========================================================================
    /** Enable the Cloud Link Manager (mounts public shared folder links). */
    cloudLinksEnabled: String(process.env.CLOUD_LINKS_ENABLED ?? 'false').toLowerCase() === 'true',
    /** Path to JSON file containing cloud link configurations. */
    cloudLinksFile: process.env.CLOUD_LINKS_FILE || '/config/cloud_links.json',
    /** Inline JSON array of cloud link configs (fallback if file not found). */
    cloudLinksJson: process.env.CLOUD_LINKS || '',
    /** Google Drive API key (for public folder access — no OAuth needed). */
    gdriveApiKey: process.env.GDRIVE_API_KEY || '',
    /** Port for the Cloud Links WebDAV bridge. */
    cloudLinksBridgePort: Number(process.env.CLOUD_LINKS_PORT || 9121),
    // =========================================================================
    // External WebDAV Mounts — Mount third-party WebDAV servers
    // =========================================================================
    /** Enable external WebDAV mounting via rclone. */
    webdavMountsEnabled: String(process.env.WEBDAV_MOUNTS_ENABLED ?? 'false').toLowerCase() === 'true',
    /** Path to JSON file containing WebDAV mount configurations. */
    webdavMountsFile: process.env.WEBDAV_MOUNTS_FILE || '/config/webdav.json',
    /** Inline JSON array of WebDAV mount configs (fallback if file not found). */
    webdavMountsJson: process.env.WEBDAV_MOUNTS || '',
};
function requireEnv(...keys) {
    const missing = keys.filter((k) => !String(exports.config[k] || "").trim());
    if (missing.length) {
        throw new Error(`Missing required configuration: ${missing.join(", ")}. Set environment variables accordingly.`);
    }
}
function providersSet() {
    return new Set((exports.config.providers || []).map((s) => s.toLowerCase()));
}
