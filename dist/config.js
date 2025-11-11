"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.requireEnv = requireEnv;
exports.providersSet = providersSet;
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
    torboxApiKey: process.env.TORBOX_API_KEY || "",
    torboxBaseUrl: process.env.TORBOX_BASE_URL || "https://api.torbox.app",
    overseerrAuth: process.env.OVERSEERR_AUTH || "",
    // Overseerr API (poller) configuration
    overseerrUrl: process.env.OVERSEERR_URL || "",
    overseerrApiKey: process.env.OVERSEERR_API_KEY || "",
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
    // Organizer (symlinked view)
    tmdbApiKey: process.env.TMDB_API_KEY || "",
    organizedBase: process.env.ORGANIZED_BASE || `${defaultMountBase}/organized`,
    organizerMode: (process.env.ORGANIZER_MODE || "symlink"),
    runOrganizerWatch: String(process.env.RUN_ORGANIZER_WATCH ?? "false").toLowerCase() === "true",
    orgScanIntervalSeconds: Number(process.env.ORG_SCAN_INTERVAL_S || 300),
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
