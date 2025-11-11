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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizeOnce = organizeOnce;
exports.startOrganizerWatch = startOrganizerWatch;
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
const VIDEO_EXTS = new Set([
    ".mkv",
    ".mp4",
    ".avi",
    ".mov",
    ".m4v",
    ".wmv",
    ".flv",
    ".webm",
    ".mpg",
    ".mpeg",
]);
function isVideo(file) {
    const ext = path.extname(file).toLowerCase();
    return VIDEO_EXTS.has(ext);
}
function sanitize(input) {
    let s = input
        .replace(/\[[^\]]*\]/g, " ")
        .replace(/\([^\)]*\)/g, " ")
        .replace(/[_.]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    s = s.replace(/[\\/:*?"<>|]/g, "-");
    return s;
}
function pad2(n) { return n < 10 ? `0${n}` : String(n); }
function pad3(n) { return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n); }
function pad4(n) { return `${n}`.padStart(4, "0"); }
function parseFromParentDirs(fullPath) {
    // Look at parent directory for hints like "South Park (1997)" or "Show Name (Year)"
    const parent = path.basename(path.dirname(fullPath));
    const m = parent.match(/^(.*?)(?:\s*\((\d{4})\))?$/);
    if (m) {
        const show = sanitize(m[1] || "");
        const year = m[2] ? Number(m[2]) : undefined;
        if (show)
            return { show, year };
    }
    return {};
}
function parseFilename(fileName, fullPath) {
    const ext = path.extname(fileName);
    const baseNoExt = fileName.slice(0, -ext.length);
    const cleaned = sanitize(baseNoExt);
    const parentHints = parseFromParentDirs(fullPath);
    // TV patterns: S01E02 or 1x02
    let m = cleaned.match(/(.+?)\s*[\- ]?\bS(\d{1,2})E(\d{1,3})\b/i);
    if (m) {
        const show = sanitize(m[1]);
        const season = Number(m[2]);
        const episode = Number(m[3]);
        return { type: "tv", show: show || parentHints.show, season, episode, year: parentHints.year, ext };
    }
    m = cleaned.match(/(.+?)\s*[\- ]?\b(\d{1,2})x(\d{1,3})\b/i);
    if (m) {
        const show = sanitize(m[1]);
        const season = Number(m[2]);
        const episode = Number(m[3]);
        return { type: "tv", show: show || parentHints.show, season, episode, year: parentHints.year, ext };
    }
    // Anime absolute: "Show Name - 637" or "Show Name 637"
    m = cleaned.match(/(.+?)\s*[\- ]\s*(\d{1,4})(?:\b|\s)/);
    if (m) {
        const show = sanitize(m[1]);
        const absolute = Number(m[2]);
        return { type: "tv", show: show || parentHints.show, absolute, year: parentHints.year, ext };
    }
    // Movie heuristic: title (year) or title .2024.
    m = cleaned.match(/^(.*)\s*\((\d{4})\)$/);
    if (m) {
        const title = sanitize(m[1]);
        const year = Number(m[2]);
        return { type: "movie", title, year, ext };
    }
    m = cleaned.match(/^(.*?)[\s.\-]\b(19\d{2}|20\d{2}|21\d{2})\b/);
    if (m) {
        const title = sanitize(m[1]);
        const year = Number(m[2]);
        return { type: "movie", title, year, ext };
    }
    // Fallback to unknown, try parent hints
    if (parentHints.show) {
        return { type: "tv", show: parentHints.show, year: parentHints.year, ext };
    }
    return { type: "unknown", ext };
}
async function tmdbSearch(title, prefer, year) {
    if (!config_1.config.tmdbApiKey)
        return {};
    try {
        const params = { api_key: config_1.config.tmdbApiKey, query: title, include_adult: false };
        if (year) {
            if (prefer === "movie")
                params.year = year;
            else
                params.first_air_date_year = year;
        }
        const url = prefer === "movie" ? "https://api.themoviedb.org/3/search/movie" : "https://api.themoviedb.org/3/search/tv";
        const { data } = await axios_1.default.get(url, { params, timeout: 10000 });
        const results = Array.isArray(data?.results) ? data.results : [];
        const best = results[0];
        if (!best)
            return {};
        if (prefer === "movie") {
            return {
                confirmedType: "movie",
                canonicalTitle: best.title || best.original_title || title,
                canonicalYear: best.release_date ? Number(String(best.release_date).slice(0, 4)) : year,
            };
        }
        else {
            return {
                confirmedType: "tv",
                canonicalTitle: best.name || best.original_name || title,
                canonicalYear: best.first_air_date ? Number(String(best.first_air_date).slice(0, 4)) : year,
            };
        }
    }
    catch (_e) {
        return {};
    }
}
async function tvmazeSearch(title, year) {
    try {
        const url = "https://api.tvmaze.com/search/shows";
        const { data } = await axios_1.default.get(url, { params: { q: title }, timeout: 10000 });
        const arr = Array.isArray(data) ? data : [];
        const best = arr[0]?.show;
        if (!best)
            return {};
        const name = best.name || title;
        const premiered = best.premiered ? Number(String(best.premiered).slice(0, 4)) : year;
        return { confirmedType: "tv", canonicalTitle: name, canonicalYear: premiered };
    }
    catch (_e) {
        return {};
    }
}
async function itunesMovieSearch(title, year) {
    try {
        const url = "https://itunes.apple.com/search";
        const { data } = await axios_1.default.get(url, { params: { term: title, media: "movie", limit: 5 }, timeout: 10000 });
        const results = Array.isArray(data?.results) ? data.results : [];
        const best = results[0];
        if (!best)
            return {};
        const name = best.trackName || title;
        const y = best.releaseDate ? new Date(best.releaseDate).getFullYear() : year;
        return { confirmedType: "movie", canonicalTitle: name, canonicalYear: y };
    }
    catch (_e) {
        return {};
    }
}
function computeTarget(p, srcBaseName) {
    const orgBase = config_1.config.organizedBase;
    if (p.type === "movie") {
        const title = p.title ? sanitize(p.title) : sanitize(path.parse(srcBaseName).name);
        const folder = p.year ? `${title} (${p.year})` : title;
        const dstDir = path.join(orgBase, "Movies", folder);
        const dstName = `${folder}${p.ext}`;
        return path.join(dstDir, dstName);
    }
    if (p.type === "tv") {
        const show = p.show ? sanitize(p.show) : sanitize(path.parse(srcBaseName).name);
        if (typeof p.season === "number" && typeof p.episode === "number") {
            const seasonDir = `Season ${pad2(p.season)}`;
            const showDir = p.year ? `${show} (${p.year})` : show;
            const dstDir = path.join(orgBase, "TV", showDir, seasonDir);
            const fileName = `${show} S${pad2(p.season)}E${pad2(p.episode)}${p.ext}`;
            return path.join(dstDir, fileName);
        }
        if (typeof p.absolute === "number") {
            const showDir = p.year ? `${show} (${p.year})` : show;
            const dstDir = path.join(orgBase, "TV", showDir);
            const fileName = `${show} - ${pad4(p.absolute)}${p.ext}`;
            return path.join(dstDir, fileName);
        }
        const showDir = p.year ? `${show} (${p.year})` : show;
        const dstDir = path.join(orgBase, "TV", showDir);
        const fileName = `${show}${p.ext}`;
        return path.join(dstDir, fileName);
    }
    return null;
}
async function ensureDir(p) {
    await fsp.mkdir(p, { recursive: true });
}
async function makeSymlink(src, dst, dryRun) {
    const dstDir = path.dirname(dst);
    await ensureDir(dstDir);
    const relTarget = path.relative(dstDir, src);
    try {
        const st = await fsp.lstat(dst).catch(() => null);
        if (st) {
            if (st.isSymbolicLink()) {
                const cur = await fsp.readlink(dst).catch(() => "");
                const resolved = path.resolve(dstDir, cur);
                if (resolved === src)
                    return; // already correct
                await fsp.unlink(dst);
            }
            else {
                // Exists as file/dir; leave it
                return;
            }
        }
        if (!dryRun) {
            await fsp.symlink(relTarget, dst);
        }
    }
    catch (e) {
        console.error(`[${new Date().toISOString()}][organize] symlink failed`, { src, dst, err: e?.message });
    }
}
async function walkDir(root, acc, limit) {
    const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const ent of entries) {
        const full = path.join(root, ent.name);
        if (ent.isDirectory()) {
            await walkDir(full, acc, limit);
            if (acc.length >= limit)
                return;
        }
        else if (ent.isFile()) {
            if (isVideo(ent.name)) {
                acc.push(full);
                if (acc.length >= limit)
                    return;
            }
        }
    }
}
async function organizeOnce(opts) {
    const dryRun = !!opts?.dryRun;
    const limit = opts?.limit ?? 10000;
    const roots = [path.join(config_1.config.mountBase, "realdebrid"), path.join(config_1.config.mountBase, "torbox")];
    const files = [];
    for (const r of roots) {
        try {
            const st = await fsp.stat(r);
            if (st.isDirectory()) {
                await walkDir(r, files, limit);
            }
        }
        catch (_) { /* ignore */ }
    }
    let processed = 0;
    for (const src of files) {
        const base = path.basename(src);
        const parsed = parseFilename(base, src);
        if (parsed.type === "movie" && parsed.title) {
            const meta = config_1.config.tmdbApiKey
                ? await tmdbSearch(parsed.title, "movie", parsed.year)
                : await itunesMovieSearch(parsed.title, parsed.year);
            if (meta.canonicalTitle)
                parsed.title = meta.canonicalTitle;
            if (meta.canonicalYear)
                parsed.year = meta.canonicalYear;
        }
        else if (parsed.type === "tv" && parsed.show) {
            const meta = config_1.config.tmdbApiKey
                ? await tmdbSearch(parsed.show, "tv", parsed.year)
                : await tvmazeSearch(parsed.show, parsed.year);
            if (meta.canonicalTitle)
                parsed.show = meta.canonicalTitle;
            if (meta.canonicalYear)
                parsed.year = meta.canonicalYear;
        }
        const dst = computeTarget(parsed, base);
        if (!dst)
            continue;
        await makeSymlink(src, dst, dryRun);
        processed++;
    }
    console.log(`[${new Date().toISOString()}][organize] complete`, { count: processed, dryRun, organizedBase: config_1.config.organizedBase });
}
let organizerTimer = null;
function startOrganizerWatch() {
    if (organizerTimer)
        return;
    const every = Math.max(30, Number(config_1.config.orgScanIntervalSeconds || 300));
    console.log(`[${new Date().toISOString()}][organize] watch started`, { everySeconds: every });
    const tick = async () => {
        try {
            await organizeOnce();
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][organize] error`, { err: e?.message });
        }
    };
    organizerTimer = setInterval(tick, every * 1000);
    // Kick immediately
    tick();
}
