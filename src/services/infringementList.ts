/**
 * SchroDrive — Infringing Content Detection & Blocklist Manager
 *
 * Maintains a JSON-backed blocklist of content patterns that RealDebrid
 * and/or TorBox have rejected as infringing/DMCA'd. The list is persisted
 * to a JSON file so it works both with and without the Media Manager UI.
 *
 * Features:
 * - Automatic learning: when RD/TB rejects a torrent, the pattern is
 *   recorded with provider attribution
 * - Pre-check: before adding a torrent, the name is checked against the
 *   blocklist to avoid wasting API calls
 * - Manual management: entries can be added/removed via API
 * - JSON file storage: portable, human-readable, works standalone
 *
 * @module infringementList
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

// =============================================================================
// Types
// =============================================================================

/** Which debrid provider(s) block this content. */
export type BlockedBy = "realdebrid" | "torbox" | "both";

/** How the pattern should be matched against torrent names. */
export type MatchType = "contains" | "exact" | "regex";

/** A single entry in the infringement blocklist. */
export interface InfringementEntry {
  /** Unique identifier (UUID v4). */
  id: string;
  /** Text pattern found in torrent/file names. */
  pattern: string;
  /** How to match the pattern. */
  matchType: MatchType;
  /** Which provider(s) rejected this content. */
  blockedBy: BlockedBy;
  /** Original error/rejection message from the provider. */
  reason: string;
  /** ISO timestamp when first encountered. */
  firstSeen: string;
  /** ISO timestamp when last encountered. */
  lastSeen: string;
  /** Number of times this pattern has been encountered. */
  hitCount: number;
}

/** The full blocklist file structure. */
interface InfringementListFile {
  /** Schema version for future migrations. */
  version: 1;
  /** Last time the file was modified. */
  lastModified: string;
  /** All blocklist entries. */
  entries: InfringementEntry[];
}

// =============================================================================
// Configuration
// =============================================================================

/** Default path for the infringement list JSON file. */
const DEFAULT_LIST_PATH = join(
  process.env.CONFIG_DIR || process.env.MOUNT_BASE || "/config",
  "infringement-list.json"
);

/** Path to the infringement list file (configurable via env). */
const LIST_PATH = process.env.INFRINGEMENT_LIST_PATH || DEFAULT_LIST_PATH;

// =============================================================================
// File I/O
// =============================================================================

/**
 * Loads the infringement list from disk.
 * Returns an empty list if the file doesn't exist.
 */
function loadList(): InfringementListFile {
  try {
    if (existsSync(LIST_PATH)) {
      const raw = readFileSync(LIST_PATH, "utf-8");
      const parsed = JSON.parse(raw) as InfringementListFile;
      // Validate structure
      if (parsed.version === 1 && Array.isArray(parsed.entries)) {
        return parsed;
      }
    }
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][infringement] Failed to load list from ${LIST_PATH}:`, err?.message || String(err));
  }

  return { version: 1, lastModified: new Date().toISOString(), entries: [] };
}

/**
 * Persists the infringement list to disk.
 * Creates parent directories if they don't exist.
 */
function saveList(list: InfringementListFile): void {
  try {
    const dir = dirname(LIST_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    list.lastModified = new Date().toISOString();
    writeFileSync(LIST_PATH, JSON.stringify(list, null, 2), "utf-8");
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][infringement] Failed to save list to ${LIST_PATH}:`, err?.message || String(err));
  }
}

/** In-memory cache of the blocklist for fast lookups. */
let cachedList: InfringementListFile | null = null;

/** Gets the cached list or loads from disk. */
function getList(): InfringementListFile {
  if (!cachedList) {
    cachedList = loadList();
  }
  return cachedList;
}

/** Invalidates the cache and reloads from disk. */
export function reloadList(): void {
  cachedList = null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Generates a simple UUID v4 (no external dependency).
 */
function uuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Checks if a torrent name matches any entry in the blocklist.
 *
 * @param name - Torrent name to check
 * @param provider - Optional: only check entries blocked by this provider
 * @returns The matching entry if blocked, or null if clean
 */
export function checkBlocked(name: string, provider?: "realdebrid" | "torbox"): InfringementEntry | null {
  const list = getList();
  const nameLower = name.toLowerCase();

  for (const entry of list.entries) {
    // Filter by provider if specified
    if (provider && entry.blockedBy !== "both" && entry.blockedBy !== provider) {
      continue;
    }

    let matches = false;
    switch (entry.matchType) {
      case "exact":
        matches = nameLower === entry.pattern.toLowerCase();
        break;
      case "contains":
        matches = nameLower.includes(entry.pattern.toLowerCase());
        break;
      case "regex":
        try {
          matches = new RegExp(entry.pattern, "i").test(name);
        } catch {
          // Invalid regex — skip
        }
        break;
    }

    if (matches) {
      return entry;
    }
  }

  return null;
}

/**
 * Adds or updates a blocklist entry from a provider rejection.
 *
 * If a matching pattern already exists, its hit count and lastSeen are
 * updated. If the existing entry was for a different provider, it's
 * upgraded to "both".
 *
 * @param name - The torrent name or pattern that was rejected
 * @param provider - Which provider rejected it
 * @param reason - Error/rejection message from the provider
 * @param matchType - How to match this pattern (default: "contains")
 * @returns The created or updated entry
 */
export function addBlocked(
  name: string,
  provider: "realdebrid" | "torbox",
  reason: string,
  matchType: MatchType = "contains"
): InfringementEntry {
  const list = getList();
  const now = new Date().toISOString();

  // Check if pattern already exists
  const existing = list.entries.find(
    (e) => e.pattern.toLowerCase() === name.toLowerCase() && e.matchType === matchType
  );

  if (existing) {
    existing.hitCount++;
    existing.lastSeen = now;
    existing.reason = reason;
    // Upgrade to "both" if a different provider also blocks it
    if (existing.blockedBy !== "both" && existing.blockedBy !== provider) {
      existing.blockedBy = "both";
    }
    saveList(list);
    console.log(`[${new Date().toISOString()}][infringement] Updated: "${name}" (hits: ${existing.hitCount}, blocked by: ${existing.blockedBy})`);
    return existing;
  }

  // Create new entry
  const entry: InfringementEntry = {
    id: uuid(),
    pattern: name,
    matchType,
    blockedBy: provider,
    reason,
    firstSeen: now,
    lastSeen: now,
    hitCount: 1,
  };

  list.entries.push(entry);
  saveList(list);
  console.log(`[${new Date().toISOString()}][infringement] Added: "${name}" (blocked by: ${provider})`);
  return entry;
}

/**
 * Removes a blocklist entry by ID.
 *
 * @param id - UUID of the entry to remove
 * @returns true if the entry was found and removed
 */
export function removeBlocked(id: string): boolean {
  const list = getList();
  const idx = list.entries.findIndex((e) => e.id === id);
  if (idx === -1) return false;

  const removed = list.entries.splice(idx, 1)[0];
  saveList(list);
  console.log(`[${new Date().toISOString()}][infringement] Removed: "${removed.pattern}"`);
  return true;
}

/**
 * Gets all blocklist entries.
 *
 * @returns Array of all infringement entries
 */
export function getBlocklist(): InfringementEntry[] {
  return getList().entries;
}

/**
 * Gets the full blocklist metadata including version and last modified.
 */
export function getBlocklistInfo(): { version: number; lastModified: string; count: number } {
  const list = getList();
  return {
    version: list.version,
    lastModified: list.lastModified,
    count: list.entries.length,
  };
}

/**
 * Detects if an API error response indicates an infringement/DMCA rejection.
 *
 * Works for both RealDebrid and TorBox error responses.
 *
 * @param error - Error message or response body
 * @returns true if this looks like an infringement rejection
 */
export function isInfringementError(error: string): boolean {
  const lower = error.toLowerCase();
  const patterns = [
    "infring",
    "dmca",
    "copyright",
    "blocked",
    "not available",
    "unavailable due to",
    "removed",
    "forbidden",
    "takedown",
    "infringing",
  ];
  return patterns.some((p) => lower.includes(p));
}
