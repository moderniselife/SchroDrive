/**
 * SchroDrive — Media Classifier
 *
 * Classifies torrents into categories (anime, shows, movies) using
 * filename pattern matching. Replicates the classification approach
 * from Zurg's config.yml `directories:` section.
 *
 * Classification priority (lower = higher priority, matching Zurg's group_order):
 * 1. **Anime (priority 10)** — detected via CRC hash patterns common in
 *    fansub releases (e.g. `[SubGroup] Title - 01 [1080p][ABCD1234].mkv`)
 * 2. **Shows (priority 20)** — detected via episode numbering patterns
 *    (S01E01, Season 01, 1x01, etc.)
 * 3. **Movies (priority 30)** — catch-all for everything not matched above
 *
 * The classification is purely virtual — no files are moved or copied.
 * The WebDAV bridge uses this to present different filtered views.
 *
 * @module mediaClassifier
 */

// ===========================================================================
// Types
// ===========================================================================

/** Media categories matching Zurg's default directory names. */
export type MediaCategory = 'anime' | 'shows' | 'movies';

/** All valid categories including the special __all__ view. */
export type MediaView = MediaCategory | '__all__';

/** A classification filter rule. */
interface ClassificationFilter {
  /** The type of filter to apply. */
  type: 'regex' | 'has_episodes' | 'any_file_inside_regex';
  /** Regex pattern for 'regex' and 'any_file_inside_regex' types. */
  pattern?: RegExp;
}

/** A classification rule with priority ordering. */
interface ClassificationRule {
  /** The category to assign if this rule matches. */
  category: MediaCategory;
  /** Priority order — lower number = checked first (matches Zurg's group_order). */
  priority: number;
  /**
   * Filter conditions — if ANY filter matches, the rule matches.
   * This matches Zurg's behaviour where filters within a directory are OR'd.
   */
  filters: ClassificationFilter[];
}

// ===========================================================================
// Classification Rules (matching Zurg's config.yml defaults)
// ===========================================================================

/**
 * Default classification rules matching Zurg's config.yml:
 *
 * ```yaml
 * directories:
 *   anime:
 *     group_order: 10
 *     filters:
 *       - regex: /\b[a-fA-F0-9]{8}\b/
 *       - any_file_inside_regex: /\b[a-fA-F0-9]{8}\b/
 *   shows:
 *     group_order: 20
 *     filters:
 *       - has_episodes: true
 *   movies:
 *     group_order: 30
 *     filters:
 *       - regex: /.* /
 * ```
 */
const DEFAULT_RULES: ClassificationRule[] = [
  {
    category: 'anime',
    priority: 10,
    filters: [
      // CRC hash pattern common in anime fansub releases
      // e.g. [SubGroup] Anime Title - 01 [1080p][ABCD1234].mkv
      { type: 'regex', pattern: /\b[a-fA-F0-9]{8}\b/ },
      { type: 'any_file_inside_regex', pattern: /\b[a-fA-F0-9]{8}\b/ },
    ],
  },
  {
    category: 'shows',
    priority: 20,
    filters: [
      { type: 'has_episodes' },
    ],
  },
  {
    category: 'movies',
    priority: 30,
    filters: [
      // Catch-all for everything not matched above
      { type: 'regex', pattern: /.*/ },
    ],
  },
];

// ===========================================================================
// Episode Detection
// ===========================================================================

/**
 * Common episode numbering patterns found in torrent names.
 * Covers the vast majority of naming conventions:
 * - S01E01, S1E1, s01e01 (most common)
 * - Season 01, Season 1
 * - 1x01 (oldschool)
 * - E01, Ep01, Episode 01
 * - Complete Series, Seasons 1-5
 */
const EPISODE_PATTERNS: RegExp[] = [
  /S\d{1,3}E\d{1,3}/i,           // S01E01, S1E1
  /\bS\d{1,3}\b(?!ub|pecial|ample|cene|creens|eries)/i, // S01, S1 (season pack — excludes Sub, Special, Sample, etc.)
  /S\d{1,3}\s*[-–]\s*S\d{1,3}/i, // S01-S03 (multi-season packs)
  /\bSeason[\s.]*\d+/i,           // Season 01, Season.1, Season1
  /\bSeasons?\s*\d+\s*[-–&]\s*\d+/i, // Seasons 1-5, Season 1 & 2
  /\bSeasons?\s*\d+\s+(?:to|and|&)\s*\d+/i, // Seasons 1 to 5, Seasons 6 and 7
  /\b\d{1,2}x\d{2,3}\b/i,         // 1x01, 12x05
  /\bE(?:p|pisode)?\s*\d+/i,      // E01, Ep01, Episode 01
  /Complete\s*(?:Series|Season)/i, // Complete Series, Complete Season
  /Season\s*\d+\s*Complete/i,      // Season 1 Complete
  /\bMini[- ]?Series\b/i,         // Mini-Series, Miniseries
  /\bTVShows?\b/i,                 // TVShows, TVShow
  /\bSeason\s*Pack\b/i,            // Season Pack
  /\bS\d{1,3}[.-]S\d{1,3}\b/i,    // S01.S05 or S01-S05 (dot/dash multi-season)
];

/**
 * Checks whether a torrent name contains episode numbering patterns,
 * indicating it's a TV show rather than a movie.
 *
 * @param name - The torrent name to check.
 * @returns `true` if episode patterns are detected.
 */
function hasEpisodePattern(name: string): boolean {
  return EPISODE_PATTERNS.some((re) => re.test(name));
}

// ===========================================================================
// CRC Hash Detection (Anime)
// ===========================================================================

/**
 * Anime-specific CRC hash patterns. Fansub groups commonly embed an 8-char
 * hex CRC32 checksum in the filename, usually in square brackets:
 * - [ABCD1234]
 * - [abcd1234]
 *
 * We check for the pattern in the torrent name AND optionally in individual
 * filenames within the torrent.
 *
 * Important: We exclude common false positives like resolution strings
 * (e.g. "1920x1080" which contains "1920x108" → 8 hex chars).
 */
const CRC_HEX_PATTERN = /\b[a-fA-F0-9]{8}\b/;

/**
 * Additional heuristics for anime detection beyond CRC hashes.
 * These patterns are common in anime but rare in Western media.
 */
const ANIME_HEURISTIC_PATTERNS: RegExp[] = [
  /\[.*?(?:fansub|sub|dub|raw|bd|bluray|dvd|web).*?\]/i,  // [SubGroup]
  /\b(?:OVA|ONA|OAD|Special)\b/i,                           // OVA, ONA, etc.
  /\bNyaa\b/i,                                               // Nyaa tracker
  /\[(?:1080p|720p|480p)\]\s*\[/i,                           // [1080p][hash] style
];

/**
 * Checks whether a name looks like an anime release.
 *
 * @param name - The torrent or file name.
 * @returns `true` if the name contains anime-typical patterns.
 */
function looksLikeAnime(name: string): boolean {
  // Primary check: CRC hash in brackets
  if (/\[[a-fA-F0-9]{8}\]/i.test(name)) return true;

  // Secondary check: Bare CRC hash + anime heuristics
  if (CRC_HEX_PATTERN.test(name) && ANIME_HEURISTIC_PATTERNS.some((re) => re.test(name))) {
    return true;
  }

  return false;
}

// ===========================================================================
// Filter Matching
// ===========================================================================

/**
 * Tests whether a torrent matches a specific filter condition.
 *
 * @param torrentName - The torrent's display name.
 * @param fileNames - Optional array of filenames within the torrent.
 * @param filter - The filter condition to test.
 * @returns `true` if the filter matches.
 */
function matchesFilter(
  torrentName: string,
  fileNames: string[] | undefined,
  filter: ClassificationFilter,
): boolean {
  switch (filter.type) {
    case 'regex':
      return filter.pattern ? filter.pattern.test(torrentName) : false;

    case 'has_episodes':
      return hasEpisodePattern(torrentName);

    case 'any_file_inside_regex':
      if (!filter.pattern) return false;
      // Check the torrent name itself first
      if (filter.pattern.test(torrentName)) return true;
      // Then check individual filenames if available
      if (fileNames) {
        return fileNames.some((fn) => filter.pattern!.test(fn));
      }
      return false;

    default:
      return false;
  }
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Classifies a torrent into a media category based on its name and
 * optionally its contained filenames.
 *
 * Rules are evaluated in priority order (anime → shows → movies).
 * The first matching rule wins.
 *
 * @param torrentName - The torrent's display name.
 * @param fileNames - Optional array of filenames within the torrent.
 * @returns The classified media category.
 *
 * @example
 * ```typescript
 * classifyTorrent('[SubGroup] Naruto - 01 [1080p][ABCD1234].mkv')
 * // → 'anime'
 *
 * classifyTorrent('Breaking Bad S01E01 720p')
 * // → 'shows'
 *
 * classifyTorrent('Inception 2010 1080p BluRay')
 * // → 'movies'
 * ```
 */
export function classifyTorrent(
  torrentName: string,
  fileNames?: string[],
): MediaCategory {
  // Enhanced anime detection: use our heuristic detector first,
  // then fall back to Zurg's regex-only approach
  if (looksLikeAnime(torrentName)) return 'anime';
  if (fileNames?.some((fn) => looksLikeAnime(fn))) return 'anime';

  // Evaluate rules in priority order
  const sortedRules = [...DEFAULT_RULES].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    for (const filter of rule.filters) {
      if (matchesFilter(torrentName, fileNames, filter)) {
        return rule.category;
      }
    }
  }

  return 'movies'; // Ultimate fallback
}

/**
 * All valid media view names that can appear as WebDAV directories.
 */
export const MEDIA_VIEWS: MediaView[] = ['__all__', 'anime', 'shows', 'movies'];

/**
 * Checks whether a path segment is a valid media view name.
 *
 * @param name - The directory name to check.
 * @returns `true` if it's a valid media view (category or __all__).
 */
export function isMediaView(name: string): name is MediaView {
  return (MEDIA_VIEWS as string[]).includes(name);
}

/**
 * Filters a list of torrent entries to only include those matching
 * a specific media category.
 *
 * @param torrents - Array of torrent objects with at least a `name` property.
 * @param category - The media category to filter for.
 * @returns Filtered array containing only torrents matching the category.
 */
export function filterByCategory<T extends { name: string; files?: string[] }>(
  torrents: T[],
  category: MediaCategory,
): T[] {
  return torrents.filter((t) => classifyTorrent(t.name, t.files) === category);
}

/**
 * Returns the largest file from a list, used for the movies category's
 * "only show the biggest file" behaviour (matching Zurg's
 * `only_show_the_biggest_file: true`).
 *
 * This hides sample files, NFOs, subtitles, etc. — showing only the
 * main video file which is almost always the largest.
 *
 * @param files - Array of file objects with `name` and `size` properties.
 * @returns Array containing only the largest file, or the original array
 *          if there's only one file or no files.
 */
export function onlyBiggestFile<T extends { name: string; size: number }>(
  files: T[],
): T[] {
  if (files.length <= 1) return files;

  let biggest: T = files[0];
  for (const f of files) {
    if (f.size > biggest.size) biggest = f;
  }

  return [biggest];
}
