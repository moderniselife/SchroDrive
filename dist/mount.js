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
function ensureDir(p) {
    if (!fs.existsSync(p))
        fs.mkdirSync(p, { recursive: true });
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
    ensureDir(base);
    const mounts = [];
    const ps = (0, config_1.providersSet)();
    if (ps.has("realdebrid") && config_1.config.rdWebdavUsername)
        mounts.push({ remote: "rd:", path: path.join(base, "realdebrid") });
    if (ps.has("torbox") && config_1.config.torboxWebdavUsername)
        mounts.push({ remote: "torbox:", path: path.join(base, "torbox") });
    if (!mounts.length)
        throw new Error("Nothing to mount. Check PROVIDERS and credentials.");
    for (const m of mounts) {
        ensureDir(m.path);
        if (!testRemote(m.remote, cfg)) {
            continue;
        }
        const args = [
            "mount",
            m.remote,
            m.path,
            "--config",
            cfg,
            "--allow-other",
            "--allow-non-empty",
        ];
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
    }
    console.log(`[${new Date().toISOString()}][mount] mounts initiated at ${base}`);
}
