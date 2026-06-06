/**
 * SchroDrive — Media Organiser
 *
 * Scans mounted debrid provider directories for video files, parses filenames
 * to classify content as TV shows or movies, looks up canonical metadata via
 * TMDB, TVMaze, and iTunes APIs, and creates a symlink-based organised library
 * structure under `Movies/` and `TV/` folders.
 *
 * Supports filename patterns including:
 * - TV: `S01E02`, `1x02`, and anime absolute numbering (e.g. `Show - 637`)
 * - Movies: `Title (Year)`, `Title.2024.`, and parent directory year hints
 *
 * Can run as a one-shot scan or as a periodic watcher on a configurable interval.
 *
 * @module organizer
 */

import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import axios from "axios";
import { config } from "./config";

// ===========================================================================
// Types & Constants
// ===========================================================================

/** Classification of a media file as TV, movie, or unknown. */
type MediaType = "tv" | "movie" | "unknown";

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
function isVideo(file: string): boolean {
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
function sanitize(input: string): string {
  let s = input
    .replace(/\[[^\]]*\]/g, " ")   // Strip square-bracket groups (e.g. [1080p])
    .replace(/\([^\)]*\)/g, " ")   // Strip parenthetical groups
    .replace(/[_.]/g, " ")         // Convert dots/underscores to spaces
    .replace(/\s+/g, " ")          // Collapse multiple spaces
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
function isLikelyTvContext(fullPath: string): boolean {
  const segs: string[] = [];
  let cur = path.dirname(fullPath);
  for (let i = 0; i < 3; i++) {
    const b = path.basename(cur);
    if (!b || b === "/" || b === ".") break;
    segs.push(b);
    const next = path.dirname(cur);
    if (next === cur) break;
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
function pickCandidateTitleFromPath(fullPath: string): string | undefined {
  const stop = new Set(["links"]);
  const bad = [/^_?more_\d+$/i, /^\d+$/, /^-+$/];
  let cur = path.dirname(fullPath);
  for (let i = 0; i < 5; i++) {
    const name = path.basename(cur);
    if (!name || name === "/" || name === ".") break;
    const lower = name.toLowerCase();
    const isBad = bad.some((r) => r.test(name));
    if (!stop.has(lower) && !isBad && name.length > 2) {
      return guessTitleFromFilename(name);
    }
    const next = path.dirname(cur);
    if (next === cur) break;
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
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/**
 * Pads a number to at least 3 digits (e.g. 1 → "001", 42 → "042").
 *
 * @param n - The number to pad.
 * @returns The zero-padded string.
 */
function pad3(n: number): string { return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n); }

/**
 * Pads a number to at least 4 digits (e.g. 1 → "0001").
 *
 * @param n - The number to pad.
 * @returns The zero-padded string.
 */
function pad4(n: number): string { return `${n}`.padStart(4, "0"); }

// ---------------------------------------------------------------------------
// Parsed Result Interface
// ---------------------------------------------------------------------------

/**
 * Result of parsing a media filename. Contains the classified type and
 * extracted metadata (title/show name, season, episode, year, etc.).
 */
interface Parsed {
  /** The classified media type. */
  type: MediaType;
  /** Movie title (only for type "movie"). */
  title?: string;
  /** Release or premiere year. */
  year?: number;
  /** TV show name (only for type "tv"). */
  show?: string;
  /** Season number (only for type "tv" with standard numbering). */
  season?: number;
  /** Episode number (only for type "tv" with standard numbering). */
  episode?: number;
  /** Absolute episode number for anime-style numbering. */
  absolute?: number;
  /** File extension including the dot (e.g. ".mkv"). */
  ext: string;
}

/**
 * Extracts hints from parent directory names, looking for patterns like
 * "Show Name (1997)" to determine show name and premiere year.
 *
 * @param fullPath - The absolute path to the file.
 * @returns A partial Parsed object with any discovered show/year hints.
 */
function parseFromParentDirs(fullPath: string): Partial<Parsed> {
  // Look at parent directory for hints like "South Park (1997)" or "Show Name (Year)"
  const parent = path.basename(path.dirname(fullPath));
  const m = parent.match(/^(.*?)(?:\s*\((\d{4})\))?$/);
  if (m) {
    const show = sanitize(m[1] || "");
    const year = m[2] ? Number(m[2]) : undefined;
    if (show) return { show, year };
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
function guessTitleFromFilename(baseNoExt: string): string {
  let s = baseNoExt;
  s = s.replace(/\[[^\]]*\]/g, " ");   // Strip bracket groups
  s = s.replace(/\([^\)]*\)/g, " ");   // Strip parenthetical groups
  s = s.replace(/[_.]/g, " ");         // Convert dots/underscores to spaces
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
 * 2. `S01E02` — standard TV season/episode notation
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
function parseFilename(fileName: string, fullPath: string): Parsed {
  const ext = path.extname(fileName);
  const baseNoExt = fileName.slice(0, -ext.length);
  const cleaned = sanitize(baseNoExt);

  const parentHints = parseFromParentDirs(fullPath);

  // Pattern 1: "Title (Year)" — explicit movie with year in parentheses
  let m = baseNoExt.match(/^(.*)\s*\((\d{4})\)\s*$/);
  if (m) {
    const title = sanitize(m[1]);
    const year = Number(m[2]);
    return { type: "movie", title, year, ext };
  }

  // Pattern 2: TV S01E02 notation (e.g. "Show Name S01E02" or "Show.S01E02")
  m = cleaned.match(/(.+?)\s*[\- ]?\bS(\d{1,2})E(\d{1,3})\b/i);
  if (m) {
    const show = sanitize(m[1]);
    const season = Number(m[2]);
    const episode = Number(m[3]);
    return { type: "tv", show: show || parentHints.show, season, episode, year: parentHints.year, ext };
  }

  // Pattern 3: Alternative TV notation "1x02" (e.g. "Show Name 1x02")
  m = cleaned.match(/(.+?)\s*[\- ]?\b(\d{1,2})x(\d{1,3})\b/i);
  if (m) {
    const show = sanitize(m[1]);
    const season = Number(m[2]);
    const episode = Number(m[3]);
    return { type: "tv", show: show || parentHints.show, season, episode, year: parentHints.year, ext };
  }

  // Pattern 4: Anime absolute numbering "Show Name - 637" or "Show Name 637"
  m = cleaned.match(/(.+?)\s*[\- ]\s*(\d{1,4})(?:\b|\s)/);
  if (m) {
    const show = sanitize(m[1]);
    const absolute = Number(m[2]);
    return { type: "tv", show: show || parentHints.show, absolute, year: parentHints.year, ext };
  }

  // Pattern 5: Movie with year in title "Title.2024." or "Title 2024"
  m = cleaned.match(/^(.*?)[\s.\-]\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (m) {
    const title = sanitize(m[1]);
    const year = Number(m[2]);
    return { type: "movie", title, year, ext };
  }

  // Pattern 6: Check parent directories for year hints (up to 3 levels up)
  {
    let pdir = path.dirname(fullPath);
    for (let i = 0; i < 3; i++) {
      const dn = path.basename(pdir);
      let mm = dn.match(/^(.*)\s*\((\d{4})\)$/);
      if (mm) {
        const title = sanitize(mm[1]);
        const year = Number(mm[2]);
        return { type: "movie", title, year, ext };
      }
      mm = dn.match(/^(.*?)[\s.\-]\b(19\d{2}|20\d{2}|21\d{2})\b/);
      if (mm) {
        const title = sanitize(mm[1]);
        const year = Number(mm[2]);
        return { type: "movie", title, year, ext };
      }
      const next = path.dirname(pdir);
      if (next === pdir) break;
      pdir = next;
    }
  }

  // Fallback: only treat as TV if surrounding folders strongly suggest TV context
  if (parentHints.show && isLikelyTvContext(fullPath)) {
    return { type: "tv", show: parentHints.show, year: parentHints.year, ext };
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
async function tmdbSearch(title: string, prefer: "tv" | "movie", year?: number): Promise<{
  confirmedType?: MediaType;
  canonicalTitle?: string;
  canonicalYear?: number;
}> {
  if (!config.tmdbApiKey) return {};
  try {
    const params: Record<string, any> = { api_key: config.tmdbApiKey, query: title, include_adult: false };
    if (year) {
      // TMDB uses different year parameters for movies vs TV
      if (prefer === "movie") params.year = year; else params.first_air_date_year = year;
    }
    const url = prefer === "movie" ? "https://api.themoviedb.org/3/search/movie" : "https://api.themoviedb.org/3/search/tv";
    const { data } = await axios.get(url, { params, timeout: 10000 });
    const results = Array.isArray(data?.results) ? data.results : [];
    const best = results[0];
    if (!best) return {};
    if (prefer === "movie") {
      return {
        confirmedType: "movie",
        canonicalTitle: best.title || best.original_title || title,
        canonicalYear: best.release_date ? Number(String(best.release_date).slice(0, 4)) : year,
      };
    } else {
      return {
        confirmedType: "tv",
        canonicalTitle: best.name || best.original_name || title,
        canonicalYear: best.first_air_date ? Number(String(best.first_air_date).slice(0, 4)) : year,
      };
    }
  } catch (_e) {
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
async function tvmazeSearch(title: string, year?: number): Promise<{
  confirmedType?: MediaType;
  canonicalTitle?: string;
  canonicalYear?: number;
}> {
  try {
    const url = "https://api.tvmaze.com/search/shows";
    const { data } = await axios.get(url, { params: { q: title }, timeout: 10000 });
    const arr = Array.isArray(data) ? data : [];
    const best = arr[0]?.show;
    if (!best) return {};
    const name = best.name || title;
    const premiered = best.premiered ? Number(String(best.premiered).slice(0, 4)) : year;
    return { confirmedType: "tv", canonicalTitle: name, canonicalYear: premiered };
  } catch (_e) {
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
async function itunesMovieSearch(title: string, year?: number): Promise<{
  confirmedType?: MediaType;
  canonicalTitle?: string;
  canonicalYear?: number;
}> {
  try {
    const url = "https://itunes.apple.com/search";
    const { data } = await axios.get(url, { params: { term: title, media: "movie", limit: 5 }, timeout: 10000 });
    const results = Array.isArray(data?.results) ? data.results : [];
    const best = results[0];
    if (!best) return {};
    const name = best.trackName || title;
    const y = best.releaseDate ? new Date(best.releaseDate).getFullYear() : year;
    return { confirmedType: "movie", canonicalTitle: name, canonicalYear: y };
  } catch (_e) {
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
 * - TV (S/E): `<organizedBase>/TV/<Show> (<Year>)/Season <SS>/<Show> S<SS>E<EE>.ext`
 * - TV (absolute): `<organizedBase>/TV/<Show> (<Year>)/<Show> - <NNNN>.ext`
 * - TV (no episode): `<organizedBase>/TV/<Show> (<Year>)/<Show>.ext`
 *
 * @param p - The parsed metadata from {@link parseFilename}.
 * @param srcBaseName - The original filename (used as fallback for titles).
 * @returns The absolute target path, or `null` if type is unknown.
 */
function computeTarget(p: Parsed, srcBaseName: string): string | null {
  const orgBase = config.organizedBase;
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
    // TV with no episode info — place directly in the show directory
    const showDir = p.year ? `${show} (${p.year})` : show;
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
async function ensureDir(p: string) {
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
async function makeSymlink(src: string, dst: string, dryRun: boolean) {
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
        if (resolved === src) return; // Already correct — skip
        await fsp.unlink(dst);
      } else {
        // Exists as a regular file/directory — leave it to avoid data loss
        return;
      }
    }
    if (!dryRun) {
      await fsp.symlink(relTarget, dst);
    }
  } catch (e) {
    console.error(`[${new Date().toISOString()}][organize] symlink failed`, { src, dst, err: (e as any)?.message });
  }
}

/**
 * Recursively walks a directory tree, collecting absolute paths of video files.
 * Handles symlinks by falling back to `lstat` when `withFileTypes` doesn't resolve.
 *
 * @param root - The directory to start walking from.
 * @param acc - Accumulator array to push discovered file paths into.
 * @param limit - Maximum number of files to collect (prevents runaway scans).
 */
async function walkDir(root: string, acc: string[], limit: number) {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    let isDir = ent.isDirectory();
    let isFil = ent.isFile();
    // Symlinks may not report type correctly via withFileTypes — fall back to lstat
    if (!isDir && !isFil) {
      const st = await fsp.lstat(full).catch(() => null as any);
      if (st) {
        isDir = st.isDirectory();
        isFil = st.isFile();
      }
    }
    if (isDir) {
      await walkDir(full, acc, limit);
      if (acc.length >= limit) return;
    } else if (isFil) {
      if (isVideo(ent.name)) {
        acc.push(full);
        if (acc.length >= limit) return;
      }
    }
  }
}

// ===========================================================================
// Main Orchestration
// ===========================================================================

/**
 * Runs a single pass of the media organiser.
 *
 * Scans all mounted provider directories for video files, parses their
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
export async function organizeOnce(opts?: { dryRun?: boolean; limit?: number }) {
  const dryRun = !!opts?.dryRun;
  const limit = opts?.limit ?? 10000;
  const providerBases = [path.join(config.mountBase, "realdebrid"), path.join(config.mountBase, "torbox")];
  const roots: string[] = [];
  for (const b of providerBases) {
    try {
      // Prefer the "links" subdirectory if it exists (used by some providers)
      const linksDir = path.join(b, "links");
      const st = await fsp.stat(linksDir).catch(() => null);
      if (st && st.isDirectory()) {
        roots.push(linksDir);
      } else {
        roots.push(b);
      }
    } catch (_) {
      roots.push(b);
    }
  }
  const files: string[] = [];
  for (const r of roots) {
    try {
      const st = await fsp.stat(r);
      if (st.isDirectory()) {
        await walkDir(r, files, limit);
      }
    } catch (_) { /* ignore — directory may not exist yet */ }
  }
  console.log(`[${new Date().toISOString()}][organize] scan`, { roots, files: files.length });

  let processed = 0;
  let movieCount = 0;
  let tvCount = 0;
  let unknownCount = 0;
  const unknownSamples: string[] = [];
  for (const src of files) {
    const base = path.basename(src);
    let parsed = parseFilename(base, src);

    // Enrich parsed results with metadata from external APIs
    if (parsed.type === "movie" && parsed.title) {
      const meta = config.tmdbApiKey
        ? await tmdbSearch(parsed.title, "movie", parsed.year)
        : await itunesMovieSearch(parsed.title, parsed.year);
      if (meta.canonicalTitle) parsed.title = meta.canonicalTitle;
      if (meta.canonicalYear) parsed.year = meta.canonicalYear;
    } else if (parsed.type === "tv" && parsed.show) {
      const meta = config.tmdbApiKey
        ? await tmdbSearch(parsed.show, "tv", parsed.year)
        : await tvmazeSearch(parsed.show, parsed.year);
      if (meta.canonicalTitle) parsed.show = meta.canonicalTitle;
      if (meta.canonicalYear) parsed.year = meta.canonicalYear;
    } else if (parsed.type === "unknown") {
      // Multi-stage fallback: try filename guess, parent dir guess, then release folder guess
      const baseNoExt = base.slice(0, -path.extname(base).length);
      const guess1 = guessTitleFromFilename(baseNoExt);
      const parentName = path.basename(path.dirname(src));
      const guess2 = guessTitleFromFilename(parentName);
      const dirGuess = pickCandidateTitleFromPath(src);

      const tryGuess = async (g: string | undefined) => {
        if (!g) return null as any;
        const meta = config.tmdbApiKey
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
        parsed = { type: "movie", title: meta.canonicalTitle || dirGuess || guess2 || guess1, year: meta.canonicalYear, ext: path.extname(base) } as Parsed;
      } else {
        // Size-based fallback: large standalone video without TV context → treat as movie
        try {
          const st = await fsp.stat(src);
          const isVideoFile = isVideo(base);
          const notTv = !isLikelyTvContext(src);
          const large = st?.size && st.size > 300 * 1024 * 1024; // >300MB
          if (isVideoFile && notTv && large) {
            const title = dirGuess || guess2 || guess1;
            if (title) {
              parsed = { type: "movie", title, ext: path.extname(base) } as Parsed;
            }
          }
        } catch {}
      }
    }

    if (parsed.type === "movie") movieCount++; else if (parsed.type === "tv") tvCount++; else {
      unknownCount++;
      if (unknownSamples.length < 10) unknownSamples.push(src);
    }

    const dst = computeTarget(parsed, base);
    if (!dst) continue;

    await makeSymlink(src, dst, dryRun);
    processed++;
  }

  console.log(
    `[${new Date().toISOString()}][organize] complete`,
    { count: processed, movies: movieCount, tv: tvCount, unknown: unknownCount, dryRun, organizedBase: config.organizedBase, unknownSamples }
  );
}

// ===========================================================================
// Periodic Watcher
// ===========================================================================

/** Handle for the organiser's periodic interval timer. */
let organizerTimer: NodeJS.Timeout | null = null;

/**
 * Starts the periodic media organiser watcher. Runs {@link organizeOnce}
 * on a configurable interval (minimum 30 seconds, default 300 seconds).
 *
 * The first scan kicks off immediately. Subsequent scans run at the
 * configured interval. Calling this function multiple times is safe —
 * duplicate timers are prevented.
 */
export function startOrganizerWatch() {
  if (organizerTimer) return;
  const every = Math.max(30, Number(config.orgScanIntervalSeconds || 300));
  console.log(`[${new Date().toISOString()}][organize] watch started`, { everySeconds: every });
  const tick = async () => {
    try {
      await organizeOnce();
    } catch (e) {
      console.error(`[${new Date().toISOString()}][organize] error`, { err: (e as any)?.message });
    }
  };
  organizerTimer = setInterval(tick, every * 1000);
  // Kick immediately
  tick();
}
