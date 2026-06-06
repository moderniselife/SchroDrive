import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import axios from "axios";
import { config } from "./config";

type MediaType = "tv" | "movie" | "unknown";

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

function isVideo(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return VIDEO_EXTS.has(ext);
}

function sanitize(input: string): string {
  let s = input
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^\)]*\)/g, " ")
    .replace(/[_.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/[\\/:*?"<>|]/g, "-");
  return s;
}

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
  return segs.some((s) => /\bseason\s*\d+\b/i.test(s) || /\bs\d{1,2}\b/i.test(s) || /\bepisode\b/i.test(s));
}

// Prefer a meaningful directory name (release folder) as a movie title candidate
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

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
function pad3(n: number): string { return n < 10 ? `00${n}` : n < 100 ? `0${n}` : String(n); }
function pad4(n: number): string { return `${n}`.padStart(4, "0"); }

interface Parsed {
  type: MediaType;
  title?: string; // movie title
  year?: number;
  show?: string; // tv show name
  season?: number;
  episode?: number;
  absolute?: number; // anime absolute numbering
  ext: string;
}

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

function guessTitleFromFilename(baseNoExt: string): string {
  let s = baseNoExt;
  s = s.replace(/\[[^\]]*\]/g, " ");
  s = s.replace(/\([^\)]*\)/g, " ");
  s = s.replace(/[_.]/g, " ");
  s = s.replace(/\b(480p|720p|1080p|2160p|4k|x264|x265|hevc|av1|hdr|dv|dolby|vision|webrip|web\-dl|bluray|bdrip|remux|hdtv|dvdrip|proper|repack|extended|remastered|dual|multi|ddp?\d(?:\.\d)?|dts(?:-hd)?|atmos)\b/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/[\\/:*?"<>|]/g, "-");
  return s;
}

function parseFilename(fileName: string, fullPath: string): Parsed {
  const ext = path.extname(fileName);
  const baseNoExt = fileName.slice(0, -ext.length);
  const cleaned = sanitize(baseNoExt);

  const parentHints = parseFromParentDirs(fullPath);

  let m = baseNoExt.match(/^(.*)\s*\((\d{4})\)\s*$/);
  if (m) {
    const title = sanitize(m[1]);
    const year = Number(m[2]);
    return { type: "movie", title, year, ext };
  }

  // TV patterns: S01E02 or 1x02
  m = cleaned.match(/(.+?)\s*[\- ]?\bS(\d{1,2})E(\d{1,3})\b/i);
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
  m = cleaned.match(/^(.*?)[\s.\-]\b(19\d{2}|20\d{2}|21\d{2})\b/);
  if (m) {
    const title = sanitize(m[1]);
    const year = Number(m[2]);
    return { type: "movie", title, year, ext };
  }

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

async function tmdbSearch(title: string, prefer: "tv" | "movie", year?: number): Promise<{
  confirmedType?: MediaType;
  canonicalTitle?: string;
  canonicalYear?: number;
}> {
  if (!config.tmdbApiKey) return {};
  try {
    const params: Record<string, any> = { api_key: config.tmdbApiKey, query: title, include_adult: false };
    if (year) {
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
    const showDir = p.year ? `${show} (${p.year})` : show;
    const dstDir = path.join(orgBase, "TV", showDir);
    const fileName = `${show}${p.ext}`;
    return path.join(dstDir, fileName);
  }
  return null;
}

async function ensureDir(p: string) {
  await fsp.mkdir(p, { recursive: true });
}

async function makeSymlink(src: string, dst: string, dryRun: boolean) {
  const dstDir = path.dirname(dst);
  await ensureDir(dstDir);
  const relTarget = path.relative(dstDir, src);
  try {
    const st = await fsp.lstat(dst).catch(() => null);
    if (st) {
      if (st.isSymbolicLink()) {
        const cur = await fsp.readlink(dst).catch(() => "");
        const resolved = path.resolve(dstDir, cur);
        if (resolved === src) return; // already correct
        await fsp.unlink(dst);
      } else {
        // Exists as file/dir; leave it
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

async function walkDir(root: string, acc: string[], limit: number) {
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    let isDir = ent.isDirectory();
    let isFil = ent.isFile();
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

export async function organizeOnce(opts?: { dryRun?: boolean; limit?: number }) {
  const dryRun = !!opts?.dryRun;
  const limit = opts?.limit ?? 10000;
  const providerBases = [path.join(config.mountBase, "realdebrid"), path.join(config.mountBase, "torbox")];
  const roots: string[] = [];
  for (const b of providerBases) {
    try {
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
    } catch (_) { /* ignore */ }
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
        // Size-based fallback: large standalone video, no TV context -> treat as movie
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

let organizerTimer: NodeJS.Timeout | null = null;
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
