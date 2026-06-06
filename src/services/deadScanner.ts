import { config } from "../core/config";
import { searchIndexer, pickBestResult, getMagnet, getMagnetOrResolve } from "../indexers/index";
import { registry, type TorrentInfo } from "../providers";
import { getActiveBridges } from "./mount";
import { isAnyMediaServerStreaming } from "../integrations/plex";
import { addToBlacklist, isBlacklisted, loadBlacklist } from "../core/blacklist";
import type { DeadTorrentInfo } from "./webdavBridge";

// ===========================================================================
// Title Cleaning — extract searchable terms from torrent names
// ===========================================================================

/**
 * Strips scene tags, resolution, codec info, and infohashes from torrent names
 * to extract a meaningful search query.
 *
 * Examples:
 *   "The.Big.Bang.Theory.S01.720p.AMZN.WEBRip.x264-GalaxyTV" → "The Big Bang Theory S01"
 *   "5990e29607c45d2027fb614bc621218b1ae706c6" → "" (pure hash — needs fallback)
 *   "Arrested.Development.S05.1080p.NF.WEB.DD5.1.x264-NTb[rartv]" → "Arrested Development S05"
 */
function cleanTorrentTitle(raw: string): string {
  // If it looks like a bare infohash (40 hex chars), it's unsearchable
  if (/^[a-f0-9]{40}$/i.test(raw.trim())) return '';

  let title = raw;

  // Replace dots and underscores with spaces
  title = title.replace(/[._]/g, ' ');

  // Remove content in square brackets (scene tags like [rartv], [EZTVx.to])
  title = title.replace(/\[[^\]]*\]/g, '');

  // Remove content in parentheses (group tags)
  title = title.replace(/\([^)]*\)/g, '');

  // Remove everything after resolution/codec markers
  // Keep the season/episode pattern (S01, S01E01) but strip quality info
  title = title.replace(
    /\s+(2160p|1080p|720p|480p|4K|UHD|HEVC|x265|x264|AVC|AAC|DTS|DD5|DDP5|WEB|WEBRip|WEB-DL|BluRay|BDRip|HDTV|REMUX|NF|AMZN|DSNP|HMAX|ATVP)\b.*/i,
    ''
  );

  // Remove release group suffix (-GroupName)
  title = title.replace(/\s*-\s*[A-Za-z0-9]+\s*$/, '');

  // Collapse multiple spaces and trim
  title = title.replace(/\s+/g, ' ').trim();

  return title;
}

/**
 * SchroDrive — Dead Torrent Scanner
 *
 * Two-phase scanner that detects and replaces dead torrents:
 *
 * 1. **Provider scan** — Checks each provider's torrent list for dead
 *    status (error/failed/stalled). These are torrents that never completed.
 *
 * 2. **Bridge scan** — Checks WebDAV bridges for torrents flagged as dead
 *    due to persistent download failures (423 Locked, timeouts, etc.).
 *    These are torrents that *were* completed but can no longer be accessed.
 *
 * Dead torrents are deleted from the provider, blacklisted (to prevent
 * re-adding the same broken torrent), and a replacement search is queued.
 *
 * @module deadScanner
 */

// ===========================================================================
// Helpers
// ===========================================================================

/**
 * Extracts a meaningful title from a torrent object.
 */
function torrentTitleLike(t: TorrentInfo): string {
  return t?.name || t?.filename || '';
}

/**
 * Extracts the infohash from a magnet URI.
 * `magnet:?xt=urn:btih:HASH&dn=...` → `hash` (lowercase)
 */
function extractHashFromMagnet(magnet: string): string | null {
  const match = magnet.match(/btih:([a-f0-9]{40}|[a-z2-7]{32,})/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extracts the infohash from a Prowlarr/Jackett result object.
 * Checks the result's hash fields AND any embedded magnet URLs.
 */
function extractHashFromResult(r: any): string | null {
  // Direct hash fields
  const directHash = (r?.infoHash || r?.infohash || r?.hash || '').toString().trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(directHash)) return directHash;

  // From embedded magnet URL
  const magnetUrl = r?.magnetUrl || r?.guid || r?.link || '';
  if (typeof magnetUrl === 'string' && magnetUrl.startsWith('magnet:')) {
    return extractHashFromMagnet(magnetUrl);
  }

  return null;
}

/**
 * Attempts to re-add a dead torrent by searching the indexer and
 * adding the magnet to all configured providers.
 *
 * Ensures we don't re-add the same broken torrent by:
 * 1. Blacklist check (name-based, bidirectional substring match)
 * 2. Infohash exclusion (exact match against the dead torrent's hash)
 *
 * @param rawTitle - Original torrent name (will be cleaned for search).
 * @param excludeProvider - Provider to skip when adding (optional).
 * @param excludeHashes - Set of infohashes to exclude from results.
 */
async function tryReaddViaIndexer(
  rawTitle: string,
  excludeProvider?: string,
  excludeHashes?: Set<string>,
): Promise<boolean> {
  // Clean the torrent name into a searchable query
  const searchTitle = cleanTorrentTitle(rawTitle);
  if (!searchTitle) {
    console.warn(`[${new Date().toISOString()}][dead-scan] unsearchable title (raw hash or garbage)`, { rawTitle });
    return false;
  }

  console.log(`[${new Date().toISOString()}][dead-scan] searching for replacement: "${searchTitle}" (from: "${rawTitle}", excluding ${excludeHashes?.size || 0} hash(es))`);
  const results = await searchIndexer(searchTitle);

  // Filter out blacklisted results AND results with excluded hashes
  const filteredResults = results.filter((r: any) => {
    const resultTitle = r?.title || r?.name || '';

    // Check blacklist (name-based)
    if (isBlacklisted(resultTitle)) return false;

    // Check infohash exclusion (exact match)
    if (excludeHashes && excludeHashes.size > 0) {
      const resultHash = extractHashFromResult(r);
      if (resultHash && excludeHashes.has(resultHash)) {
        console.log(`[${new Date().toISOString()}][dead-scan] skipping result with matching hash: ${resultTitle} (${resultHash})`);
        return false;
      }
    }

    return true;
  });

  if (filteredResults.length === 0) {
    console.warn(`[${new Date().toISOString()}][dead-scan] no viable results for "${searchTitle}" (${results.length} total, all blacklisted or hash-excluded)`);
    return false;
  }

  const best = pickBestResult(filteredResults);
  let magnet = getMagnet(best);
  if (!magnet) {
    try { magnet = await getMagnetOrResolve(best); } catch {}
  }
  if (!magnet) {
    console.warn(`[${new Date().toISOString()}][dead-scan] no magnet for`, { searchTitle });
    return false;
  }

  // Double-check: ensure the chosen result's hash doesn't match an excluded hash
  const chosenHash = extractHashFromMagnet(magnet);
  if (chosenHash && excludeHashes?.has(chosenHash)) {
    console.warn(`[${new Date().toISOString()}][dead-scan] chosen result's magnet hash matches excluded hash — skipping`, { searchTitle, hash: chosenHash });
    return false;
  }

  // Try to add to any configured provider except the one it failed on
  const providers = registry.ordered().filter(p => p.id !== excludeProvider);
  for (const p of providers) {
    try {
      await p.addMagnet(magnet, searchTitle);
      console.log(`[${new Date().toISOString()}][dead-scan] re-added to ${p.displayName}`, { searchTitle, hash: chosenHash });
      return true;
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][dead-scan] ${p.id} add failed`, { searchTitle, err: e?.message || String(e) });
    }
  }
  return false;
}

// ===========================================================================
// Phase 1: Provider-based Dead Scan (status = error/failed/stalled)
// ===========================================================================

/**
 * Scans all providers for torrents with dead status and attempts
 * a 3-phase recovery process (repair → cross-provider → replace).
 *
 * This is SchröDrive's 1-up on Zurg's `enable_repair`:
 * - Phase A: Repair on same provider (re-add same magnet)
 * - Phase B: Cross-provider repair (try adding to a different provider)
 * - Phase C: Delete, blacklist, and search for replacement (existing flow)
 *
 * Pre-emptive repair: Also detects stalling torrents (stuck progress
 * for longer than the configured stall threshold) and attempts repair
 * BEFORE they're flagged as dead.
 */
async function scanProviderDead(): Promise<Record<string, any>> {
  const summary: Record<string, any> = { scanned: {}, repaired: [], crossRepaired: [], readded: [], preemptive: [] };

  for (const provider of registry.configured()) {
    try {
      const list = await provider.listTorrents();
      const dead = list.filter(t => provider.isTorrentDead(t));

      // Pre-emptive repair: detect stalling torrents (not dead yet, but stuck)
      const stalling = config.preemptiveRepairEnabled
        ? list.filter(t => {
            if (provider.isTorrentDead(t)) return false;           // Already dead, handled separately
            if (t.progress >= 100) return false;                   // Completed, not stalling
            if (t.progress <= 0) return false;                     // Not started yet, normal
            // Check if added long ago but still not finished (stalling)
            if (t.addedAt) {
              const ageMin = (Date.now() - t.addedAt.getTime()) / 60000;
              return ageMin >= config.preemptiveRepairStallMinutes;
            }
            return false;
          })
        : [];

      console.log(`[${new Date().toISOString()}][dead-scan] ${provider.displayName}`, {
        total: list.length,
        dead: dead.length,
        stalling: stalling.length,
      });
      summary.scanned[provider.id] = { total: list.length, dead: dead.length, stalling: stalling.length };

      // Pre-emptive repair for stalling torrents
      for (const t of stalling) {
        const title = torrentTitleLike(t);
        if (provider.repairTorrent) {
          try {
            const repaired = await provider.repairTorrent(t.id);
            if (repaired) {
              summary.preemptive.push({ provider: provider.id, title });
              console.log(`[${new Date().toISOString()}][dead-scan] pre-emptive repair succeeded`, { provider: provider.id, title });
              continue;
            }
          } catch (e: any) {
            console.warn(`[${new Date().toISOString()}][dead-scan] pre-emptive repair failed`, { provider: provider.id, title, err: e?.message });
          }
        }
      }

      // Process dead torrents with 3-phase recovery
      for (const t of dead) {
        const title = torrentTitleLike(t);

        // Phase A: Try repair on the same provider (like Zurg's enable_repair)
        if (config.enableRepair && provider.repairTorrent) {
          let repairAttempts = 0;
          let repaired = false;

          while (repairAttempts < config.repairMaxAttempts && !repaired) {
            repairAttempts++;
            try {
              repaired = await provider.repairTorrent(t.id);
            } catch (e: any) {
              console.warn(`[${new Date().toISOString()}][dead-scan] repair attempt ${repairAttempts} failed`, {
                provider: provider.id, title, err: e?.message,
              });
            }
          }

          if (repaired) {
            summary.repaired.push({ provider: provider.id, title, attempts: repairAttempts });
            console.log(`[${new Date().toISOString()}][dead-scan] repaired on same provider`, {
              provider: provider.id, title, attempts: repairAttempts,
            });
            continue; // Skip delete/blacklist/replace — torrent is alive again
          }
        }

        // Phase B: Cross-provider repair — try adding the magnet to OTHER providers
        // This is unique to SchröDrive and goes beyond what Zurg can do
        let crossRepaired = false;
        if (config.enableRepair) {
          let infoHash: string | null = null;
          if (provider.getInfoHash) {
            try { infoHash = await provider.getInfoHash(t.id); } catch {}
          }

          if (infoHash) {
            const magnet = `magnet:?xt=urn:btih:${infoHash.toUpperCase()}`;
            const otherProviders = registry.configured().filter(p => p.id !== provider.id);

            for (const other of otherProviders) {
              try {
                await other.addMagnet(magnet, title);
                crossRepaired = true;
                summary.crossRepaired.push({ from: provider.id, to: other.id, title });
                console.log(`[${new Date().toISOString()}][dead-scan] cross-provider repair: ${provider.id} → ${other.id}`, { title });
                break;
              } catch (e: any) {
                console.warn(`[${new Date().toISOString()}][dead-scan] cross-provider add to ${other.id} failed`, { title, err: e?.message });
              }
            }
          }
        }

        // Phase C: Delete, blacklist, and search for replacement
        // (only if repair and cross-repair both failed)

        // Extract infohash BEFORE deletion so we can exclude it from replacement search
        const excludeHashes = new Set<string>();
        if (provider.getInfoHash) {
          try {
            const hash = await provider.getInfoHash(t.id);
            if (hash) excludeHashes.add(hash.toLowerCase());
          } catch {}
        }

        try {
          await provider.deleteTorrent(t.id);
          console.log(`[${new Date().toISOString()}][dead-scan] deleted dead torrent from ${provider.id}`, { title, id: t.id });
        } catch (e: any) {
          console.warn(`[${new Date().toISOString()}][dead-scan] failed to delete ${t.id} from ${provider.id}`, { err: e?.message });
        }

        if (!crossRepaired) {
          // Blacklist and search for replacement (excluding the dead hash)
          addToBlacklist(title, `Dead torrent (status: ${t.status})`, provider.id);
          const ok = await tryReaddViaIndexer(title, provider.id, excludeHashes);
          if (ok) summary.readded.push({ from: provider.id, title });
        }
      }
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][dead-scan] ${provider.id} scan failed`, { err: e?.message || String(e) });
    }
  }

  return summary;
}

// ===========================================================================
// Phase 2: Bridge-detected Dead Torrents (persistent download failures)
// ===========================================================================

/**
 * Processes torrents flagged as dead by the WebDAV bridge due to
 * persistent download failures (423 Locked, timeouts, etc.).
 *
 * For each dead torrent:
 * 1. Deletes it from the provider
 * 2. Blacklists the name
 * 3. Clears the dead flag from the bridge
 * 4. Searches for a replacement
 */
async function scanBridgeDead(): Promise<Record<string, any>> {
  const summary: Record<string, any> = { processed: 0, deleted: 0, replaced: 0 };
  const bridges = getActiveBridges();

  for (const [providerName, bridge] of bridges) {
    const deadTorrents = bridge.getDeadTorrents();

    if (deadTorrents.size === 0) continue;

    console.log(`[${new Date().toISOString()}][dead-scan] bridge ${providerName} has ${deadTorrents.size} dead torrent(s)`);

    const provider = registry.get(providerName);
    if (!provider) {
      console.warn(`[${new Date().toISOString()}][dead-scan] no provider registered for ${providerName}`);
      continue;
    }

    for (const [torrentId, info] of deadTorrents) {
      summary.processed++;

      console.log(`[${new Date().toISOString()}][dead-scan] processing bridge-dead torrent`, {
        provider: providerName,
        name: info.name,
        id: torrentId,
        failures: info.failureCount,
      });

      // 0. Extract infohash BEFORE deletion so we can exclude it from replacement
      const excludeHashes = new Set<string>();
      // The torrent ID itself might be the infohash (e.g. TorBox uses raw hashes)
      if (/^[a-f0-9]{40}$/i.test(torrentId)) {
        excludeHashes.add(torrentId.toLowerCase());
      }
      // Also try the provider API
      if (provider.getInfoHash) {
        try {
          const hash = await provider.getInfoHash(torrentId);
          if (hash) excludeHashes.add(hash.toLowerCase());
        } catch {}
      }

      // 1. Delete from provider
      try {
        await provider.deleteTorrent(torrentId);
        summary.deleted++;
        console.log(`[${new Date().toISOString()}][dead-scan] deleted bridge-dead torrent from ${providerName}`, {
          name: info.name,
          id: torrentId,
        });
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][dead-scan] failed to delete bridge-dead ${torrentId} from ${providerName}`, {
          err: e?.message,
        });
      }

      // 2. Blacklist the name AND hash
      addToBlacklist(
        info.name,
        `Bridge-detected dead (${info.failureCount} consecutive download failures)`,
        providerName,
      );
      // Also blacklist the hash itself if we have one
      for (const h of excludeHashes) {
        addToBlacklist(h, `Bridge-detected dead hash (from ${info.name})`, providerName);
      }

      // 3. Clear the dead flag from the bridge
      bridge.clearDeadTorrent(torrentId);

      // 4. Search for a replacement (excluding the dead hash)
      try {
        const ok = await tryReaddViaIndexer(info.name, undefined, excludeHashes);
        if (ok) {
          summary.replaced++;
          console.log(`[${new Date().toISOString()}][dead-scan] replacement found for bridge-dead torrent`, { name: info.name });
        } else {
          console.warn(`[${new Date().toISOString()}][dead-scan] no replacement found for bridge-dead torrent`, { name: info.name });
        }
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][dead-scan] replacement search failed for bridge-dead torrent`, {
          name: info.name,
          err: e?.message,
        });
      }
    }
  }

  return summary;
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Runs a complete dead torrent scan — both provider-status and bridge-detected.
 */
export async function scanDeadOnce() {
  const providerSummary = await scanProviderDead();
  const bridgeSummary = await scanBridgeDead();

  return {
    provider: providerSummary,
    bridge: bridgeSummary,
  };
}

/**
 * Starts the dead torrent scanner on a recurring interval.
 * Also loads the blacklist from disk on startup.
 */
export function startDeadScanner() {
  // Load the blacklist from disk
  loadBlacklist();

  const intervalMs = Math.max(60, config.deadScanIntervalSeconds || 600) * 1000;
  console.log(`[${new Date().toISOString()}][dead-scan] starting`, { everySeconds: Math.round(intervalMs / 1000) });
  const run = async () => {
    try {
      const isStreaming = await isAnyMediaServerStreaming();
      const bridgeEntries = [...getActiveBridges().entries()];
      const hasBridgeDead = bridgeEntries.some(([, bridge]) => bridge.getDeadTorrents().size > 0);

      if (isStreaming && !hasBridgeDead) {
        // Only skip if streaming AND there are no bridge-dead torrents.
        // If there ARE bridge-dead torrents, we MUST run — otherwise the dead
        // file causes Plex to "stream" the error video, which blocks this scanner,
        // which never replaces the dead torrent. Deadlock!
        console.log(`[${new Date().toISOString()}][dead-scan] Active media stream detected and no bridge-dead torrents. Skipping scan.`);
        return;
      } else if (isStreaming && hasBridgeDead) {
        console.log(`[${new Date().toISOString()}][dead-scan] Active stream detected BUT bridge has dead torrents — running scan to break deadlock`);
      }

      const configuredProviders = registry.configured();
      const allRateLimited = configuredProviders.every(p => p.isRateLimited());
      if (allRateLimited && configuredProviders.length > 0) {
        console.warn(`[${new Date().toISOString()}][dead-scan] All debrid providers are rate-limited. Skipping scan to avoid API spam.`);
        return;
      }

      await scanDeadOnce();
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][dead-scan] error`, e?.message || String(e));
    }
  };
  run();
  setInterval(run, intervalMs);
}
