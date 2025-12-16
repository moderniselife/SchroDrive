"use strict";
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
exports.mountVirtualDrive = mountVirtualDrive;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const config_1 = require("./config");
function isStaleMountErr(e) {
    const code = (e?.code || "").toString();
    return code === "ENOTCONN" || code === "EBUSY" || code === "EIO";
}
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
function buildRcloneConfigFile() {
    const lines = [];
    const ps = (0, config_1.providersSet)();
    if (ps.has("realdebrid") && config_1.config.rdWebdavUrl && config_1.config.rdWebdavUsername && config_1.config.rdWebdavPassword) {
        lines.push(`[rd]`);
        lines.push(`type = webdav`);
        lines.push(`url = ${config_1.config.rdWebdavUrl}`);
        lines.push(`vendor = other`);
        lines.push(`user = ${config_1.config.rdWebdavUsername}`);
        lines.push(`pass = ${obscurePassword(config_1.config.rdWebdavPassword)}`);
        lines.push("");
    }
    if (ps.has("torbox") && config_1.config.torboxWebdavUrl && config_1.config.torboxWebdavUsername && config_1.config.torboxWebdavPassword) {
        lines.push(`[torbox]`);
        lines.push(`type = webdav`);
        lines.push(`url = ${config_1.config.torboxWebdavUrl}`);
        lines.push(`vendor = other`);
        lines.push(`user = ${config_1.config.torboxWebdavUsername}`);
        lines.push(`pass = ${obscurePassword(config_1.config.torboxWebdavPassword)}`);
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
function splitArgs(opts) {
    const s = (opts || "").trim();
    if (!s)
        return [];
    return s.split(/\s+/);
}
function hasUserLogFlags(opts) {
    const tokens = splitArgs(opts || "");
    return tokens.some((t) => t === "-v" || t === "-vv" || t === "-vvv" || t.startsWith("--log-level"));
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function canAllowOther() {
    try {
        const s = fs.readFileSync("/etc/fuse.conf", "utf8");
        // consider uncommented presence of user_allow_other sufficient
        return /(^|\n)\s*user_allow_other\s*($|#)/.test(s);
    }
    catch {
        return false;
    }
}
function testRemote(remote, cfgPath) {
    try {
        const res = (0, child_process_1.spawnSync)(config_1.config.rclonePath, ["lsd", remote, "--config", cfgPath, "--log-level=DEBUG"], { encoding: "utf8" });
        if (res.status === 0)
            return true;
        console.error(`[${new Date().toISOString()}][mount] rclone test for ${remote} failed`, { status: res.status, stderr: res.stderr });
        return false;
    }
    catch (e) {
        console.error(`[${new Date().toISOString()}][mount] rclone test error for ${remote}`, { err: e?.message });
        return false;
    }
}
async function mountVirtualDrive() {
    const cfg = buildRcloneConfigFile();
    const base = config_1.config.mountBase;
    // Never attempt to unmount/cleanup the base, it is a bind from host
    ensureDir(base, { cleanupOnStale: false });
    const tmpDir = path.join(os.tmpdir(), "schrodrive");
    ensureDir(tmpDir, { cleanupOnStale: false });
    const mounts = [];
    const ps = (0, config_1.providersSet)();
    if (ps.has("realdebrid") && config_1.config.rdWebdavUsername)
        mounts.push({ remote: "rd:", path: path.join(base, "realdebrid") });
    if (ps.has("torbox") && config_1.config.torboxWebdavUsername)
        mounts.push({ remote: "torbox:", path: path.join(base, "torbox") });
    if (!mounts.length)
        throw new Error("Nothing to mount. Check PROVIDERS and credentials.");
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
        }
        else {
            console.log(`[${new Date().toISOString()}][mount] skipping --allow-other (no user_allow_other in /etc/fuse.conf)`);
        }
        args.push("--allow-non-empty");
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
        // Quick post-mount verification (best-effort)
        try {
            await sleep(1500);
            const items = fs.readdirSync(m.path);
            console.log(`[${new Date().toISOString()}][mount] verify ${m.remote} at ${m.path} -> entries=${items.length}`);
        }
        catch (e) {
            console.warn(`[${new Date().toISOString()}][mount] verify error for ${m.remote} at ${m.path}`, { err: e?.message });
            console.warn(`[${new Date().toISOString()}][mount] see rclone log: ${logFile}`);
        }
    }
    console.log(`[${new Date().toISOString()}][mount] mounts initiated at ${base}`);
}
