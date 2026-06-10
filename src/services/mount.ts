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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync, spawn } from "child_process";
import { config, providersSet } from "../core/config";
import { WebDAVBridge } from "./webdavBridge";
import type { BridgeStatus } from "./webdavBridge";
import { waitForBridgeReady } from "./cloudLinks/bridge";

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
function isStaleMountErr(e: any): boolean {
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
function cleanupMountPath(p: string) {
  try {
    if (process.platform === "linux") {
      // Try to lazily unmount FUSE mounts
      spawnSync("fusermount3", ["-uz", p], { stdio: "ignore" });
      spawnSync("fusermount", ["-uz", p], { stdio: "ignore" });
      spawnSync("umount", ["-l", p], { stdio: "ignore" });
    } else if (process.platform === "darwin") {
      spawnSync("umount", ["-f", p], { stdio: "ignore" });
      spawnSync("diskutil", ["unmount", "force", p], { stdio: "ignore" });
    }
  } catch {}
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
function ensureDir(p: string, opts?: { cleanupOnStale?: boolean }) {
  const cleanupOnStale = opts?.cleanupOnStale ?? true;
  try {
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true });
    } else {
      // Touch directory to detect stale FUSE mountpoints
      fs.readdirSync(p);
    }
  } catch (e: any) {
    if (cleanupOnStale && isStaleMountErr(e)) {
      console.warn(`[${new Date().toISOString()}][mount] detected stale/busy mount at ${p}, attempting cleanup`);
      cleanupMountPath(p);
      // Retry creation/access
      try {
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
        fs.readdirSync(p);
      } catch (e2) {
        throw e2;
      }
    } else {
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
function obscurePassword(password: string): string {
  if (!password) return "";
  try {
    const res = spawnSync(config.rclonePath, ["obscure", password], { encoding: "utf8" });
    if (res.status === 0 && res.stdout) return res.stdout.trim();
  } catch {}
  return password;
}

// ===========================================================================
// Active WebDAV Bridges (module-level for status reporting)
// ===========================================================================

/** Active bridge instances, keyed by provider name. */
const activeBridges: Map<string, WebDAVBridge> = new Map();

/**
 * Returns the status of all active WebDAV bridge instances.
 * Used by the API status endpoint.
 */
export function getBridgeStatuses(): BridgeStatus[] {
  return Array.from(activeBridges.values()).map((b) => b.getStatus());
}

/**
 * Forces a cache refresh on all active WebDAV bridges.
 * Used by the API refresh endpoint.
 */
export async function refreshBridges(): Promise<void> {
  for (const b of activeBridges.values()) {
    await b.refresh();
  }
}

/**
 * Returns the active bridge instances for external consumers
 * (e.g. dead scanner checking for bridge-detected dead torrents).
 */
export function getActiveBridges(): Map<string, WebDAVBridge> {
  return activeBridges;
}

/**
 * Checks if a provider has direct WebDAV credentials configured.
 */
function hasDirectWebDAV(provider: string): boolean {
  if (provider === "realdebrid") {
    return !!(config.rdWebdavUrl && config.rdWebdavUsername && config.rdWebdavPassword);
  }
  if (provider === "torbox") {
    return !!(config.torboxWebdavUrl && config.torboxWebdavUsername && config.torboxWebdavPassword);
  }
  if (provider === "alldebrid") {
    return !!(config.alldebridWebdavUrl && config.alldebridWebdavUsername && config.alldebridWebdavPassword);
  }
  if (provider === "premiumize") {
    return !!(config.premiumizeWebdavUrl && config.premiumizeWebdavUsername && config.premiumizeWebdavPassword);
  }
  return false;
}

/**
 * Checks if a provider has an API key configured (for bridge mode).
 */
function hasApiKey(provider: string): boolean {
  if (provider === "realdebrid") return !!config.rdAccessToken;
  if (provider === "torbox") return !!config.torboxApiKey;
  if (provider === "alldebrid") return !!config.alldebridApiKey;
  if (provider === "premiumize") return !!config.premiumizeApiKey;
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
function buildRcloneConfigFile(bridgePorts: Map<string, number>): string {
  const lines: string[] = [];
  const ps = providersSet();

  // RealDebrid: direct WebDAV or bridge
  if (ps.has("realdebrid")) {
    if (hasDirectWebDAV("realdebrid")) {
      console.log(`[${new Date().toISOString()}][mount] RealDebrid: using direct WebDAV credentials`);
      lines.push(`[rd]`);
      lines.push(`type = webdav`);
      lines.push(`url = ${config.rdWebdavUrl}`);
      lines.push(`vendor = other`);
      lines.push(`user = ${config.rdWebdavUsername}`);
      lines.push(`pass = ${obscurePassword(config.rdWebdavPassword)}`);
      lines.push("");
    } else if (bridgePorts.has("realdebrid")) {
      const port = bridgePorts.get("realdebrid")!;
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
      lines.push(`url = ${config.torboxWebdavUrl}`);
      lines.push(`vendor = other`);
      lines.push(`user = ${config.torboxWebdavUsername}`);
      lines.push(`pass = ${obscurePassword(config.torboxWebdavPassword)}`);
      lines.push("");
    } else if (bridgePorts.has("torbox")) {
      const port = bridgePorts.get("torbox")!;
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
      lines.push(`url = ${config.alldebridWebdavUrl}`);
      lines.push(`vendor = other`);
      lines.push(`user = ${config.alldebridWebdavUsername}`);
      lines.push(`pass = ${obscurePassword(config.alldebridWebdavPassword)}`);
      lines.push("");
    } else if (bridgePorts.has("alldebrid")) {
      const port = bridgePorts.get("alldebrid")!;
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
      lines.push(`url = ${config.premiumizeWebdavUrl}`);
      lines.push(`vendor = other`);
      lines.push(`user = ${config.premiumizeWebdavUsername}`);
      lines.push(`pass = ${obscurePassword(config.premiumizeWebdavPassword)}`);
      lines.push("");
    } else if (bridgePorts.has("premiumize")) {
      const port = bridgePorts.get("premiumize")!;
      console.log(`[${new Date().toISOString()}][mount] Premiumize: using WebDAV bridge on port ${port}`);
      lines.push(`[premiumize]`);
      lines.push(`type = webdav`);
      lines.push(`url = http://localhost:${port}`);
      lines.push(`vendor = other`);
      lines.push("");
    }
  }

  // =========================================================================
  // Cloud Storage Providers (mounted via rclone combine remote)
  // =========================================================================
  if (config.cloudMountsEnabled) {
    const cloudRemotes: string[] = [];

    // MEGA — email + password auth (fully headless)
    if (config.megaEmail && config.megaPassword) {
      lines.push(`[mega]`);
      lines.push(`type = mega`);
      lines.push(`user = ${config.megaEmail}`);
      lines.push(`pass = ${config.megaPassword}`);
      lines.push(``);
      cloudRemotes.push('mega');
    }

    // Dropbox — OAuth token
    if (config.dropboxToken) {
      lines.push(`[dropbox]`);
      lines.push(`type = dropbox`);
      if (config.dropboxClientId) lines.push(`client_id = ${config.dropboxClientId}`);
      if (config.dropboxClientSecret) lines.push(`client_secret = ${config.dropboxClientSecret}`);
      lines.push(`token = ${config.dropboxToken}`);
      lines.push(``);
      cloudRemotes.push('dropbox');
    }

    // Google Drive — service account or OAuth token
    if (config.gdriveServiceAccountFile || config.gdriveToken) {
      lines.push(`[gdrive]`);
      lines.push(`type = drive`);
      lines.push(`scope = drive`);
      if (config.gdriveServiceAccountFile) {
        lines.push(`service_account_file = ${config.gdriveServiceAccountFile}`);
      }
      if (config.gdriveToken) {
        lines.push(`token = ${config.gdriveToken}`);
      }
      if (config.gdriveRootFolderId) {
        lines.push(`root_folder_id = ${config.gdriveRootFolderId}`);
      }
      lines.push(``);
      cloudRemotes.push('gdrive');
    }

    // OneDrive — OAuth token
    if (config.onedriveToken) {
      lines.push(`[onedrive]`);
      lines.push(`type = onedrive`);
      lines.push(`token = ${config.onedriveToken}`);
      if (config.onedriveDriveId) lines.push(`drive_id = ${config.onedriveDriveId}`);
      if (config.onedriveDriveType) lines.push(`drive_type = ${config.onedriveDriveType}`);
      lines.push(``);
      cloudRemotes.push('onedrive');
    }

    // Combine remote — presents all cloud providers under a single mount
    if (cloudRemotes.length > 0) {
      lines.push(`[cloud]`);
      lines.push(`type = combine`);
      lines.push(`upstreams = ${cloudRemotes.map(r => `${r}=${r}:`).join(' ')}`);
      lines.push(``);
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
function splitArgs(opts: string): string[] {
  const s = (opts || "").trim();
  if (!s) return [];
  return s.split(/\s+/);
}

/**
 * Checks whether user-provided mount options already include log verbosity flags.
 * Used to avoid conflicting with user-specified `--log-level` or `-v` flags.
 *
 * @param opts - The mount options string to check.
 * @returns `true` if the options contain log-level flags.
 */
function hasUserLogFlags(opts: string | undefined): boolean {
  const tokens = splitArgs(opts || "");
  return tokens.some((t) => t === "-v" || t === "-vv" || t === "-vvv" || t.startsWith("--log-level"));
}

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 *
 * @param ms - The number of milliseconds to sleep.
 * @returns A promise that resolves after the delay.
 */
function sleep(ms: number) {
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
function canAllowOther(): boolean {
  try {
    const s = fs.readFileSync("/etc/fuse.conf", "utf8");
    // Consider uncommented presence of user_allow_other sufficient
    return /(^|\n)\s*user_allow_other\s*($|#)/.test(s);
  } catch {
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
async function testRemote(remote: string, cfgPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(
        config.rclonePath,
        ["lsd", remote, "--config", cfgPath, "--contimeout=15s", "--timeout=30s"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] } as any
      );

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

      // Timeout: don't wait forever
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        console.warn(
          `[${new Date().toISOString()}][mount] rclone test for ${remote} timed out after 30s`
        );
        resolve(false);
      }, 30000);

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve(true);
        } else {
          console.error(
            `[${new Date().toISOString()}][mount] rclone test for ${remote} failed`,
            { status: code, stderr: stderr.trim().slice(0, 500) || null }
          );
          resolve(false);
        }
      });

      child.on("error", (e: any) => {
        clearTimeout(timer);
        console.error(
          `[${new Date().toISOString()}][mount] rclone test error for ${remote}`,
          { err: e?.message }
        );
        resolve(false);
      });
    } catch (e: any) {
      console.error(
        `[${new Date().toISOString()}][mount] rclone test spawn error for ${remote}`,
        { err: e?.message }
      );
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
export async function mountVirtualDrive(): Promise<void> {
  // -----------------------------------------------------------------------
  // Phase 0: Force cleanup of all FUSE mounts to clear stale resources and unblock old daemons
  // -----------------------------------------------------------------------
  try {
    unmountAll();
    await sleep(1000);
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][mount] Startup unmount cleanup failed (non-fatal):`, err?.message);
  }

  const ps = providersSet();
  const bridgePorts: Map<string, number> = new Map();

  // -----------------------------------------------------------------------
  // Phase 1: Start WebDAV bridges for providers with API keys but no WebDAV creds
  // -----------------------------------------------------------------------
  if (config.webdavBridgeEnabled) {
    const maxAttempts = 20;

    if (ps.has("realdebrid") && !hasDirectWebDAV("realdebrid") && hasApiKey("realdebrid")) {
      console.log(`[${new Date().toISOString()}][mount] RealDebrid: no WebDAV creds, starting API bridge...`);
      let port = config.webdavBridgePortRD;
      let bridge = null;

      for (let i = 0; i < maxAttempts; i++) {
        while (Array.from(bridgePorts.values()).includes(port)) {
          port++;
        }
        try {
          const testBridge = new WebDAVBridge({
            provider: "realdebrid",
            port: port,
            cacheTtlS: config.webdavCacheTtlS,
            downloadCacheTtlS: config.webdavDownloadCacheTtlS,
          });
          await testBridge.start();
          bridge = testBridge;
          break;
        } catch (err: any) {
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
      let port = config.webdavBridgePortTB;
      let bridge = null;

      for (let i = 0; i < maxAttempts; i++) {
        while (Array.from(bridgePorts.values()).includes(port)) {
          port++;
        }
        try {
          const testBridge = new WebDAVBridge({
            provider: "torbox",
            port: port,
            cacheTtlS: config.webdavCacheTtlS,
            downloadCacheTtlS: config.webdavDownloadCacheTtlS,
          });
          await testBridge.start();
          bridge = testBridge;
          break;
        } catch (err: any) {
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
      let port = config.webdavBridgePortAD;
      let bridge = null;

      for (let i = 0; i < maxAttempts; i++) {
        while (Array.from(bridgePorts.values()).includes(port)) {
          port++;
        }
        try {
          const testBridge = new WebDAVBridge({
            provider: "alldebrid",
            port: port,
            cacheTtlS: config.webdavCacheTtlS,
            downloadCacheTtlS: config.webdavDownloadCacheTtlS,
          });
          await testBridge.start();
          bridge = testBridge;
          break;
        } catch (err: any) {
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
      let port = config.webdavBridgePortPM;
      let bridge = null;

      for (let i = 0; i < maxAttempts; i++) {
        while (Array.from(bridgePorts.values()).includes(port)) {
          port++;
        }
        try {
          const testBridge = new WebDAVBridge({
            provider: "premiumize",
            port: port,
            cacheTtlS: config.webdavCacheTtlS,
            downloadCacheTtlS: config.webdavDownloadCacheTtlS,
          });
          await testBridge.start();
          bridge = testBridge;
          break;
        } catch (err: any) {
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

  const base = config.mountBase;
  // Never attempt to unmount/cleanup the base — it may be a bind mount from host
  ensureDir(base, { cleanupOnStale: false });
  tmpDir = path.join(os.tmpdir(), "schrodrive");
  ensureDir(tmpDir, { cleanupOnStale: false });

  // -----------------------------------------------------------------------
  // Phase 3: Determine which remotes to mount
  // -----------------------------------------------------------------------
  const mounts: MountTarget[] = [];
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
    } else {
      console.log(`[${new Date().toISOString()}][mount] skipping --allow-other (no user_allow_other in /etc/fuse.conf)`);
    }
    args.push("--allow-non-empty");

    // Apply user-provided mount options or fall back to configured defaults
    if (config.mountOptions && config.mountOptions.trim()) {
      args.push(...splitArgs(config.mountOptions));
    } else {
      args.push(`--poll-interval=${config.mountPollInterval}`);
      args.push(`--dir-cache-time=${config.mountDirCacheTime}`);
      args.push(`--vfs-cache-mode=${config.mountVfsCacheMode}`);
      args.push(`--buffer-size=${config.mountBufferSize}`);
      if ((config.mountVfsReadChunkSize || "").trim()) args.push(`--vfs-read-chunk-size=${config.mountVfsReadChunkSize}`);
      if ((config.mountVfsReadChunkSizeLimit || "").trim()) args.push(`--vfs-read-chunk-size-limit=${config.mountVfsReadChunkSizeLimit}`);
      if ((config.mountVfsCacheMaxAge || "").trim()) args.push(`--vfs-cache-max-age=${config.mountVfsCacheMaxAge}`);
      if ((config.mountVfsCacheMaxSize || "").trim()) args.push(`--vfs-cache-max-size=${config.mountVfsCacheMaxSize}`);
    }

    // Prevent rclone from retrying failed downloads endlessly.
    // Without limits, a 503 from the debrid bridge causes rclone's VFS cache to
    // retry in a tight loop, blocking Plex scanner threads in D-state.
    args.push('--retries', '1');
    args.push('--low-level-retries', '3');

    // Ownership and permissions presentation for FUSE mount
    if (typeof config.mountUid === "number") {
      args.push("--uid", String(config.mountUid));
    }
    if (typeof config.mountGid === "number") {
      args.push("--gid", String(config.mountGid));
    }
    if ((config.mountDirPerms || "").trim()) {
      args.push(`--dir-perms=${config.mountDirPerms}`);
    }
    if ((config.mountFilePerms || "").trim()) {
      args.push(`--file-perms=${config.mountFilePerms}`);
    }
    // Provide a sensible default umask if no explicit perms given
    if (!(config.mountDirPerms || config.mountFilePerms)) {
      args.push("--umask", "0022");
    }

    // Ensure we capture rclone logs without conflicting with user-provided verbosity
    const logFile = path.join(tmpDir, `rclone-${m.remote.replace(":", "")}.log`);
    if (!hasUserLogFlags(config.mountOptions)) {
      args.push(`--log-level=INFO`);
    }
    args.push(`--log-file=${logFile}`);

    args.push("--daemon");
    console.log(`[${new Date().toISOString()}][mount] rclone ${args.join(" ")}`);
    const p = spawn(config.rclonePath, args, { stdio: "inherit" });
    p.on("error", (e) => {
      console.error(`[${new Date().toISOString()}][mount] failed`, { remote: m.remote, err: (e as any)?.message });
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
      console.log(`[${new Date().toISOString()}][mount] verify ${m.remote} at ${m.path} -> entries=${(items as string[]).length}`);
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][mount] verify warning for ${m.remote} at ${m.path}`, { err: e?.message });
      console.warn(`[${new Date().toISOString()}][mount] mount may still be initialising — see rclone log: ${logFile}`);
    }
  }

  // -----------------------------------------------------------------------
  // Phase 4: Mount cloud storage providers (if configured)
  // -----------------------------------------------------------------------
  if (config.cloudMountsEnabled) {
    const hasCloud = config.megaEmail || config.dropboxToken ||
                     config.gdriveServiceAccountFile || config.gdriveToken ||
                     config.onedriveToken;

    if (hasCloud) {
      const cloudPath = path.join(base, 'cloud');
      ensureDir(cloudPath, { cleanupOnStale: true });

      console.log(`[${new Date().toISOString()}][mount] Mounting cloud storage at ${cloudPath}`);

      const cloudArgs = [
        'mount', 'cloud:', cloudPath,
        '--config', cfg,
        '--daemon',
        '--vfs-cache-mode=full',
        '--dir-cache-time=1h',
        '--vfs-cache-max-age=168h',
        '--poll-interval=1m',
        '--tpslimit=10',
        '--allow-non-empty',
      ];

      if (canAllowOther()) {
        cloudArgs.push('--allow-other');
      }

      if (config.cloudMountReadOnly) {
        cloudArgs.push('--read-only');
      }

      // Ownership and permissions — match debrid mount patterns
      if (typeof config.mountUid === 'number') {
        cloudArgs.push('--uid', String(config.mountUid));
      }
      if (typeof config.mountGid === 'number') {
        cloudArgs.push('--gid', String(config.mountGid));
      }
      if ((config.mountDirPerms || '').trim()) {
        cloudArgs.push(`--dir-perms=${config.mountDirPerms}`);
      }
      if ((config.mountFilePerms || '').trim()) {
        cloudArgs.push(`--file-perms=${config.mountFilePerms}`);
      }
      if (!(config.mountDirPerms || config.mountFilePerms)) {
        cloudArgs.push('--umask', '0022');
      }

      // Logging
      const cloudLogFile = path.join(tmpDir, 'rclone-cloud.log');
      cloudArgs.push(`--log-file=${cloudLogFile}`);
      cloudArgs.push('--log-level=NOTICE');

      console.log(`[${new Date().toISOString()}][mount] rclone ${cloudArgs.join(' ')}`);

      const cloudProc = spawn(config.rclonePath, cloudArgs, { stdio: 'inherit' });
      cloudProc.on('error', (e) => {
        console.error(`[${new Date().toISOString()}][mount] cloud mount failed`, { err: (e as any)?.message });
      });
      cloudProc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[${new Date().toISOString()}][mount] cloud daemon exited with code ${code}`);
        }
      });

      // Add to health monitor — store custom args so attemptRemount uses the
      // correct cloud-specific flags rather than falling back to debrid config.
      const cloudRemountArgs = [
        '--vfs-cache-mode=full',
        '--dir-cache-time=1h',
        '--vfs-cache-max-age=168h',
        '--poll-interval=1m',
        '--tpslimit=10',
        '--allow-non-empty',
      ];
      if (canAllowOther()) cloudRemountArgs.push('--allow-other');
      if (config.cloudMountReadOnly) cloudRemountArgs.push('--read-only');
      if (typeof config.mountUid === 'number') cloudRemountArgs.push('--uid', String(config.mountUid));
      if (typeof config.mountGid === 'number') cloudRemountArgs.push('--gid', String(config.mountGid));
      if ((config.mountDirPerms || '').trim()) cloudRemountArgs.push(`--dir-perms=${config.mountDirPerms}`);
      if ((config.mountFilePerms || '').trim()) cloudRemountArgs.push(`--file-perms=${config.mountFilePerms}`);
      if (!(config.mountDirPerms || config.mountFilePerms)) cloudRemountArgs.push('--umask', '0022');
      cloudRemountArgs.push(`--log-file=${cloudLogFile}`);
      cloudRemountArgs.push('--log-level=NOTICE');
      mounts.push({ remote: 'cloud:', path: cloudPath, configPath: cfg, customArgs: cloudRemountArgs });

      // Post-mount verification (best-effort)
      try {
        await sleep(3000);
        const items = await Promise.race([
          fs.promises.readdir(cloudPath),
          sleep(10000).then(() => { throw new Error('readdir timed out after 10s'); }),
        ]);
        console.log(`[${new Date().toISOString()}][mount] verify cloud: at ${cloudPath} -> entries=${(items as string[]).length}`);
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][mount] verify warning for cloud: at ${cloudPath}`, { err: e?.message });
        console.warn(`[${new Date().toISOString()}][mount] cloud mount may still be initialising — see rclone log: ${path.join(tmpDir, 'rclone-cloud.log')}`);
      }

      console.log(`[${new Date().toISOString()}][mount] Cloud storage mount initiated at ${cloudPath}`);
    }
  }

  console.log(`[${new Date().toISOString()}][mount] mounts initiated at ${base}`);

  // Mount cloud-links WebDAV bridge via rclone (if configured)
  // DEFERRED: Waits for the bridge pre-warm to cache depth-1 directories
  // before mounting, so Plex never hits uncached paths on startup.
  if (config.cloudLinksEnabled) {
    const clPath = path.join(base, 'cloud-links');
    ensureDir(clPath, { cleanupOnStale: true });

    // Fire-and-forget async — don't block other mounts
    (async () => {
      console.log(`[${new Date().toISOString()}][mount] Waiting for cloud-links bridge to pre-warm depth-1 before mounting...`);
      await waitForBridgeReady(5 * 60 * 1000); // 5 minute timeout
      console.log(`[${new Date().toISOString()}][mount] Bridge ready — mounting cloud-links WebDAV bridge at ${clPath}`);

      // Write a dedicated rclone config for the cloud-links remote
      const clConfigPath = path.join(tmpDir, 'rclone-cloud-links.conf');
      const clConfigLines = [
        `[cloud-links]`,
        `type = webdav`,
        `url = http://localhost:${config.cloudLinksBridgePort}`,
        `vendor = other`,
        ``,
      ];
      fs.writeFileSync(clConfigPath, clConfigLines.join('\n'), 'utf-8');

      const clArgs = [
        'mount', 'cloud-links:', clPath,
        '--daemon',
        '--vfs-cache-mode=off',
        '--dir-cache-time=24h',
        '--poll-interval=0',
        '--allow-other',
        '--allow-non-empty',
        '--read-only',
        '--transfers=4',
        `--config=${clConfigPath}`,
        `--log-file=${path.join(tmpDir, 'rclone-cloud-links.log')}`,
        '--log-level=NOTICE',
      ];

      // Add UID/GID matching (mirrors debrid mount perms)
      if (typeof config.mountUid === 'number') {
        clArgs.push('--uid', String(config.mountUid));
      }
      if (typeof config.mountGid === 'number') {
        clArgs.push('--gid', String(config.mountGid));
      }

      console.log(`[${new Date().toISOString()}][mount] rclone ${clArgs.join(' ')}`);

      const clProc = spawn(config.rclonePath, clArgs, { stdio: 'inherit' });
      clProc.on('error', (e) => {
        console.error(`[${new Date().toISOString()}][mount] cloud-links mount failed`, { err: (e as any)?.message });
      });
      clProc.on('close', (code) => {
        if (code !== 0) {
          console.error(`[${new Date().toISOString()}][mount] cloud-links daemon exited with code ${code}`);
        }
      });

      // Store cloud-links mount metadata so attemptRemount uses the correct
      // dedicated rclone config and cloud-links-specific flags.
      const clRemountArgs = [
        '--vfs-cache-mode=off',
        '--dir-cache-time=24h',
        '--poll-interval=0',
        '--allow-other',
        '--allow-non-empty',
        '--read-only',
        '--transfers=4',
        `--log-file=${path.join(tmpDir, 'rclone-cloud-links.log')}`,
        '--log-level=NOTICE',
      ];
      if (typeof config.mountUid === 'number') clRemountArgs.push('--uid', String(config.mountUid));
      if (typeof config.mountGid === 'number') clRemountArgs.push('--gid', String(config.mountGid));
      mounts.push({ remote: 'cloud-links:', path: clPath, configPath: clConfigPath, customArgs: clRemountArgs });
      console.log(`[${new Date().toISOString()}][mount] Cloud links mount initiated at ${clPath}`);
    })().catch((err) => {
      console.error(`[${new Date().toISOString()}][mount] Deferred cloud-links mount failed: ${(err as any)?.message}`);
    });
  }

  console.log(`[${new Date().toISOString()}][mount] All mounts initiated at ${base}`);

  // Start the mount health monitor to detect and recover from IO errors
  startMountHealthMonitor(mounts, cfg, base);
}

/**
 * Forcefully unmounts all configured FUSE mount points.
 * Called during graceful shutdown (SIGTERM/SIGINT) or auto-update exits
 * to prevent orphaned rclone processes from locking host mount points.
 */
export function unmountAll(): void {
  const ps = providersSet();
  const base = config.mountBase;
  const mounts: string[] = [];
  if (ps.has("realdebrid")) mounts.push(path.join(base, "realdebrid"));
  if (ps.has("torbox")) mounts.push(path.join(base, "torbox"));
  if (ps.has("alldebrid")) mounts.push(path.join(base, "alldebrid"));
  if (ps.has("premiumize")) mounts.push(path.join(base, "premiumize"));
  if (config.cloudMountsEnabled) mounts.push(path.join(base, "cloud"));
  if (config.cloudLinksEnabled) mounts.push(path.join(base, "cloud-links"));

  console.log(`[${new Date().toISOString()}][mount] Cleaning up and unmounting all FUSE mount points...`);
  for (const m of mounts) {
    try {
      cleanupMountPath(m);
    } catch {}
  }
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
const HEALTH_CHECK_INTERVAL_MS = 60_000; // 1 minute

/**
 * Error patterns that indicate a genuinely problematic mount.
 *
 * NOTE: 502 Bad Gateway and 503 Service Unavailable are intentionally EXCLUDED.
 * The WebDAV bridge returns 503 Retry-After for dead/temporarily-unavailable
 * torrents by design. rclone logs these at INFO level and retries automatically.
 * Counting them as mount errors caused unnecessary remounts every ~5 minutes,
 * which killed active Plex streams. See: webdavBridge.ts lines 1306-1314.
 */
const MOUNT_ERROR_PATTERNS = [
  "IO error",
  "transport connection broken",
  "connection reset by peer",
  "vfs cache: failed to open",
  "mount helper error",
  "mount failed",
];

interface MountTarget {
  remote: string;
  path: string;
  /** Optional rclone config file path (e.g. cloud-links uses a dedicated config). */
  configPath?: string;
  /** Optional custom mount args — used instead of debrid config-driven args on remount. */
  customArgs?: string[];
}

/**
 * Starts a background health monitor for all active rclone mounts.
 * Periodically reads rclone log files and checks the FUSE mount accessibility.
 * If persistent errors are detected, automatically remounts the affected provider.
 */
function startMountHealthMonitor(
  mounts: MountTarget[],
  rcloneConfigPath: string,
  _base: string,
): void {
  const failureCounts: Record<string, number> = {};
  const logPositions: Record<string, number> = {};

  for (const m of mounts) {
    failureCounts[m.remote] = 0;
    logPositions[m.remote] = 0;
  }

  console.log(`[${new Date().toISOString()}][mount-health] started monitoring ${mounts.length} mount(s)`);

  setInterval(async () => {
    for (const m of mounts) {
      const remoteName = m.remote.replace(":", "");
      const logFile = path.join(tmpDir, `rclone-${remoteName}.log`);

      let logHasErrors = false;
      let mountInaccessible = false;

      // 1. Check rclone log for new errors since last read (INFORMATIONAL ONLY)
      // Log errors alone do NOT trigger a remount — the mount can be healthy
      // even with transient 503/423 errors from dead/unavailable torrents.
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
          const errorLines = newLogs.split("\n").filter((line) =>
            MOUNT_ERROR_PATTERNS.some((p) => line.includes(p))
          );

          if (errorLines.length > 0) {
            logHasErrors = true;
            console.warn(
              `[${new Date().toISOString()}][mount-health] ${m.remote} detected ${errorLines.length} rclone error(s) (informational — not triggering remount)`
            );
          }
        }
      } catch {
        // Log file might not exist yet — that's fine
      }

      // 2. Check FUSE mount accessibility — THIS is the primary health signal.
      // Only mount inaccessibility (readdir failure/timeout/empty) counts as
      // a genuine failure. This prevents the old bug where expected 503
      // responses from dead torrents triggered unnecessary remounts.
      try {
        const items = await Promise.race([
          fs.promises.readdir(m.path),
          sleep(5000).then(() => { throw new Error("readdir timed out"); }),
        ]);
        if ((items as string[]).length === 0) {
          mountInaccessible = true;
          console.warn(`[${new Date().toISOString()}][mount-health] ${m.remote} mount at ${m.path} is empty`);
        }
      } catch (e: any) {
        mountInaccessible = true;
        console.warn(
          `[${new Date().toISOString()}][mount-health] ${m.remote} mount at ${m.path} inaccessible: ${e?.message}`
        );
      }

      // 3. Update failure counter — only on mount inaccessibility
      // Log errors alone are informational and do NOT affect the counter.
      // If both log errors AND mount inaccessible, escalate faster (2x increment).
      if (mountInaccessible) {
        failureCounts[m.remote] += logHasErrors ? 2 : 1;
        console.warn(
          `[${new Date().toISOString()}][mount-health] ${m.remote} failure streak: ${failureCounts[m.remote]}/${HEALTH_CHECK_FAILURE_THRESHOLD}${logHasErrors ? ' (escalated — log errors + mount inaccessible)' : ''}`
        );

        if (failureCounts[m.remote] >= HEALTH_CHECK_FAILURE_THRESHOLD) {
          console.error(
            `[${new Date().toISOString()}][mount-health] ${m.remote} exceeded failure threshold — initiating remount`
          );
          await attemptRemount(m, rcloneConfigPath);
          failureCounts[m.remote] = 0;
          logPositions[m.remote] = 0; // Reset log position after remount
        }
      } else {
        // Mount is accessible — reset the failure counter
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
async function attemptRemount(mount: MountTarget, rcloneConfigPath: string): Promise<void> {
  const ts = () => new Date().toISOString();

  console.log(`[${ts()}][mount-health] unmounting ${mount.remote} at ${mount.path}...`);

  // Unmount the stale FUSE mount
  cleanupMountPath(mount.path);

  // Wait a moment for cleanup
  await sleep(2000);

  // Ensure mount directory exists
  ensureDir(mount.path, { cleanupOnStale: false });

  // Resolve which rclone config to use — cloud-links and cloud mounts store
  // their own config path; debrid mounts fall back to the main rclone config.
  const effectiveConfigPath = mount.configPath ?? rcloneConfigPath;

  // Rebuild rclone mount args — if the mount has custom args stored (cloud-links,
  // cloud), use those. Otherwise fall back to debrid-style config-driven args.
  const args = [
    "mount",
    mount.remote,
    mount.path,
    "--config", effectiveConfigPath,
  ];

  if (mount.customArgs) {
    // Use the mount-specific args that were captured during initial mount.
    // These already include allow-other, cache-mode, log-file, etc.
    args.push(...mount.customArgs);
    console.log(`[${ts()}][mount-health] using stored custom args for ${mount.remote}`);
  } else {
    // Debrid mount — build args from global config (existing behaviour)
    if (canAllowOther()) {
      args.push("--allow-other");
    }
    args.push("--allow-non-empty");

    // Apply configured mount options
    if (config.mountOptions && config.mountOptions.trim()) {
      args.push(...splitArgs(config.mountOptions));
    } else {
      args.push(`--poll-interval=${config.mountPollInterval}`);
      args.push(`--dir-cache-time=${config.mountDirCacheTime}`);
      args.push(`--vfs-cache-mode=${config.mountVfsCacheMode}`);
      args.push(`--buffer-size=${config.mountBufferSize}`);
      if ((config.mountVfsReadChunkSize || "").trim()) args.push(`--vfs-read-chunk-size=${config.mountVfsReadChunkSize}`);
      if ((config.mountVfsReadChunkSizeLimit || "").trim()) args.push(`--vfs-read-chunk-size-limit=${config.mountVfsReadChunkSizeLimit}`);
      if ((config.mountVfsCacheMaxAge || "").trim()) args.push(`--vfs-cache-max-age=${config.mountVfsCacheMaxAge}`);
      if ((config.mountVfsCacheMaxSize || "").trim()) args.push(`--vfs-cache-max-size=${config.mountVfsCacheMaxSize}`);
    }

    // Prevent rclone from retrying failed downloads endlessly (mirrors main mount logic)
    args.push('--retries', '1');
    args.push('--low-level-retries', '3');

    if (!(config.mountDirPerms || config.mountFilePerms)) {
      args.push("--umask", "0022");
    }

    const remoteName = mount.remote.replace(":", "");
    const logFile = path.join(tmpDir, `rclone-${remoteName}.log`);
    if (!hasUserLogFlags(config.mountOptions)) {
      args.push("--log-level=INFO");
    }
    args.push(`--log-file=${logFile}`);
  }

  args.push("--daemon");

  console.log(`[${ts()}][mount-health] re-mounting: rclone ${args.join(" ")}`);

  const p = spawn(config.rclonePath, args, { stdio: "inherit" });
  p.on("error", (e) => {
    console.error(`[${ts()}][mount-health] remount failed for ${mount.remote}`, { err: (e as any)?.message });
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
    console.log(`[${ts()}][mount-health] remount verify ${mount.remote} → entries=${(items as string[]).length}`);
  } catch (e: any) {
    console.error(`[${ts()}][mount-health] remount verify failed for ${mount.remote}`, { err: e?.message });
  }
}
