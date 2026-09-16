/**
 * Structured, provider-agnostic media identity parsing.
 *
 * This module identifies media identity only. It does not classify provider
 * views, select a release, or apply Arr quality preferences.
 */

import path from "path";

export type MediaParseStatus = "matched" | "ambiguous" | "unmatched";
export type ParsedMediaKind = "movie" | "episode" | "anime-episode";

export interface ParsedMediaIdentity {
  status: MediaParseStatus;
  kind?: ParsedMediaKind;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  absoluteEpisode?: number;
  extension: string;
  sourceBasename: string;
  confidence: number;
  reason: string;
}

export interface MediaCandidate {
  id: string | number;
  title: string;
  kind: "movie" | "show";
  year?: number;
}

export interface ScoredMediaCandidate extends MediaCandidate {
  score: number;
}

export interface MediaCandidateSelection {
  status: MediaParseStatus;
  candidate?: ScoredMediaCandidate;
  confidence: number;
  reason: string;
}

const RELEASE_TOKENS = /\b(?:480p|576p|720p|1080p|1440p|2160p|4k|8k|web[- .]?dl|web[- .]?rip|bluray|bdrip|bdremux|remux|hdtv|dvdrip|x264|x265|h264|h265|hevc|av1|hdr10?\+?|dv|dolby(?:\s+vision)?|uhd|proper|repack|extended|remastered|multi|dual|ita|eng|italian|english|aac|ac3|eac3|ddp|dts|truehd|atmos|subs?)\b.*$/i;

function cleanTitle(value: string): string {
  return value
    .replace(/[._]+/g, " ")
    .replace(/[\[\{][^\]\}]*[\]\}]/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\-–—]+\s*$/, "")
    .trim();
}

export function normalizeMediaTitle(value: string): string {
  return cleanTitle(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const year = Number(value);
  return year >= 1800 && year <= 2199 ? year : undefined;
}

function titleFromParent(sourcePath: string): string | undefined {
  const parents = sourcePath.split(/[\\/]/).slice(0, -1).reverse();
  for (const parent of parents) {
    if (!parent || /^(?:season\s*\d+|s\d{1,2}|episodes?|__all__|movies?|shows?|anime)$/i.test(parent)) continue;
    const title = cleanTitle(parent.replace(/\b(?:19|20|21)\d{2}\b/, " "));
    if (title.length > 1) return title;
  }
  return undefined;
}

function baseWithoutExtension(filename: string): { base: string; extension: string } {
  const extension = path.extname(filename);
  return { extension, base: extension ? filename.slice(0, -extension.length) : filename };
}

function result(
  sourceBasename: string,
  extension: string,
  values: Omit<ParsedMediaIdentity, "sourceBasename" | "extension">,
): ParsedMediaIdentity {
  return { sourceBasename, extension, ...values };
}

/** Parse a release filename and optional relative path into media identity. */
export function parseMediaFilename(filename: string, relativePath = filename): ParsedMediaIdentity {
  const sourceBasename = path.basename(filename);
  const { base, extension } = baseWithoutExtension(sourceBasename);
  const normalized = base.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const parentTitle = titleFromParent(relativePath);

  const parenthesizedMovie = base.match(/^(.*?)\s*\(((?:19|20|21)\d{2})\)\s*$/);
  if (parenthesizedMovie) {
    const title = cleanTitle(parenthesizedMovie[1]);
    if (title) {
      return result(sourceBasename, extension, {
        status: "matched",
        kind: "movie",
        title,
        year: Number(parenthesizedMovie[2]),
        confidence: 0.98,
        reason: "parenthesized movie year",
      });
    }
  }

  // Standard season/episode notation, including multi-episode releases.
  const seasonEpisode = normalized.match(/^(.*?)(?:\s+|-)?S(\d{1,2})E(\d{1,3})(?:(?:-?E?|[ .-])?(\d{1,3}))?\b/i);
  if (seasonEpisode) {
    const title = cleanTitle(seasonEpisode[1]);
    const yearMatch = title.match(/\b((?:19|20|21)\d{2})\b/);
    const year = parseYear(yearMatch?.[1]);
    const cleanedTitle = cleanTitle(title.replace(/\b((?:19|20|21)\d{2})\b/, " ")) || parentTitle;
    if (cleanedTitle) {
      return result(sourceBasename, extension, {
        status: "matched",
        kind: "episode",
        title: cleanedTitle,
        year,
        season: Number(seasonEpisode[2]),
        episode: Number(seasonEpisode[3]),
        episodeEnd: seasonEpisode[4] ? Number(seasonEpisode[4]) : undefined,
        confidence: 0.98,
        reason: "season-episode token",
      });
    }
    if (parentTitle) {
      return result(sourceBasename, extension, {
        status: "matched",
        kind: "episode",
        title: parentTitle,
        season: Number(seasonEpisode[2]),
        episode: Number(seasonEpisode[3]),
        episodeEnd: seasonEpisode[4] ? Number(seasonEpisode[4]) : undefined,
        confidence: 0.88,
        reason: "season-episode token with parent title",
      });
    }
  }

  const altEpisode = normalized.match(/^(.*?)(?:\s+|-)?(\d{1,2})x(\d{1,3})(?:-?(\d{1,3}))?\b/i);
  if (altEpisode) {
    const title = cleanTitle(altEpisode[1]) || parentTitle;
    if (title) {
      return result(sourceBasename, extension, {
        status: "matched",
        kind: "episode",
        title,
        season: Number(altEpisode[2]),
        episode: Number(altEpisode[3]),
        episodeEnd: altEpisode[4] ? Number(altEpisode[4]) : undefined,
        confidence: 0.96,
        reason: "x episode token",
      });
    }
  }

  const absolute = normalized.match(/^(.*?)(?:\s+-\s+)(\d{3,4})(?:\s|$)/);
  const animeContext = /(?:^|[\\/])anime(?:[\\/]|$)/i.test(relativePath);
  if (absolute && (animeContext || / - /.test(normalized)) && Number(absolute[2]) >= 1 && Number(absolute[2]) <= 9999) {
    const title = cleanTitle(absolute[1]) || parentTitle;
    if (title) {
      return result(sourceBasename, extension, {
        status: "matched",
        kind: "anime-episode",
        title,
        absoluteEpisode: Number(absolute[2]),
        confidence: 0.86,
        reason: "absolute episode token",
      });
    }
  }

  const yearMatch = normalized.match(/(?:^|\s)((?:19|20|21)\d{2})(?:\s|$)/);
  const year = parseYear(yearMatch?.[1]);
  const titlePart = yearMatch ? normalized.slice(0, yearMatch.index).trim() : normalized;
  const title = cleanTitle(titlePart.replace(RELEASE_TOKENS, " ")) || parentTitle;
  if (title && year) {
    return result(sourceBasename, extension, {
      status: "matched",
      kind: "movie",
      title,
      year,
      confidence: year ? 0.9 : 0.66,
      reason: year ? "movie year token" : "release title heuristic",
    });
  }

  if (parentTitle && /(?:^|[\\/])(?:season\s*\d+|s\d{1,2})(?:[\\/]|$)/i.test(relativePath)) {
    return result(sourceBasename, extension, {
      status: "ambiguous",
      title: parentTitle,
      confidence: 0.35,
      reason: "episode filename requires parent metadata",
    });
  }

  if (title && title.length >= 3) {
    return result(sourceBasename, extension, {
      status: "ambiguous",
      kind: "movie",
      title,
      confidence: 0.45,
      reason: "title heuristic without year",
    });
  }

  return result(sourceBasename, extension, {
    status: parentTitle ? "ambiguous" : "unmatched",
    title: parentTitle,
    confidence: parentTitle ? 0.35 : 0,
    reason: parentTitle ? "only parent directory supplied a title" : "no identity token",
  });
}

/** Deterministically score metadata candidates against a parsed identity. */
export function scoreMediaCandidates(
  parsed: Pick<ParsedMediaIdentity, "title" | "year" | "kind">,
  candidates: MediaCandidate[],
): ScoredMediaCandidate[] {
  const title = normalizeMediaTitle(parsed.title || "");
  const expectedKind = parsed.kind === "movie" ? "movie" : "show";
  return candidates
    .map((candidate) => {
      const candidateTitle = normalizeMediaTitle(candidate.title);
      let score = candidate.kind === expectedKind ? 0.35 : 0;
      if (candidateTitle === title) score += 0.55;
      else if (title && (candidateTitle.includes(title) || title.includes(candidateTitle))) score += 0.3;
      if (parsed.year && candidate.year) {
        score += parsed.year === candidate.year ? 0.1 : -0.15;
      }
      return { ...candidate, score: Math.max(0, Math.min(1, score)) };
    })
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

/** Select a candidate only when its score and lead over the runner-up are reliable. */
export function selectMediaCandidate(
  parsed: Pick<ParsedMediaIdentity, "title" | "year" | "kind">,
  candidates: MediaCandidate[],
  minimumScore = 0.65,
  minimumLead = 0.05,
): MediaCandidateSelection {
  const ranked = scoreMediaCandidates(parsed, candidates);
  const best = ranked[0];
  if (!best || best.score < minimumScore) {
    return { status: "unmatched", confidence: best?.score || 0, reason: "no candidate reached score threshold" };
  }
  const runnerUp = ranked[1];
  if (runnerUp && best.score - runnerUp.score < minimumLead) {
    return { status: "ambiguous", confidence: best.score, reason: "top candidates are too close" };
  }
  return { status: "matched", candidate: best, confidence: best.score, reason: "highest deterministic candidate score" };
}
