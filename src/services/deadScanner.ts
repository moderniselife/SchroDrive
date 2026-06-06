import { config } from "../core/config";
import { searchIndexer, pickBestResult, getMagnet, getMagnetOrResolve } from "../indexers/index";
import { registry, type TorrentInfo } from "../providers";
import { getActiveBridges } from "./mount";
import { isAnyMediaServerStreaming } from "../integrations/plex";
import { addToBlacklist, isBlacklisted, loadBlacklist } from "../core/blacklist";
import type { DeadTorrentInfo } from "./webdavBridge";

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
 * Attempts to re-add a dead torrent by searching the indexer and
 * adding the magnet to all OTHER providers (not the one it died on).
 *
 * Checks the blacklist before adding to prevent re-adding known bad torrents.
 */
async function tryReaddViaIndexer(title: string, excludeProvider?: string): Promise<boolean> {
  const results = await searchIndexer(title);

  // Filter out blacklisted results before picking
  const filteredResults = results.filter((r: any) => {
    const resultTitle = r?.title || r?.name || '';
    return !isBlacklisted(resultTitle);
  });

  if (filteredResults.length === 0) {
    console.warn(`[${new Date().toISOString()}][dead-scan] all results blacklisted for`, { title });
    return false;
  }

  const best = pickBestResult(filteredResults);
  let magnet = getMagnet(best);
  if (!magnet) {
    try { magnet = await getMagnetOrResolve(best); } catch {}
  }
  if (!magnet) {
    console.warn(`[${new Date().toISOString()}][dead-scan] no magnet for`, { title });
    return false;
  }

  // Try to add to any configured provider except the one it failed on
  const providers = registry.ordered().filter(p => p.id !== excludeProvider);
  for (const p of providers) {
    try {
      await p.addMagnet(magnet, title);
      console.log(`[${new Date().toISOString()}][dead-scan] re-added to ${p.displayName}`, { title });
      return true;
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][dead-scan] ${p.id} add failed`, { title, err: e?.message || String(e) });
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
        try {
          await provider.deleteTorrent(t.id);
          console.log(`[${new Date().toISOString()}][dead-scan] deleted dead torrent from ${provider.id}`, { title, id: t.id });
        } catch (e: any) {
          console.warn(`[${new Date().toISOString()}][dead-scan] failed to delete ${t.id} from ${provider.id}`, { err: e?.message });
        }

        if (!crossRepaired) {
          // Blacklist and search for replacement
          addToBlacklist(title, `Dead torrent (status: ${t.status})`, provider.id);
          const ok = await tryReaddViaIndexer(title, provider.id);
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

      // 2. Blacklist the name
      addToBlacklist(
        info.name,
        `Bridge-detected dead (${info.failureCount} consecutive download failures)`,
        providerName,
      );

      // 3. Clear the dead flag from the bridge
      bridge.clearDeadTorrent(torrentId);

      // 4. Search for a replacement (add to ALL providers including the original)
      try {
        const ok = await tryReaddViaIndexer(info.name);
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
      if (isStreaming) {
        console.log(`[${new Date().toISOString()}][dead-scan] Active media stream detected. Skipping scan to avoid debrid rate limits.`);
        return;
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
