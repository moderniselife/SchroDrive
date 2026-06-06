/**
 * SchroDrive — Virtual Filesystem Mount Manager
 *
 * Handles mounting WebDAV-based debrid provider filesystems via rclone.
 * Builds rclone configuration files for configured providers (Real-Debrid, TorBox),
 * manages FUSE mount lifecycle including stale mount cleanup, permission handling,
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
import { config, providersSet } from "./config";

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
  return code === "ENOTCONN" || code === "EBUSY" || code === "EIO";
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

/**
 * Generates a temporary rclone configuration file containing WebDAV
 * remote definitions for all configured providers.
 *
 * Each provider gets a named section (e.g. `[rd]`, `[torbox]`) with
 * the WebDAV URL, vendor type, username, and obscured password.
 *
 * @returns The absolute path to the generated rclone config file.
 * @throws {Error} If no WebDAV providers are configured.
 */
function buildRcloneConfigFile(): string {
  const lines: string[] = [];
  const ps = providersSet();

  if (ps.has("realdebrid") && config.rdWebdavUrl && config.rdWebdavUsername && config.rdWebdavPassword) {
    lines.push(`[rd]`);
    lines.push(`type = webdav`);
    lines.push(`url = ${config.rdWebdavUrl}`);
    lines.push(`vendor = other`);
    lines.push(`user = ${config.rdWebdavUsername}`);
    lines.push(`pass = ${obscurePassword(config.rdWebdavPassword)}`);
    lines.push("");
  }

  if (ps.has("torbox") && config.torboxWebdavUrl && config.torboxWebdavUsername && config.torboxWebdavPassword) {
    lines.push(`[torbox]`);
    lines.push(`type = webdav`);
    lines.push(`url = ${config.torboxWebdavUrl}`);
    lines.push(`vendor = other`);
    lines.push(`user = ${config.torboxWebdavUsername}`);
    lines.push(`pass = ${obscurePassword(config.torboxWebdavPassword)}`);
    lines.push("");
  }

  if (!lines.length) {
    throw new Error("No WebDAV providers configured. Set RD_WEBDAV_* or TORBOX_WEBDAV_* envs and PROVIDERS.");
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
 * @param remote - The rclone remote name (e.g. "rd:", "torbox:").
 * @param cfgPath - The path to the rclone configuration file.
 * @returns `true` if the remote responded successfully.
 */
function testRemote(remote: string, cfgPath: string): boolean {
  try {
    const res = spawnSync(
      config.rclonePath,
      ["lsd", remote, "--config", cfgPath, "--log-level=DEBUG"],
      { encoding: "utf8" }
    );
    if (res.status === 0) return true;
    console.error(
      `[${new Date().toISOString()}][mount] rclone test for ${remote} failed`,
      { status: res.status, stderr: res.stderr }
    );
    return false;
  } catch (e: any) {
    console.error(
      `[${new Date().toISOString()}][mount] rclone test error for ${remote}`,
      { err: e?.message }
    );
    return false;
  }
}

/**
 * Mounts all configured WebDAV providers as virtual filesystems using rclone.
 *
 * For each configured provider:
 * 1. Builds the rclone configuration file with WebDAV credentials
 * 2. Tests the remote is accessible via `rclone lsd`
 * 3. Constructs mount arguments (VFS cache settings, permissions, logging)
 * 4. Spawns rclone as a daemon process
 * 5. Performs a best-effort post-mount verification after a short delay
 *
 * Mount options can be overridden via `config.mountOptions`. If not provided,
 * sensible defaults are used for poll interval, cache mode, buffer size, etc.
 *
 * @throws {Error} If no providers are configured or no mounts can be created.
 */
export async function mountVirtualDrive(): Promise<void> {
  const cfg = buildRcloneConfigFile();
  const base = config.mountBase;
  // Never attempt to unmount/cleanup the base — it may be a bind mount from host
  ensureDir(base, { cleanupOnStale: false });
  const tmpDir = path.join(os.tmpdir(), "schrodrive");
  ensureDir(tmpDir, { cleanupOnStale: false });

  const mounts: Array<{ remote: string; path: string }> = [];
  const ps = providersSet();
  if (ps.has("realdebrid") && config.rdWebdavUsername) mounts.push({ remote: "rd:", path: path.join(base, "realdebrid") });
  if (ps.has("torbox") && config.torboxWebdavUsername) mounts.push({ remote: "torbox:", path: path.join(base, "torbox") });

  if (!mounts.length) throw new Error("Nothing to mount. Check PROVIDERS and credentials.");

  for (const m of mounts) {
    // Safe to cleanup the leaf mount path only
    ensureDir(m.path, { cleanupOnStale: true });
    if (!testRemote(m.remote, cfg)) {
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

    // Quick post-mount verification (best-effort)
    try {
      await sleep(1500);
      const items = fs.readdirSync(m.path);
      console.log(`[${new Date().toISOString()}][mount] verify ${m.remote} at ${m.path} -> entries=${items.length}`);
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][mount] verify error for ${m.remote} at ${m.path}`, { err: e?.message });
      console.warn(`[${new Date().toISOString()}][mount] see rclone log: ${logFile}`);
    }
  }

  console.log(`[${new Date().toISOString()}][mount] mounts initiated at ${base}`);
}
