import { config } from "../core/config";
import { searchIndexer, pickBestResult, getMagnet, getMagnetOrResolve } from "../indexers/index";
import { registry, type TorrentInfo } from "../providers";

/**
 * Extracts a meaningful title from a torrent object.
 */
function torrentTitleLike(t: TorrentInfo): string {
  return t?.name || t?.filename || '';
}

/**
 * Attempts to re-add a dead torrent by searching the indexer and
 * adding the magnet to all OTHER providers (not the one it died on).
 */
async function tryReaddViaIndexer(title: string, excludeProvider?: string): Promise<boolean> {
  const results = await searchIndexer(title);
  const best = pickBestResult(results);
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

export async function scanDeadOnce() {
  const summary: Record<string, any> = { scanned: {}, readded: [] };

  for (const provider of registry.configured()) {
    try {
      const list = await provider.listTorrents();
      const dead = list.filter(t => provider.isTorrentDead(t));
      console.log(`[${new Date().toISOString()}][dead-scan] ${provider.displayName}`, { total: list.length, dead: dead.length });
      summary.scanned[provider.id] = { total: list.length, dead: dead.length };

      for (const t of dead) {
        const title = torrentTitleLike(t);
        const ok = await tryReaddViaIndexer(title, provider.id);
        if (ok) summary.readded.push({ from: provider.id, title });
      }
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][dead-scan] ${provider.id} scan failed`, { err: e?.message || String(e) });
    }
  }

  return summary;
}

export function startDeadScanner() {
  const intervalMs = Math.max(60, config.deadScanIntervalSeconds || 600) * 1000;
  console.log(`[${new Date().toISOString()}][dead-scan] starting`, { everySeconds: Math.round(intervalMs / 1000) });
  const run = async () => {
    try {
      await scanDeadOnce();
    } catch (e: any) {
      console.error(`[${new Date().toISOString()}][dead-scan] error`, e?.message || String(e));
    }
  };
  run();
  setInterval(run, intervalMs);
}
