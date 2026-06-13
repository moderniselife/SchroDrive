"use strict";
/**
 * SchroDrive — Media Organiser
 *
 * Scans mounted debrid provider directories for video files, parses filenames
 * to classify content as TV shows, movies, or anime, looks up canonical metadata
 * via TMDB, TVMaze, and iTunes APIs, and creates a symlink-based organised library
 * structure under `Movies/`, `TV/`, and `Anime/` folders.
 *
 * Supports filename patterns including:
 * - TV: `S01E02`, `1x02`, and anime absolute numbering (e.g. `Show - 637`)
 * - Movies: `Title (Year)`, `Title.2024.`, and parent directory year hints
 *
 * Can run as a one-shot scan or as a periodic watcher on a configurable interval.
 *
 * @module organizer
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizeOnce = organizeOnce;
exports.startOrganizerWatch = startOrganizerWatch;
const fsp = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../core/config");
const mediaClassifier_1 = require("../core/mediaClassifier");
const mount_1 = require("./mount");
// ===========================================================================
// Types & Constants
// ===========================================================================
/** Directory names that should never be treated as show/movie titles by path walkers. */
const MOUNT_STOP_WORDS = new Set([
    "links", "__all__", "anime", "shows", "movies", "cloud",
    ...config_1.config.providers.map((p) => p.toLowerCase()),
]);
/** Set of recognised video file extensions (lowercase, including dot). */
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
    ".m2ts",
    ".ts",
    ".iso",
]);
/**
 * Checks whether a filename has a recognised video file extension.
 *
 * @param file - The filename (or full path) to check.
 * @returns `true` if the file extension matches a known video format.
 */
function isVideo(file) {
    const ext = path.extname(file).toLowerCase();
    return VIDEO_EXTS.has(ext);
}
// ===========================================================================
// Filename Sanitisation & Parsing
// ===========================================================================
/**
 * Sanitises a filename or title by removing brackets, converting dots/underscores
 * to spaces, collapsing whitespace, and replacing filesystem-unsafe characters.
 *
 * @param input - The raw string to sanitise.
 * @returns A cleaned string safe for use in file/directory names.
 */
function sanitize(input) {
    let s = input
        .replace(/\[[^\]]*\]/g, " ") // Strip square-bracket groups (e.g. [1080p])
        .replace(/\([^\)]*\)/g, " ") // Strip parenthetical groups
        .replace(/[_.]/g, " ") // Convert dots/underscores to spaces
        .replace(/\s+/g, " ") // Collapse multiple spaces
        .trim();
    s = s.replace(/[\\/:*?"<>|]/g, "-"); // Replace filesystem-unsafe chars
    return s;
}
/**
 * Checks whether a file's parent directories suggest a TV show context.
 * Looks up to 3 parent directories for patterns like "Season 01", "S01", or "episode".
 *
 * @param fullPath - The absolute path to the file.
 * @returns `true` if surrounding directories indicate TV content.
 */
function isLikelyTvContext(fullPath) {
    const segs = [];
    let cur = path.dirname(fullPath);
    for (let i = 0; i < 3; i++) {
        const b = path.basename(cur);
        if (!b || b === "/" || b === ".")
            break;
        if (MOUNT_STOP_WORDS.has(b.toLowerCase()))
            break;
        segs.push(b);
        const next = path.dirname(cur);
        if (next === cur)
            break;
        cur = next;
    }
    // Match "Season 01", "S01", or "episode" in any parent directory
    return segs.some((s) => /\bseason\s*\d+\b/i.test(s) || /\bs\d{1,2}\b/i.test(s) || /\bepisode\b/i.test(s));
}
/**
 * Walks up to 5 parent directories to find a meaningful release folder name
 * that could serve as a movie title candidate. Skips generic names like
 * "links", purely numeric names, and very short names.
 *
 * @param fullPath - The absolute path to the file.
 * @returns A guessed title string, or `undefined` if no suitable candidate found.
 */
function pickCandidateTitleFromPath(fullPath) {
    const bad = [/^_?more_\d+$/i, /^\d+$/, /^-+$/];
    let cur = path.dirname(fullPath);
    for (let i = 0; i < 5; i++) {
        const name = path.basename(cur);
        if (!name || name === "/" || name === ".")
            break;
        const lower = name.toLowerCase();
        // Use shared mount stop-words set
        if (MOUNT_STOP_WORDS.has(lower))
            break;
        const isBad = bad.some((r) => r.test(name));
        if (!isBad && name.length > 2) {
            return guessTitleFromFilename(name);
        }
        const next = path.dirname(cur);
        if (next === cur)
            break;
        cur = next;
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Number Padding Helpers
// ---------------------------------------------------------------------------
/**
 * Pads a number to at least 2 digits (e.g. 1 → "01", 12 → "12").
 *
 * @param n - The number to pad.
 * @returns The zero-padded string.
 */
function pad2(n) { return n < 10 ? `0${n}` : String(n); }
/**
 * Pads a number to at least 4 digits (e.g. 1 → "0001").
 *
 * @param n - The number to pad.
 * @returns The zero-padded string.
 */
function pad4(n) { return `${n}`.padStart(4, "0"); }
/**
 * Extracts hints from parent directory names, looking for patterns like
 * "Show Name (1997)" to determine show name and premiere year.
 *
 * @param fullPath - The absolute path to the file.
 * @returns A partial Parsed object with any discovered show/year hints.
 */
/**
 * Cleans a TV show name by removing season/episode codes, quality/release tags,
 * and trailing hyphens/spaces.
 *
 * @param name - The raw name to clean.
 * @returns The cleaned TV show name.
 */
function cleanShowName(name) {
    let s = name;
    s = s.replace(/\bS\d{1,2}E\d{1,3}(?:-?[eE]?\d{1,3})*\b.*/i, "");
    s = s.replace(/\b\d{1,2}x\d{1,3}(?:-?\d{1,3})*\b.*/i, "");
    s = s.replace(/\bSeason\s*\d+\b.*/i, "");
    s = s.replace(/\bS\d{1,2}\b.*/i, "");
    s = s.replace(/\b(480p|720p|1080p|2160p|4k|x264|x265|hevc|av1|hdr|dv|dolby|vision|webrip|web\-dl|bluray|bdrip|remux|hdtv|dvdrip|proper|repack|extended|remastered|dual|multi|ddp?\d(?:\.\d)?|dts(?:-hd)?|atmos)\b.*/gi, " ");
    s = sanitize(s);
    // Strip trailing hyphens and spaces
    s = s.replace(/\s*[-—–]\s*$/, "").trim();
    return s;
}
/**
 * Walks up parent directories to find a clean show name and optional year,
 * skipping generic folders like "Season XX".
 *
 * @param fullPath - The absolute file path.
 * @returns An object with the parsed show name and premiere year.
 */
function findShowHintFromPath(fullPath) {
    let cur = path.dirname(fullPath);
    for (let i = 0; i < 4; i++) {
        const name = path.basename(cur);
        if (!name || name === "/" || name === "." || MOUNT_STOP_WORDS.has(name.toLowerCase()))
            break;
        // Skip generic season folders
        if (/^\bseason\s*\d+\b$/i.test(name) || /^\bs\d{1,2}$/i.test(name)) {
            cur = path.dirname(cur);
            continue;
        }
        const m = name.match(/^(.*?)(?:\s*\((\d{4})\))?$/);
        if (m) {
            let show = cleanShowName(m[1] || "");
            let year = m[2] ? Number(m[2]) : undefined;
            // Extract year from show name if it ends with one
            const yearMatch = show.match(/^(.*?)\s+\b(19\d{2}|20\d{2}|21\d{2})\b$/);
            if (yearMatch) {
                show = cleanShowName(yearMatch[1]);
                year = Number(yearMatch[2]);
            }
            if (show && show.length > 2) {
                return { show, year };
            }
        }
        cur = path.dirname(cur);
    }
    return {};
}
/**
 * Strips release-group tags, quality indicators, and codec information
 * from a filename to extract a best-guess title.
 *
 * Removes: resolution tags (480p–4K), codec names (x264, HEVC, AV1),
 * source tags (WEBRip, BluRay), audio formats (DTS, Atmos), and
 * other common release keywords (PROPER, REPACK, EXTENDED, etc.).
 *
 * @param baseNoExt - The filename without its extension.
 * @returns A cleaned title string.
 */
function guessTitleFromFilename(baseNoExt) {
    let s = baseNoExt;
    s = s.replace(/\[[^\]]*\]/g, " "); // Strip bracket groups
    s = s.replace(/\([^\)]*\)/g, " "); // Strip parenthetical groups
    s = s.replace(/[_.]/g, " "); // Convert dots/underscores to spaces
    // Strip common release quality/codec/source tags
    s = s.replace(/\b(480p|720p|1080p|2160p|4k|x264|x265|hevc|av1|hdr|dv|dolby|vision|webrip|web\-dl|bluray|bdrip|remux|hdtv|dvdrip|proper|repack|extended|remastered|dual|multi|ddp?\d(?:\.\d)?|dts(?:-hd)?|atmos)\b/gi, " ");
    s = s.replace(/\s+/g, " ").trim();
    s = s.replace(/[\\/:*?"<>|]/g, "-"); // Replace filesystem-unsafe chars
    return s;
}
/**
 * Parses a media filename to extract type, title/show, season, episode,
 * year, and other metadata. Tries multiple regex patterns in priority order:
 *
 * 1. `Title (Year)` — movie with explicit year in parentheses
 * 2. Episode-first/Standard TV season/episode notation (including startsWithEpisode check)
 * 3. `1x02` — alternative TV notation
 * 4. `Show - 637` — anime absolute episode numbering
 * 5. `Title.2024.` — movie with year separated by dots/spaces
 * 6. Parent directory year hints — fallback for movies
 * 7. TV context from surrounding directories — final fallback
 *
 * @param fileName - The filename (with extension) to parse.
 * @param fullPath - The absolute path (used for parent directory hints).
 * @returns A {@link Parsed} object with the extracted metadata.
 */
function parseFilename(fileName, fullPath) {
    const ext = path.extname(fileName);
    const baseNoExt = fileName.slice(0, -ext.length);
    const cleaned = sanitize(baseNoExt);
    const pathHints = findShowHintFromPath(fullPath);
    // Pattern 1: "Title (Year)" — explicit movie with year in parentheses
    let m = baseNoExt.match(/^(.*)\s*\((\d{4})\)\s*$/);
    if (m) {
        const title = cleanShowName(m[1]);
        const year = Number(m[2]);
        return { type: "movie", title, year, ext };
    }
    // Pattern 2: TV S01E02 notation (e.g. "Show Name S01E02" or starts with "S01E02")
    // First, check if the filename starts with the episode code (meaning show name is not in the filename)
    const startsWithEpisode = /^\bS(\d{1,2})E(\d{1,3})(?:-?[eE]?\d{1,3})*\b/i.test(cleaned) || /^\b(\d{1,2})x(\d{1,3})(?:-?\d{1,3})*\b/i.test(cleaned);
    if (startsWithEpisode) {
        const epMatch = cleaned.match(/^\bS(\d{1,2})E(\d{1,3})(?:-?[eE]?\d{1,3})*\b/i) || cleaned.match(/^\b(\d{1,2})x(\d{1,3})(?:-?\d{1,3})*\b/i);
        if (epMatch) {
            const season = Number(epMatch[1]);
            const episode = Number(epMatch[2]);
            return { type: "tv", show: pathHints.show, season, episode, year: pathHints.year, ext };
        }
    }
    m = cleaned.match(/(.+?)\s*[\- ]?\bS(\d{1,2})E(\d{1,3})(?:-?[eE]?\d{1,3})*\b/i);
    if (m) {
        let show = cleanShowName(m[1]);
        let year = pathHints.year;
        // Extract year from show name if it ends with one
        const yearMatch = show.match(/^(.*?)\s+\b(19\d{2}|20\d{2}|21\d{2})\b$/);
        if (yearMatch) {
            show = cleanShowName(yearMatch[1]);
            year = Number(yearMatch[2]);
        }
        const season = Number(m[2]);
        const episode = Number(m[3]);
        return { type: "tv", show: show || pathHints.show, season, episode, year, ext };
    }
    // Pattern 3: Alternative TV notation "1x02" (e.g. "Show Name 1x02")
    m = cleaned.match(/(.+?)\s*[\- ]?\b(\d{1,2})x(\d{1,3})(?:-?\d{1,3})*\b/i);
    if (m) {
        let show = cleanShowName(m[1]);
        let year = pathHints.year;
        // Extract year from show name if it ends with one
        const yearMatch = show.match(/^(.*?)\s+\b(19\d{2}|20\d{2}|21\d{2})\b$/);
        if (yearMatch) {
            show = cleanShowName(yearMatch[1]);
            year = Number(yearMatch[2]);
        }
        const season = Number(m[2]);
        const episode = Number(m[3]);
        return { type: "tv", show: show || pathHints.show, season, episode, year, ext };
    }
    // Pattern 4: Anime absolute numbering "Show Name - 637" or starts with "637"
    const startsWithAbs = /^\b(\d{1,4})\b/.test(cleaned);
    if (startsWithAbs) {
        const absMatch = cleaned.match(/^\b(\d{1,4})\b/);
        if (absMatch) {
            const absolute = Number(absMatch[1]);
            return { type: "tv", show: pathHints.show, absolute, year: pathHints.year, ext };
        }
    }
    m = cleaned.match(/(.+?)\s*[\- ]\s*(\d{1,4})(?:\b|\s)/);
    if (m) {
        let show = cleanShowName(m[1]);
        let year = pathHints.year;
        // Extract year from show name if it ends with one
        const yearMatch = show.match(/^(.*?)\s+\b(19\d{2}|20\d{2}|21\d{2})\b$/);
        if (yearMatch) {
            show = cleanShowName(yearMatch[1]);
            year = Number(yearMatch[2]);
        }
        const absolute = Number(m[2]);
        return { type: "tv", show: show || pathHints.show, absolute, year, ext };
    }
    // Pattern 5: Movie with year in title "Title.2024." or "Title 2024"
    m = cleaned.match(/^(.*?)[\s.\-]\b(19\d{2}|20\d{2}|21\d{2})\b/);
    if (m) {
        const title = cleanShowName(m[1]);
        const year = Number(m[2]);
        return { type: "movie", title, year, ext };
    }
    // Pattern 6: Check parent directories for year hints (fallback for movies)
    if (pathHints.show && pathHints.year && !isLikelyTvContext(fullPath)) {
        return { type: "movie", title: pathHints.show, year: pathHints.year, ext };
    }
    // Fallback: only treat as TV if surrounding folders strongly suggest TV context
    if (pathHints.show && isLikelyTvContext(fullPath)) {
        return { type: "tv", show: pathHints.show, year: pathHints.year, ext };
    }
    return { type: "unknown", ext };
}
// ===========================================================================
// Metadata Lookup
// ===========================================================================
/**
 * Searches TMDB (The Movie Database) for a title to confirm its type
 * and retrieve canonical naming and year information.
 *
 * @param title - The title to search for.
 * @param prefer - Whether to search as "tv" or "movie".
 * @param year - Optional year to refine the search.
 * @returns An object with confirmed type, canonical title, and canonical year.
 */
async function tmdbSearch(title, prefer, year) {
    if (!config_1.config.tmdbApiKey)
        return {};
    try {
        const params = { api_key: config_1.config.tmdbApiKey, query: title, include_adult: false };
        if (year) {
            // TMDB uses different year parameters for movies vs TV
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
/**
 * Searches TVMaze for a TV show title to retrieve canonical naming
 * and premiere year. Used as a fallback when TMDB is not configured.
 *
 * @param title - The show title to search for.
 * @param year - Optional year hint (not used by TVMaze API, but returned if no result found).
 * @returns An object with confirmed type, canonical title, and canonical year.
 */
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
/**
 * Searches the iTunes Search API for a movie title to retrieve canonical
 * naming and release year. Used as a fallback when TMDB is not configured.
 *
 * @param title - The movie title to search for.
 * @param year - Optional year hint (returned if no result found).
 * @returns An object with confirmed type, canonical title, and canonical year.
 */
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
// ===========================================================================
// File Operations
// ===========================================================================
/**
 * Computes the target symlink path for an organised media file based on
 * its parsed metadata.
 *
 * Output structure:
 * - Movies: `<organizedBase>/Movies/<Title> (<Year>)/<Title> (<Year>).ext`
 * - Anime (TV): `<organizedBase>/Anime/<Show> (<Year>)/Season <SS>/<Show> S<SS>E<EE>.ext`
 * - TV (S/E): `<organizedBase>/TV/<Show> (<Year>)/Season <SS>/<Show> S<SS>E<EE>.ext`
 * - TV (absolute): `<organizedBase>/TV/<Show> (<Year>)/<Show> - <NNNN>.ext`
 * - TV (no episode): `<organizedBase>/TV/<Show> (<Year>)/<Show>.ext`
 *
 * @param p - The parsed metadata from {@link parseFilename}.
 * @param srcBaseName - The original filename (used as fallback for titles).
 * @param srcFullPath - The full path to the source file (used for torrent dir classification).
 * @returns The absolute target path, or `null` if type is unknown.
 */
function computeTarget(p, srcBaseName, srcFullPath) {
    const orgBase = config_1.config.organizedBase;
    if (p.type === "movie") {
        const title = p.title ? sanitize(p.title) : sanitize(path.parse(srcBaseName).name);
        const folder = p.year ? `${title} (${p.year})` : title;
        const dstDir = path.join(orgBase, "Movies", folder);
        const dstName = `${folder}${p.ext}`;
        return path.join(dstDir, dstName);
    }
    if (p.type === "tv") {
        // Check if the content is anime using the media classifier.
        // Extract the torrent directory name — the directory immediately under __all__/ or links/.
        let torrentDirName;
        if (srcFullPath) {
            const segments = srcFullPath.split(path.sep);
            const allIdx = segments.lastIndexOf("__all__");
            const linksIdx = segments.lastIndexOf("links");
            const rootIdx = Math.max(allIdx, linksIdx);
            if (rootIdx >= 0 && rootIdx + 1 < segments.length) {
                torrentDirName = segments[rootIdx + 1];
            }
        }
        const classifyInput = torrentDirName || p.show || srcBaseName;
        const mediaCategory = (0, mediaClassifier_1.classifyTorrent)(classifyInput);
        const show = p.show ? sanitize(p.show) : sanitize(path.parse(srcBaseName).name);
        const showDir = p.year ? `${show} (${p.year})` : show;
        if (mediaCategory === 'anime') {
            // Output to Anime/ instead of TV/
            if (typeof p.season === "number" && typeof p.episode === "number") {
                const seasonDir = `Season ${pad2(p.season)}`;
                const epStr = `${show} S${pad2(p.season)}E${pad2(p.episode)}`;
                return path.join(orgBase, "Anime", showDir, seasonDir, `${epStr}${p.ext}`);
            }
            if (typeof p.absolute === "number") {
                return path.join(orgBase, "Anime", showDir, `${show} - ${pad4(p.absolute)}${p.ext}`);
            }
            return path.join(orgBase, "Anime", showDir, `${show}${p.ext}`);
        }
        if (typeof p.season === "number" && typeof p.episode === "number") {
            const seasonDir = `Season ${pad2(p.season)}`;
            const dstDir = path.join(orgBase, "TV", showDir, seasonDir);
            const fileName = `${show} S${pad2(p.season)}E${pad2(p.episode)}${p.ext}`;
            return path.join(dstDir, fileName);
        }
        if (typeof p.absolute === "number") {
            const dstDir = path.join(orgBase, "TV", showDir);
            const fileName = `${show} - ${pad4(p.absolute)}${p.ext}`;
            return path.join(dstDir, fileName);
        }
        // TV with no episode info — place directly in the show directory
        const dstDir = path.join(orgBase, "TV", showDir);
        const fileName = `${show}${p.ext}`;
        return path.join(dstDir, fileName);
    }
    return null;
}
/**
 * Ensures a directory exists, creating it recursively if needed.
 *
 * @param p - The absolute path to ensure exists.
 */
async function ensureDir(p) {
    await fsp.mkdir(p, { recursive: true });
}
/**
 * Creates a relative symlink from `src` to `dst`. If a symlink already
 * exists at `dst` pointing to the correct target, it is left unchanged.
 * If a symlink exists but points elsewhere, it is replaced. Regular files
 * or directories at `dst` are left untouched to avoid data loss.
 *
 * @param src - The absolute path to the source (real) file.
 * @param dst - The absolute path where the symlink should be created.
 * @param dryRun - If `true`, log but do not actually create the symlink.
 */
async function makeSymlink(src, dst, dryRun) {
    const dstDir = path.dirname(dst);
    await ensureDir(dstDir);
    const relTarget = path.relative(dstDir, src);
    try {
        const st = await fsp.lstat(dst).catch(() => null);
        if (st) {
            if (st.isSymbolicLink()) {
                // Check if existing symlink already points to the correct target
                const cur = await fsp.readlink(dst).catch(() => "");
                const resolved = path.resolve(dstDir, cur);
                if (resolved === src)
                    return; // Already correct — skip
                await fsp.unlink(dst);
            }
            else {
                // Exists as a regular file/directory — leave it to avoid data loss
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
/**
 * Recursively walks a directory tree, collecting absolute paths of video files.
 * Handles symlinks by falling back to `stat` when `withFileTypes` doesn't resolve.
 *
 * @param root - The directory to start walking from.
 * @param acc - Accumulator array to push discovered file paths into.
 * @param limit - Maximum number of files to collect (prevents runaway scans).
 */
async function walkDir(root, acc, limit) {
    let entries;
    try {
        entries = await fsp.readdir(root, { withFileTypes: true });
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][organize] failed to read directory ${root}`, { err: err?.message || String(err) });
        return;
    }
    for (const ent of entries) {
        const full = path.join(root, ent.name);
        let isDir = ent.isDirectory();
        let isFil = ent.isFile();
        // Symlinks may not report type correctly via withFileTypes — fall back to stat to follow them
        if (!isDir && !isFil) {
            const st = await fsp.stat(full).catch(() => null);
            if (st) {
                isDir = st.isDirectory();
                isFil = st.isFile();
            }
        }
        if (isDir) {
            await walkDir(full, acc, limit);
            if (acc.length >= limit)
                return;
        }
        else if (isFil) {
            if (isVideo(ent.name)) {
                acc.push(full);
                if (acc.length >= limit)
                    return;
            }
        }
    }
}
// ===========================================================================
// Stale Symlink Pruning
// ===========================================================================
/**
 * Recursively walks the organised library directories and removes broken
 * symlinks (links whose targets no longer exist). Also removes empty
 * directories left behind after pruning.
 *
 * This handles the case where FUSE mounts are removed but the organised
 * symlinks remain, leaving thousands of dead links in the library.
 *
 * @param dir - The directory to prune.
 * @returns The count of removed symlinks and removed empty directories.
 */
async function pruneStaleSymlinks(dir) {
    let removedLinks = 0;
    let removedDirs = 0;
    let entries;
    try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
    }
    catch {
        return { removedLinks, removedDirs };
    }
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            // Recurse into subdirectories first
            const sub = await pruneStaleSymlinks(full);
            removedLinks += sub.removedLinks;
            removedDirs += sub.removedDirs;
            // After pruning contents, remove the directory if it's now empty
            try {
                const remaining = await fsp.readdir(full);
                if (remaining.length === 0) {
                    await fsp.rmdir(full);
                    removedDirs++;
                }
            }
            catch { /* ignore — directory may have been removed already */ }
        }
        else if (ent.isSymbolicLink()) {
            // Check if the symlink target exists
            try {
                await fsp.stat(full); // stat follows the link — throws if target missing
            }
            catch {
                // Target doesn't exist — remove the broken symlink
                try {
                    await fsp.unlink(full);
                    removedLinks++;
                }
                catch (e) {
                    console.warn(`[${new Date().toISOString()}][organize] failed to remove stale symlink`, { path: full, err: e?.message });
                }
            }
        }
    }
    return { removedLinks, removedDirs };
}
// ===========================================================================
// Main Orchestration
// ===========================================================================
/**
 * Runs a single pass of the media organiser.
 *
 * First prunes any stale/broken symlinks from the organised library,
 * then scans all mounted provider directories for video files, parses their
 * filenames to determine type (movie/TV), looks up canonical metadata
 * from external APIs, and creates symlinks in the organised library.
 *
 * For unknown files, attempts multiple fallback strategies:
 * 1. Guess title from filename, then search TMDB/iTunes
 * 2. Guess title from parent directory name
 * 3. Guess title from release folder name
 * 4. Size-based heuristic: large standalone videos (>300MB) without TV
 *    context are assumed to be movies
 *
 * @param opts - Optional configuration for the scan.
 * @param opts.dryRun - If `true`, log actions but don't create symlinks.
 * @param opts.limit - Maximum number of files to process (default: 10000).
 */
async function organizeOnce(opts) {
    const dryRun = !!opts?.dryRun;
    const limit = opts?.limit ?? 10000;
    // --- Prune stale symlinks before scanning ---
    const orgBase = config_1.config.organizedBase;
    const movieDir = path.join(orgBase, "Movies");
    const tvDir = path.join(orgBase, "TV");
    const animeDir = path.join(orgBase, "Anime");
    let totalRemovedLinks = 0;
    let totalRemovedDirs = 0;
    for (const dir of [movieDir, tvDir, animeDir]) {
        try {
            const st = await fsp.stat(dir);
            if (st.isDirectory()) {
                const { removedLinks, removedDirs } = await pruneStaleSymlinks(dir);
                totalRemovedLinks += removedLinks;
                totalRemovedDirs += removedDirs;
            }
        }
        catch { /* directory may not exist yet */ }
    }
    if (totalRemovedLinks > 0 || totalRemovedDirs > 0) {
        console.log(`[${new Date().toISOString()}][organize] pruned stale content`, {
            removedSymlinks: totalRemovedLinks,
            removedEmptyDirs: totalRemovedDirs,
        });
    }
    // --- Scan mounted providers for video files ---
    const providerBases = config_1.config.providers.map((p) => path.join(config_1.config.mountBase, p));
    const roots = [];
    for (const b of providerBases) {
        // Check for Zurg-style organised category layout (__all__/anime/shows/movies)
        const allDir = path.join(b, "__all__");
        const allStat = await fsp.stat(allDir).catch(() => null);
        if (allStat?.isDirectory()) {
            roots.push(allDir); // Scan __all__ only — it's the superset, avoids duplicates
            continue;
        }
        // Legacy layout: check for links/ subdirectory
        const linksDir = path.join(b, "links");
        const linksStat = await fsp.stat(linksDir).catch(() => null);
        if (linksStat?.isDirectory()) {
            roots.push(linksDir);
        }
        else {
            roots.push(b);
        }
    }
    // Add WebDAV mount roots where skipOrganiser is false
    if (config_1.config.webdavMountsEnabled) {
        const webdavRoots = (0, mount_1.getWebdavOrganiserRoots)();
        for (const wr of webdavRoots) {
            const wrStat = await fsp.stat(wr).catch(() => null);
            if (wrStat?.isDirectory()) {
                roots.push(wr);
            }
        }
    }
    const files = [];
    for (const r of roots) {
        try {
            const st = await fsp.stat(r);
            if (st.isDirectory()) {
                await walkDir(r, files, limit);
            }
        }
        catch (_) { /* ignore — directory may not exist yet */ }
    }
    console.log(`[${new Date().toISOString()}][organize] scan`, { roots, files: files.length });
    let processed = 0;
    let movieCount = 0;
    let tvCount = 0;
    let unknownCount = 0;
    const unknownSamples = [];
    for (const src of files) {
        const base = path.basename(src);
        let parsed = parseFilename(base, src);
        // Enrich parsed results with metadata from external APIs
        if (parsed.type === "movie" && parsed.title) {
            const meta = config_1.config.tmdbApiKey
                ? await tmdbSearch(parsed.title, "movie", parsed.year)
                : await itunesMovieSearch(parsed.title, parsed.year);
            if (meta.canonicalTitle)
                parsed.title = cleanShowName(meta.canonicalTitle);
            if (meta.canonicalYear)
                parsed.year = meta.canonicalYear;
        }
        else if (parsed.type === "tv" && parsed.show) {
            const meta = config_1.config.tmdbApiKey
                ? await tmdbSearch(parsed.show, "tv", parsed.year)
                : await tvmazeSearch(parsed.show, parsed.year);
            if (meta.canonicalTitle)
                parsed.show = cleanShowName(meta.canonicalTitle);
            if (meta.canonicalYear)
                parsed.year = meta.canonicalYear;
        }
        else if (parsed.type === "unknown") {
            // Multi-stage fallback: try filename guess, parent dir guess, then release folder guess
            const baseNoExt = base.slice(0, -path.extname(base).length);
            const guess1 = guessTitleFromFilename(baseNoExt);
            const parentName = path.basename(path.dirname(src));
            const guess2 = guessTitleFromFilename(parentName);
            const dirGuess = pickCandidateTitleFromPath(src);
            const tryGuess = async (g) => {
                if (!g)
                    return null;
                const meta = config_1.config.tmdbApiKey
                    ? await tmdbSearch(g, "movie")
                    : await itunesMovieSearch(g);
                return meta;
            };
            let meta = await tryGuess(guess1);
            if (!(meta?.confirmedType === "movie" || meta?.canonicalTitle)) {
                meta = await tryGuess(guess2);
            }
            if (!(meta?.confirmedType === "movie" || meta?.canonicalTitle)) {
                meta = await tryGuess(dirGuess);
            }
            if (meta?.confirmedType === "movie" || meta?.canonicalTitle) {
                parsed = { type: "movie", title: cleanShowName(meta.canonicalTitle || dirGuess || guess2 || guess1), year: meta.canonicalYear, ext: path.extname(base) };
            }
            else {
                // Size-based fallback: large standalone video without TV context → treat as movie
                try {
                    const st = await fsp.stat(src);
                    const isVideoFile = isVideo(base);
                    const notTv = !isLikelyTvContext(src);
                    const large = st?.size && st.size > 300 * 1024 * 1024; // >300MB
                    if (isVideoFile && notTv && large) {
                        const title = dirGuess || guess2 || guess1;
                        if (title) {
                            parsed = { type: "movie", title: cleanShowName(title), ext: path.extname(base) };
                        }
                    }
                }
                catch { }
            }
        }
        if (parsed.type === "movie")
            movieCount++;
        else if (parsed.type === "tv")
            tvCount++;
        else {
            unknownCount++;
            if (unknownSamples.length < 10)
                unknownSamples.push(src);
        }
        const dst = computeTarget(parsed, base, src);
        if (!dst)
            continue;
        await makeSymlink(src, dst, dryRun);
        processed++;
    }
    console.log(`[${new Date().toISOString()}][organize] complete`, { count: processed, movies: movieCount, tv: tvCount, unknown: unknownCount, dryRun, organizedBase: config_1.config.organizedBase, unknownSamples });
}
// ===========================================================================
// Periodic Watcher
// ===========================================================================
/** Handle for the organiser's periodic interval timer. */
let organizerTimer = null;
/**
 * Starts the periodic media organiser watcher. Runs {@link organizeOnce}
 * on a configurable interval (minimum 30 seconds, default 300 seconds).
 *
 * The first scan kicks off immediately. Subsequent scans run at the
 * configured interval. Calling this function multiple times is safe —
 * duplicate timers are prevented.
 */
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
