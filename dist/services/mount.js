"use strict";
/**
 * SchroDrive — Virtual Filesystem Mount Manager
 *
 * Handles mounting debrid provider filesystems via rclone. Supports two modes:
 *
 * 1. **Direct WebDAV** — When WebDAV credentials are provided (RD_WEBDAV_*,
 *    TORBOX_WEBDAV_*), rclone connects directly to the provider's WebDAV endpoint.
 *
 * 2. **Bridge mode** — When only API keys are available, SchroDrive starts a
 *    built-in WebDAV server ({@link WebDAVBridge}) that translates provider REST
 *    API calls into a filesystem view. rclone then mounts the local bridge.
 *
 * Manages FUSE mount lifecycle including stale mount cleanup, permission handling,
 * and post-mount verification. Rclone is spawned as a daemon process.
 *
 * Supports both Linux (FUSE/fusermount) and macOS (diskutil) mount management.
 *
 * @module mount
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBridgeStatuses = getBridgeStatuses;
exports.refreshBridges = refreshBridges;
exports.getActiveBridges = getActiveBridges;
exports.mountVirtualDrive = mountVirtualDrive;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const config_1 = require("../core/config");
const webdavBridge_1 = require("./webdavBridge");
// ===========================================================================
// Module-level State
// ===========================================================================
/** Temporary directory for rclone config and logs. Initialised by mountVirtualDrive. */
let tmpDir = path.join(os.tmpdir(), "schrodrive");
// ===========================================================================
// Mount Utilities
// ===========================================================================
/**
 * Checks whether a filesystem error indicates a stale or busy FUSE mountpoint.
 *
 * Common when a previous rclone process crashed without unmounting cleanly,
 * leaving behind a broken FUSE reference.
 *
 * @param e - The error object to inspect.
 * @returns `true` if the error code indicates a stale/busy mount.
 */
function isStaleMountErr(e) {
    const code = (e?.code || "").toString();
    return code === "ENOTCONN" || code === "EBUSY" || code === "EIO" || code === "EEXIST";
}
/**
 * Attempts to forcefully unmount a stale FUSE mountpoint at the given path.
 *
 * On Linux, tries `fusermount3`, `fusermount`, and `umount` in sequence.
 * On macOS, tries `umount -f` and `diskutil unmount force`.
 * Errors are silently swallowed as this is a best-effort cleanup.
 *
 * @param p - The absolute path to the mount point to clean up.
 */
function cleanupMountPath(p) {
    try {
        if (process.platform === "linux") {
            // Try to lazily unmount FUSE mounts
            (0, child_process_1.spawnSync)("fusermount3", ["-uz", p], { stdio: "ignore" });
            (0, child_process_1.spawnSync)("fusermount", ["-uz", p], { stdio: "ignore" });
            (0, child_process_1.spawnSync)("umount", ["-l", p], { stdio: "ignore" });
        }
        else if (process.platform === "darwin") {
            (0, child_process_1.spawnSync)("umount", ["-f", p], { stdio: "ignore" });
            (0, child_process_1.spawnSync)("diskutil", ["unmount", "force", p], { stdio: "ignore" });
        }
    }
    catch { }
}
/**
 * Ensures a directory exists, creating it recursively if needed.
 * Detects stale FUSE mountpoints by attempting to read the directory
 * and optionally cleans them up before retrying.
 *
 * @param p - The absolute path to ensure exists.
 * @param opts - Options controlling stale mount behaviour.
 * @param opts.cleanupOnStale - Whether to attempt cleanup on stale mounts. Defaults to `true`.
 * @throws {Error} If the directory cannot be created or accessed after cleanup.
 */
function ensureDir(p, opts) {
    const cleanupOnStale = opts?.cleanupOnStale ?? true;
    try {
        if (!fs.existsSync(p)) {
            fs.mkdirSync(p, { recursive: true });
        }
        else {
            // Touch directory to detect stale FUSE mountpoints
            fs.readdirSync(p);
        }
    }
    catch (e) {
        if (cleanupOnStale && isStaleMountErr(e)) {
            console.warn(`[${new Date().toISOString()}][mount] detected stale/busy mount at ${p}, attempting cleanup`);
            cleanupMountPath(p);
            // Retry creation/access
            try {
                if (!fs.existsSync(p))
                    fs.mkdirSync(p, { recursive: true });
                fs.readdirSync(p);
            }
            catch (e2) {
                throw e2;
            }
        }
        else {
            throw e;
        }
    }
}
// ===========================================================================
// Rclone Configuration
// ===========================================================================
/**
 * Obscures a plaintext password using rclone's built-in `obscure` command.
 * Rclone requires passwords in its config file to be obscured rather than
 * stored in plaintext.
 *
 * Falls back to returning the raw password if obscuring fails.
 *
 * @param password - The plaintext password to obscure.
 * @returns The obscured password string, or the original if obscuring failed.
 */
function obscurePassword(password) {
    if (!password)
        return "";
    try {
        const res = (0, child_process_1.spawnSync)(config_1.config.rclonePath, ["obscure", password], { encoding: "utf8" });
        if (res.status === 0 && res.stdout)
            return res.stdout.trim();
    }
    catch { }
    return password;
}
// ===========================================================================
// Active WebDAV Bridges (module-level for status reporting)
// ===========================================================================
/** Active bridge instances, keyed by provider name. */
const activeBridges = new Map();
/**
 * Returns the status of all active WebDAV bridge instances.
 * Used by the API status endpoint.
 */
function getBridgeStatuses() {
    return Array.from(activeBridges.values()).map((b) => b.getStatus());
}
/**
 * Forces a cache refresh on all active WebDAV bridges.
 * Used by the API refresh endpoint.
 */
async function refreshBridges() {
    for (const b of activeBridges.values()) {
        await b.refresh();
    }
}
/**
 * Returns the active bridge instances for external consumers
 * (e.g. dead scanner checking for bridge-detected dead torrents).
 */
function getActiveBridges() {
    return activeBridges;
}
/**
 * Checks if a provider has direct WebDAV credentials configured.
 */
function hasDirectWebDAV(provider) {
    if (provider === "realdebrid") {
        return !!(config_1.config.rdWebdavUrl && config_1.config.rdWebdavUsername && config_1.config.rdWebdavPassword);
    }
    if (provider === "torbox") {
        return !!(config_1.config.torboxWebdavUrl && config_1.config.torboxWebdavUsername && config_1.config.torboxWebdavPassword);
    }
    if (provider === "alldebrid") {
        return !!(config_1.config.alldebridWebdavUrl && config_1.config.alldebridWebdavUsername && config_1.config.alldebridWebdavPassword);
    }
    if (provider === "premiumize") {
        return !!(config_1.config.premiumizeWebdavUrl && config_1.config.premiumizeWebdavUsername && config_1.config.premiumizeWebdavPassword);
    }
    return false;
}
/**
 * Checks if a provider has an API key configured (for bridge mode).
 */
function hasApiKey(provider) {
    if (provider === "realdebrid")
        return !!config_1.config.rdAccessToken;
    if (provider === "torbox")
        return !!config_1.config.torboxApiKey;
    if (provider === "alldebrid")
        return !!config_1.config.alldebridApiKey;
    if (provider === "premiumize")
        return !!config_1.config.premiumizeApiKey;
    return false;
}
/**
 * Generates a temporary rclone configuration file containing WebDAV
 * remote definitions for all configured providers.
 *
 * Supports two modes per provider:
 * - **Direct WebDAV**: Uses external WebDAV credentials (RD_WEBDAV_*, TORBOX_WEBDAV_*)
 * - **Bridge mode**: Uses the built-in WebDAV bridge on localhost (API key only)
 *
 * @param bridgePorts - Map of provider name to local bridge port (for bridge-mode providers)
 * @returns The absolute path to the generated rclone config file, or empty string if nothing to mount.
 */
function buildRcloneConfigFile(bridgePorts) {
    const lines = [];
    const ps = (0, config_1.providersSet)();
    // RealDebrid: direct WebDAV or bridge
    if (ps.has("realdebrid")) {
        if (hasDirectWebDAV("realdebrid")) {
            console.log(`[${new Date().toISOString()}][mount] RealDebrid: using direct WebDAV credentials`);
            lines.push(`[rd]`);
            lines.push(`type = webdav`);
            lines.push(`url = ${config_1.config.rdWebdavUrl}`);
            lines.push(`vendor = other`);
            lines.push(`user = ${config_1.config.rdWebdavUsername}`);
            lines.push(`pass = ${obscurePassword(config_1.config.rdWebdavPassword)}`);
            lines.push("");
        }
        else if (bridgePorts.has("realdebrid")) {
            const port = bridgePorts.get("realdebrid");
            console.log(`[${new Date().toISOString()}][mount] RealDebrid: using WebDAV bridge on port ${port}`);
            lines.push(`[rd]`);
            lines.push(`type = webdav`);
            lines.push(`url = http://localhost:${port}`);
            lines.push(`vendor = other`);
            // No auth needed for local bridge
            lines.push("");
        }
    }
    // TorBox: direct WebDAV or bridge
    if (ps.has("torbox")) {
        if (hasDirectWebDAV("torbox")) {
            console.log(`[${new Date().toISOString()}][mount] TorBox: using direct WebDAV credentials`);
            lines.push(`[torbox]`);
            lines.push(`type = webdav`);
            lines.push(`url = ${config_1.config.torboxWebdavUrl}`);
            lines.push(`vendor = other`);
            lines.push(`user = ${config_1.config.torboxWebdavUsername}`);
            lines.push(`pass = ${obscurePassword(config_1.config.torboxWebdavPassword)}`);
            lines.push("");
        }
        else if (bridgePorts.has("torbox")) {
            const port = bridgePorts.get("torbox");
            console.log(`[${new Date().toISOString()}][mount] TorBox: using WebDAV bridge on port ${port}`);
            lines.push(`[torbox]`);
            lines.push(`type = webdav`);
            lines.push(`url = http://localhost:${port}`);
            lines.push(`vendor = other`);
            lines.push("");
        }
    }
    // AllDebrid: direct WebDAV or bridge
    if (ps.has("alldebrid")) {
        if (hasDirectWebDAV("alldebrid")) {
            console.log(`[${new Date().toISOString()}][mount] AllDebrid: using direct WebDAV credentials`);
            lines.push(`[alldebrid]`);
            lines.push(`type = webdav`);
            lines.push(`url = ${config_1.config.alldebridWebdavUrl}`);
            lines.push(`vendor = other`);
            lines.push(`user = ${config_1.config.alldebridWebdavUsername}`);
            lines.push(`pass = ${obscurePassword(config_1.config.alldebridWebdavPassword)}`);
            lines.push("");
        }
        else if (bridgePorts.has("alldebrid")) {
            const port = bridgePorts.get("alldebrid");
            console.log(`[${new Date().toISOString()}][mount] AllDebrid: using WebDAV bridge on port ${port}`);
            lines.push(`[alldebrid]`);
            lines.push(`type = webdav`);
            lines.push(`url = http://localhost:${port}`);
            lines.push(`vendor = other`);
            lines.push("");
        }
    }
    // Premiumize: direct WebDAV or bridge
    if (ps.has("premiumize")) {
        if (hasDirectWebDAV("premiumize")) {
            console.log(`[${new Date().toISOString()}][mount] Premiumize: using direct WebDAV credentials`);
            lines.push(`[premiumize]`);
            lines.push(`type = webdav`);
            lines.push(`url = ${config_1.config.premiumizeWebdavUrl}`);
            lines.push(`vendor = other`);
            lines.push(`user = ${config_1.config.premiumizeWebdavUsername}`);
            lines.push(`pass = ${obscurePassword(config_1.config.premiumizeWebdavPassword)}`);
            lines.push("");
        }
        else if (bridgePorts.has("premiumize")) {
            const port = bridgePorts.get("premiumize");
            console.log(`[${new Date().toISOString()}][mount] Premiumize: using WebDAV bridge on port ${port}`);
            lines.push(`[premiumize]`);
            lines.push(`type = webdav`);
            lines.push(`url = http://localhost:${port}`);
            lines.push(`vendor = other`);
            lines.push("");
        }
    }
    if (!lines.length) {
        console.warn(`[${new Date().toISOString()}][mount] No mount sources available. Need WebDAV creds or API keys.`);
        return "";
    }
    const dir = path.join(os.tmpdir(), "schrodrive");
    ensureDir(dir);
    const cfg = path.join(dir, "rclone.conf");
    fs.writeFileSync(cfg, lines.join("\n"), "utf8");
    return cfg;
}
// ---------------------------------------------------------------------------
// Argument Helpers
// ---------------------------------------------------------------------------
/**
 * Splits a whitespace-delimited options string into individual arguments.
 *
 * @param opts - The options string to split.
 * @returns An array of individual argument strings.
 */
function splitArgs(opts) {
    const s = (opts || "").trim();
    if (!s)
        return [];
    return s.split(/\s+/);
}
/**
 * Checks whether user-provided mount options already include log verbosity flags.
 * Used to avoid conflicting with user-specified `--log-level` or `-v` flags.
 *
 * @param opts - The mount options string to check.
 * @returns `true` if the options contain log-level flags.
 */
function hasUserLogFlags(opts) {
    const tokens = splitArgs(opts || "");
    return tokens.some((t) => t === "-v" || t === "-vv" || t === "-vvv" || t.startsWith("--log-level"));
}
/**
 * Returns a promise that resolves after the specified number of milliseconds.
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Checks whether the FUSE `allow_other` option is available on the system.
 * This requires `user_allow_other` to be uncommented in `/etc/fuse.conf`.
 *
 * Only relevant on Linux; silently returns `false` on other platforms or
 * if the config file is unreadable.
 *
 * @returns `true` if `--allow-other` can be safely used.
 */
function canAllowOther() {
    try {
        const s = fs.readFileSync("/etc/fuse.conf", "utf8");
        // Consider uncommented presence of user_allow_other sufficient
        return /(^|\n)\s*user_allow_other\s*($|#)/.test(s);
    }
    catch {
        return false;
    }
}
// ===========================================================================
// Mount Execution
// ===========================================================================
/**
 * Tests whether an rclone remote is accessible by listing its root directory.
 * Used as a pre-flight check before attempting to mount.
 *
 * Uses async spawn instead of spawnSync to avoid blocking the event loop —
 * this is critical when using the WebDAV bridge, as the bridge HTTP server
 * must be able to respond to rclone's PROPFIND requests on the same process.
 *
 * @param remote - The rclone remote name (e.g. "rd:", "torbox:").
 * @param cfgPath - The path to the rclone configuration file.
 * @returns `true` if the remote responded successfully.
 */
async function testRemote(remote, cfgPath) {
    return new Promise((resolve) => {
        try {
            const child = (0, child_process_1.spawn)(config_1.config.rclonePath, ["lsd", remote, "--config", cfgPath, "--contimeout=15s", "--timeout=30s"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
            let stderr = "";
            child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
            // Timeout: don't wait forever
            const timer = setTimeout(() => {
                child.kill("SIGTERM");
                console.warn(`[${new Date().toISOString()}][mount] rclone test for ${remote} timed out after 30s`);
                resolve(false);
            }, 30000);
            child.on("close", (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(true);
                }
                else {
                    console.error(`[${new Date().toISOString()}][mount] rclone test for ${remote} failed`, { status: code, stderr: stderr.trim().slice(0, 500) || null });
                    resolve(false);
                }
            });
            child.on("error", (e) => {
                clearTimeout(timer);
                console.error(`[${new Date().toISOString()}][mount] rclone test error for ${remote}`, { err: e?.message });
                resolve(false);
            });
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][mount] rclone test spawn error for ${remote}`, { err: e?.message });
            resolve(false);
        }
    });
}
/**
 * Mounts all configured debrid providers as virtual filesystems using rclone.
 *
 * Supports two mount strategies per provider:
 * - **Direct WebDAV**: rclone connects to the provider's remote WebDAV endpoint
 * - **Bridge mode**: A local WebDAV server is started first ({@link WebDAVBridge}),
 *   translating provider API calls into a filesystem. rclone then mounts the
 *   local bridge endpoint.
 *
 * Priority: Direct WebDAV credentials > API key (bridge) > skip
 *
 * For each provider:
 * 1. Determines mount strategy (direct vs bridge)
 * 2. Starts WebDAV bridges for API-key-only providers
 * 3. Builds rclone config pointing at the appropriate WebDAV endpoints
 * 4. Tests the remote is accessible via `rclone lsd`
 * 5. Spawns rclone as a daemon process
 * 6. Performs a best-effort post-mount verification after a short delay
 */
async function mountVirtualDrive() {
    const ps = (0, config_1.providersSet)();
    const bridgePorts = new Map();
    // -----------------------------------------------------------------------
    // Phase 1: Start WebDAV bridges for providers with API keys but no WebDAV creds
    // -----------------------------------------------------------------------
    if (config_1.config.webdavBridgeEnabled) {
        const maxAttempts = 20;
        if (ps.has("realdebrid") && !hasDirectWebDAV("realdebrid") && hasApiKey("realdebrid")) {
            console.log(`[${new Date().toISOString()}][mount] RealDebrid: no WebDAV creds, starting API bridge...`);
            let port = config_1.config.webdavBridgePortRD;
            let bridge = null;
            for (let i = 0; i < maxAttempts; i++) {
                while (Array.from(bridgePorts.values()).includes(port)) {
                    port++;
                }
                try {
                    const testBridge = new webdavBridge_1.WebDAVBridge({
                        provider: "realdebrid",
                        port: port,
                        cacheTtlS: config_1.config.webdavCacheTtlS,
                        downloadCacheTtlS: config_1.config.webdavDownloadCacheTtlS,
                    });
                    await testBridge.start();
                    bridge = testBridge;
                    break;
                }
                catch (err) {
                    if (i === maxAttempts - 1) {
                        console.error(`[${new Date().toISOString()}][mount] Failed to start RealDebrid bridge after ${maxAttempts} attempts:`, err?.message);
                        break;
                    }
                    console.warn(`[${new Date().toISOString()}][mount] RealDebrid port ${port} in use, trying next port...`);
                    port++;
                }
            }
            if (bridge) {
                activeBridges.set("realdebrid", bridge);
                bridgePorts.set("realdebrid", port);
                console.log(`[${new Date().toISOString()}][mount] RealDebrid bridge started on port ${port}`);
            }
        }
        if (ps.has("torbox") && !hasDirectWebDAV("torbox") && hasApiKey("torbox")) {
            console.log(`[${new Date().toISOString()}][mount] TorBox: no WebDAV creds, starting API bridge...`);
            let port = config_1.config.webdavBridgePortTB;
            let bridge = null;
            for (let i = 0; i < maxAttempts; i++) {
                while (Array.from(bridgePorts.values()).includes(port)) {
                    port++;
                }
                try {
                    const testBridge = new webdavBridge_1.WebDAVBridge({
                        provider: "torbox",
                        port: port,
                        cacheTtlS: config_1.config.webdavCacheTtlS,
                        downloadCacheTtlS: config_1.config.webdavDownloadCacheTtlS,
                    });
                    await testBridge.start();
                    bridge = testBridge;
                    break;
                }
                catch (err) {
                    if (i === maxAttempts - 1) {
                        console.error(`[${new Date().toISOString()}][mount] Failed to start TorBox bridge after ${maxAttempts} attempts:`, err?.message);
                        break;
                    }
                    console.warn(`[${new Date().toISOString()}][mount] TorBox port ${port} in use, trying next port...`);
                    port++;
                }
            }
            if (bridge) {
                activeBridges.set("torbox", bridge);
                bridgePorts.set("torbox", port);
                console.log(`[${new Date().toISOString()}][mount] TorBox bridge started on port ${port}`);
            }
        }
        if (ps.has("alldebrid") && !hasDirectWebDAV("alldebrid") && hasApiKey("alldebrid")) {
            console.log(`[${new Date().toISOString()}][mount] AllDebrid: no WebDAV creds, starting API bridge...`);
            let port = config_1.config.webdavBridgePortAD;
            let bridge = null;
            for (let i = 0; i < maxAttempts; i++) {
                while (Array.from(bridgePorts.values()).includes(port)) {
                    port++;
                }
                try {
                    const testBridge = new webdavBridge_1.WebDAVBridge({
                        provider: "alldebrid",
                        port: port,
                        cacheTtlS: config_1.config.webdavCacheTtlS,
                        downloadCacheTtlS: config_1.config.webdavDownloadCacheTtlS,
                    });
                    await testBridge.start();
                    bridge = testBridge;
                    break;
                }
                catch (err) {
                    if (i === maxAttempts - 1) {
                        console.error(`[${new Date().toISOString()}][mount] Failed to start AllDebrid bridge after ${maxAttempts} attempts:`, err?.message);
                        break;
                    }
                    console.warn(`[${new Date().toISOString()}][mount] AllDebrid port ${port} in use, trying next port...`);
                    port++;
                }
            }
            if (bridge) {
                activeBridges.set("alldebrid", bridge);
                bridgePorts.set("alldebrid", port);
                console.log(`[${new Date().toISOString()}][mount] AllDebrid bridge started on port ${port}`);
            }
        }
        if (ps.has("premiumize") && !hasDirectWebDAV("premiumize") && hasApiKey("premiumize")) {
            console.log(`[${new Date().toISOString()}][mount] Premiumize: no WebDAV creds, starting API bridge...`);
            let port = config_1.config.webdavBridgePortPM;
            let bridge = null;
            for (let i = 0; i < maxAttempts; i++) {
                while (Array.from(bridgePorts.values()).includes(port)) {
                    port++;
                }
                try {
                    const testBridge = new webdavBridge_1.WebDAVBridge({
                        provider: "premiumize",
                        port: port,
                        cacheTtlS: config_1.config.webdavCacheTtlS,
                        downloadCacheTtlS: config_1.config.webdavDownloadCacheTtlS,
                    });
                    await testBridge.start();
                    bridge = testBridge;
                    break;
                }
                catch (err) {
                    if (i === maxAttempts - 1) {
                        console.error(`[${new Date().toISOString()}][mount] Failed to start Premiumize bridge after ${maxAttempts} attempts:`, err?.message);
                        break;
                    }
                    console.warn(`[${new Date().toISOString()}][mount] Premiumize port ${port} in use, trying next port...`);
                    port++;
                }
            }
            if (bridge) {
                activeBridges.set("premiumize", bridge);
                bridgePorts.set("premiumize", port);
                console.log(`[${new Date().toISOString()}][mount] Premiumize bridge started on port ${port}`);
            }
        }
    }
    // -----------------------------------------------------------------------
    // Phase 2: Build rclone config (uses direct WebDAV or bridge endpoints)
    // -----------------------------------------------------------------------
    const cfg = buildRcloneConfigFile(bridgePorts);
    if (!cfg) {
        console.warn(`[${new Date().toISOString()}][mount] No mount sources configured. Skipping FUSE mount.`);
        console.warn(`[${new Date().toISOString()}][mount] Provide WebDAV credentials OR API keys with WEBDAV_BRIDGE_ENABLED=true.`);
        return;
    }
    const base = config_1.config.mountBase;
    // Never attempt to unmount/cleanup the base — it may be a bind mount from host
    ensureDir(base, { cleanupOnStale: false });
    tmpDir = path.join(os.tmpdir(), "schrodrive");
    ensureDir(tmpDir, { cleanupOnStale: false });
    // -----------------------------------------------------------------------
    // Phase 3: Determine which remotes to mount
    // -----------------------------------------------------------------------
    const mounts = [];
    // Mount if we have direct WebDAV OR a running bridge
    if (ps.has("realdebrid") && (hasDirectWebDAV("realdebrid") || bridgePorts.has("realdebrid"))) {
        mounts.push({ remote: "rd:", path: path.join(base, "realdebrid") });
    }
    if (ps.has("torbox") && (hasDirectWebDAV("torbox") || bridgePorts.has("torbox"))) {
        mounts.push({ remote: "torbox:", path: path.join(base, "torbox") });
    }
    if (ps.has("alldebrid") && (hasDirectWebDAV("alldebrid") || bridgePorts.has("alldebrid"))) {
        mounts.push({ remote: "alldebrid:", path: path.join(base, "alldebrid") });
    }
    if (ps.has("premiumize") && (hasDirectWebDAV("premiumize") || bridgePorts.has("premiumize"))) {
        mounts.push({ remote: "premiumize:", path: path.join(base, "premiumize") });
    }
    if (!mounts.length) {
        console.warn(`[${new Date().toISOString()}][mount] No providers ready to mount.`);
        return;
    }
    for (const m of mounts) {
        // Safe to cleanup the leaf mount path only
        ensureDir(m.path, { cleanupOnStale: true });
        if (!(await testRemote(m.remote, cfg))) {
            continue;
        }
        const args = [
            "mount",
            m.remote,
            m.path,
            "--config",
            cfg,
        ];
        if (canAllowOther()) {
            args.push("--allow-other");
        }
        else {
            console.log(`[${new Date().toISOString()}][mount] skipping --allow-other (no user_allow_other in /etc/fuse.conf)`);
        }
        args.push("--allow-non-empty");
        // Apply user-provided mount options or fall back to configured defaults
        if (config_1.config.mountOptions && config_1.config.mountOptions.trim()) {
            args.push(...splitArgs(config_1.config.mountOptions));
        }
        else {
            args.push(`--poll-interval=${config_1.config.mountPollInterval}`);
            args.push(`--dir-cache-time=${config_1.config.mountDirCacheTime}`);
            args.push(`--vfs-cache-mode=${config_1.config.mountVfsCacheMode}`);
            args.push(`--buffer-size=${config_1.config.mountBufferSize}`);
            if ((config_1.config.mountVfsReadChunkSize || "").trim())
                args.push(`--vfs-read-chunk-size=${config_1.config.mountVfsReadChunkSize}`);
            if ((config_1.config.mountVfsReadChunkSizeLimit || "").trim())
                args.push(`--vfs-read-chunk-size-limit=${config_1.config.mountVfsReadChunkSizeLimit}`);
            if ((config_1.config.mountVfsCacheMaxAge || "").trim())
                args.push(`--vfs-cache-max-age=${config_1.config.mountVfsCacheMaxAge}`);
            if ((config_1.config.mountVfsCacheMaxSize || "").trim())
                args.push(`--vfs-cache-max-size=${config_1.config.mountVfsCacheMaxSize}`);
        }
        // Ownership and permissions presentation for FUSE mount
        if (typeof config_1.config.mountUid === "number") {
            args.push("--uid", String(config_1.config.mountUid));
        }
        if (typeof config_1.config.mountGid === "number") {
            args.push("--gid", String(config_1.config.mountGid));
        }
        if ((config_1.config.mountDirPerms || "").trim()) {
            args.push(`--dir-perms=${config_1.config.mountDirPerms}`);
        }
        if ((config_1.config.mountFilePerms || "").trim()) {
            args.push(`--file-perms=${config_1.config.mountFilePerms}`);
        }
        // Provide a sensible default umask if no explicit perms given
        if (!(config_1.config.mountDirPerms || config_1.config.mountFilePerms)) {
            args.push("--umask", "0022");
        }
        // Ensure we capture rclone logs without conflicting with user-provided verbosity
        const logFile = path.join(tmpDir, `rclone-${m.remote.replace(":", "")}.log`);
        if (!hasUserLogFlags(config_1.config.mountOptions)) {
            args.push(`--log-level=INFO`);
        }
        args.push(`--log-file=${logFile}`);
        args.push("--daemon");
        console.log(`[${new Date().toISOString()}][mount] rclone ${args.join(" ")}`);
        const p = (0, child_process_1.spawn)(config_1.config.rclonePath, args, { stdio: "inherit" });
        p.on("error", (e) => {
            console.error(`[${new Date().toISOString()}][mount] failed`, { remote: m.remote, err: e?.message });
        });
        p.on("close", (code) => {
            if (code !== 0) {
                console.error(`[${new Date().toISOString()}][mount] daemon exited with code ${code} for ${m.remote}`);
            }
        });
        // Quick post-mount verification (best-effort, non-blocking)
        // IMPORTANT: Do NOT use readdirSync here — FUSE mounts trigger PROPFIND
        // to the WebDAV bridge, which needs the event loop to respond.
        try {
            await sleep(3000);
            const items = await Promise.race([
                fs.promises.readdir(m.path),
                sleep(10000).then(() => { throw new Error("readdir timed out after 10s"); }),
            ]);
            console.log(`[${new Date().toISOString()}][mount] verify ${m.remote} at ${m.path} -> entries=${items.length}`);
        }
        catch (e) {
            console.warn(`[${new Date().toISOString()}][mount] verify warning for ${m.remote} at ${m.path}`, { err: e?.message });
            console.warn(`[${new Date().toISOString()}][mount] mount may still be initialising — see rclone log: ${logFile}`);
        }
    }
    console.log(`[${new Date().toISOString()}][mount] mounts initiated at ${base}`);
    // Start the mount health monitor to detect and recover from IO errors
    startMountHealthMonitor(mounts, cfg, base);
}
// ===========================================================================
// Mount Health Monitor
// ===========================================================================
/**
 * Mount health monitor configuration.
 * Periodically checks rclone log files for persistent IO errors
 * (423 Locked, transport connection broken, etc.) and auto-remounts
 * when the error rate exceeds a threshold.
 *
 * This is the primary defence against the cascade failure pattern
 * from pd_zurg where a burst of 423 errors would permanently break
 * the FUSE mount until manual restart.
 */
/** Number of consecutive health check failures before triggering a remount. */
const HEALTH_CHECK_FAILURE_THRESHOLD = 5;
/** Interval between health checks in milliseconds. */
const HEALTH_CHECK_INTERVAL_MS = 60000; // 1 minute
/** Error patterns that indicate a problematic mount. */
const MOUNT_ERROR_PATTERNS = [
    "423 Locked",
    "IO error",
    "transport connection broken",
    "connection reset by peer",
    "502 Bad Gateway",
    "503 Service Unavailable",
    "vfs cache: failed to open",
];
/**
 * Starts a background health monitor for all active rclone mounts.
 * Periodically reads rclone log files and checks the FUSE mount accessibility.
 * If persistent errors are detected, automatically remounts the affected provider.
 */
function startMountHealthMonitor(mounts, rcloneConfigPath, _base) {
    const failureCounts = {};
    const logPositions = {};
    for (const m of mounts) {
        failureCounts[m.remote] = 0;
        logPositions[m.remote] = 0;
    }
    console.log(`[${new Date().toISOString()}][mount-health] started monitoring ${mounts.length} mount(s)`);
    setInterval(async () => {
        for (const m of mounts) {
            const remoteName = m.remote.replace(":", "");
            const logFile = path.join(tmpDir, `rclone-${remoteName}.log`);
            let hasErrors = false;
            // 1. Check rclone log for new errors since last read
            try {
                const stat = fs.statSync(logFile);
                if (stat.size > logPositions[m.remote]) {
                    const fd = fs.openSync(logFile, "r");
                    const bufSize = Math.min(stat.size - logPositions[m.remote], 8192);
                    const buf = Buffer.alloc(bufSize);
                    fs.readSync(fd, buf, 0, bufSize, logPositions[m.remote]);
                    fs.closeSync(fd);
                    logPositions[m.remote] = stat.size;
                    const newLogs = buf.toString("utf8");
                    const errorLines = newLogs.split("\n").filter((line) => MOUNT_ERROR_PATTERNS.some((p) => line.includes(p)));
                    if (errorLines.length > 0) {
                        hasErrors = true;
                        console.warn(`[${new Date().toISOString()}][mount-health] ${m.remote} detected ${errorLines.length} error(s) in rclone log`);
                    }
                }
            }
            catch {
                // Log file might not exist yet — that's fine
            }
            // 2. Check FUSE mount accessibility (non-blocking)
            try {
                const items = await Promise.race([
                    fs.promises.readdir(m.path),
                    sleep(5000).then(() => { throw new Error("readdir timed out"); }),
                ]);
                if (items.length === 0) {
                    hasErrors = true;
                    console.warn(`[${new Date().toISOString()}][mount-health] ${m.remote} mount at ${m.path} is empty`);
                }
            }
            catch (e) {
                hasErrors = true;
                console.warn(`[${new Date().toISOString()}][mount-health] ${m.remote} mount at ${m.path} inaccessible: ${e?.message}`);
            }
            // 3. Update failure counter and trigger remount if needed
            if (hasErrors) {
                failureCounts[m.remote]++;
                console.warn(`[${new Date().toISOString()}][mount-health] ${m.remote} failure streak: ${failureCounts[m.remote]}/${HEALTH_CHECK_FAILURE_THRESHOLD}`);
                if (failureCounts[m.remote] >= HEALTH_CHECK_FAILURE_THRESHOLD) {
                    console.error(`[${new Date().toISOString()}][mount-health] ${m.remote} exceeded failure threshold — initiating remount`);
                    await attemptRemount(m, rcloneConfigPath);
                    failureCounts[m.remote] = 0;
                    logPositions[m.remote] = 0; // Reset log position after remount
                }
            }
            else {
                // Reset counter on successful check
                if (failureCounts[m.remote] > 0) {
                    console.log(`[${new Date().toISOString()}][mount-health] ${m.remote} recovered — resetting failure counter`);
                }
                failureCounts[m.remote] = 0;
            }
        }
    }, HEALTH_CHECK_INTERVAL_MS);
}
/**
 * Attempts to remount a failed rclone FUSE mount.
 * Cleans up the stale mount, then re-spawns rclone with the same config.
 */
async function attemptRemount(mount, rcloneConfigPath) {
    const ts = () => new Date().toISOString();
    console.log(`[${ts()}][mount-health] unmounting ${mount.remote} at ${mount.path}...`);
    // Unmount the stale FUSE mount
    cleanupMountPath(mount.path);
    // Wait a moment for cleanup
    await sleep(2000);
    // Ensure mount directory exists
    ensureDir(mount.path, { cleanupOnStale: false });
    // Rebuild rclone mount args
    const args = [
        "mount",
        mount.remote,
        mount.path,
        "--config", rcloneConfigPath,
    ];
    if (canAllowOther()) {
        args.push("--allow-other");
    }
    args.push("--allow-non-empty");
    // Apply configured mount options
    if (config_1.config.mountOptions && config_1.config.mountOptions.trim()) {
        args.push(...splitArgs(config_1.config.mountOptions));
    }
    else {
        args.push(`--poll-interval=${config_1.config.mountPollInterval}`);
        args.push(`--dir-cache-time=${config_1.config.mountDirCacheTime}`);
        args.push(`--vfs-cache-mode=${config_1.config.mountVfsCacheMode}`);
        args.push(`--buffer-size=${config_1.config.mountBufferSize}`);
        if ((config_1.config.mountVfsReadChunkSize || "").trim())
            args.push(`--vfs-read-chunk-size=${config_1.config.mountVfsReadChunkSize}`);
        if ((config_1.config.mountVfsReadChunkSizeLimit || "").trim())
            args.push(`--vfs-read-chunk-size-limit=${config_1.config.mountVfsReadChunkSizeLimit}`);
        if ((config_1.config.mountVfsCacheMaxAge || "").trim())
            args.push(`--vfs-cache-max-age=${config_1.config.mountVfsCacheMaxAge}`);
        if ((config_1.config.mountVfsCacheMaxSize || "").trim())
            args.push(`--vfs-cache-max-size=${config_1.config.mountVfsCacheMaxSize}`);
    }
    if (!(config_1.config.mountDirPerms || config_1.config.mountFilePerms)) {
        args.push("--umask", "0022");
    }
    const remoteName = mount.remote.replace(":", "");
    const logFile = path.join(tmpDir, `rclone-${remoteName}.log`);
    if (!hasUserLogFlags(config_1.config.mountOptions)) {
        args.push("--log-level=INFO");
    }
    args.push(`--log-file=${logFile}`);
    args.push("--daemon");
    console.log(`[${ts()}][mount-health] re-mounting: rclone ${args.join(" ")}`);
    const p = (0, child_process_1.spawn)(config_1.config.rclonePath, args, { stdio: "inherit" });
    p.on("error", (e) => {
        console.error(`[${ts()}][mount-health] remount failed for ${mount.remote}`, { err: e?.message });
    });
    p.on("close", (code) => {
        if (code !== 0) {
            console.error(`[${ts()}][mount-health] remount daemon exited with code ${code} for ${mount.remote}`);
        }
    });
    // Verify post-remount
    try {
        await sleep(5000);
        const items = await Promise.race([
            fs.promises.readdir(mount.path),
            sleep(10000).then(() => { throw new Error("readdir timed out"); }),
        ]);
        console.log(`[${ts()}][mount-health] remount verify ${mount.remote} → entries=${items.length}`);
    }
    catch (e) {
        console.error(`[${ts()}][mount-health] remount verify failed for ${mount.remote}`, { err: e?.message });
    }
}
