import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync, spawn } from "child_process";
import { config, providersSet } from "./config";

function isStaleMountErr(e: any): boolean {
  const code = (e?.code || "").toString();
  return code === "ENOTCONN" || code === "EBUSY" || code === "EIO";
}

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

function obscurePassword(password: string): string {
  if (!password) return "";
  try {
    const res = spawnSync(config.rclonePath, ["obscure", password], { encoding: "utf8" });
    if (res.status === 0 && res.stdout) return res.stdout.trim();
  } catch {}
  return password;
}

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

function splitArgs(opts: string): string[] {
  const s = (opts || "").trim();
  if (!s) return [];
  return s.split(/\s+/);
}

function hasUserLogFlags(opts: string | undefined): boolean {
  const tokens = splitArgs(opts || "");
  return tokens.some((t) => t === "-v" || t === "-vv" || t === "-vvv" || t.startsWith("--log-level"));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canAllowOther(): boolean {
  try {
    const s = fs.readFileSync("/etc/fuse.conf", "utf8");
    // consider uncommented presence of user_allow_other sufficient
    return /(^|\n)\s*user_allow_other\s*($|#)/.test(s);
  } catch {
    return false;
  }
}

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

export async function mountVirtualDrive(): Promise<void> {
  const cfg = buildRcloneConfigFile();
  const base = config.mountBase;
  // Never attempt to unmount/cleanup the base, it is a bind from host
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
