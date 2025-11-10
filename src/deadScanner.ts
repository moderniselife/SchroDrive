import { config, providersSet } from "./config";
import { searchProwlarr, pickBestResult, getMagnet, getMagnetOrResolve } from "./prowlarr";
import { addMagnetToTorbox } from "./torbox";
import { listRDTorrents, isRDTorrentDead, addMagnetToRD, selectAllFilesRD } from "./realdebrid";
import { listTorboxTorrents, isTorboxTorrentDead } from "./torbox";

function torrentTitleLike(t: any): string {
  return (
    t?.name || t?.filename || t?.title || t?.originalName || t?.displayName || ""
  );
}

async function tryReaddViaProwlarr(title: string, prefer: "torbox" | "realdebrid" | "any" = "any") {
  const results = await searchProwlarr(title);
  const best = pickBestResult(results);
  let magnet = getMagnet(best);
  if (!magnet) {
    try { magnet = await getMagnetOrResolve(best); } catch {}
  }
  if (!magnet) {
    console.warn(`[${new Date().toISOString()}][dead-scan] no magnet for`, { title });
    return false;
  }

  const pset = providersSet();
  if ((prefer === "torbox" || prefer === "any") && pset.has("torbox")) {
    try {
      await addMagnetToTorbox(magnet, title);
      console.log(`[${new Date().toISOString()}][dead-scan] re-added to TorBox`, { title });
      return true;
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][dead-scan] TorBox add failed`, { title, err: e?.message || String(e) });
    }
  }
  if ((prefer === "realdebrid" || prefer === "any") && pset.has("realdebrid")) {
    try {
      const res = await addMagnetToRD(magnet);
      if (res?.id) {
        await selectAllFilesRD(res.id);
      }
      console.log(`[${new Date().toISOString()}][dead-scan] re-added to RealDebrid`, { title });
      return true;
    } catch (e: any) {
      console.warn(`[${new Date().toISOString()}][dead-scan] RD add failed`, { title, err: e?.message || String(e) });
    }
  }
  return false;
}

export async function scanDeadOnce() {
  const pset = providersSet();
  const summary: Record<string, any> = { scanned: {}, readded: [] };

  if (pset.has("realdebrid")) {
    const list = await listRDTorrents();
    const dead = list.filter(isRDTorrentDead);
    console.log(`[${new Date().toISOString()}][dead-scan] RD`, { total: list.length, dead: dead.length });
    summary.scanned.realdebrid = { total: list.length, dead: dead.length };
    for (const t of dead) {
      const title = torrentTitleLike(t);
      const ok = await tryReaddViaProwlarr(title, "torbox");
      if (ok) summary.readded.push({ provider: "torbox", title });
    }
  }

  if (pset.has("torbox")) {
    const list = await listTorboxTorrents();
    const dead = list.filter(isTorboxTorrentDead);
    console.log(`[${new Date().toISOString()}][dead-scan] TorBox`, { total: list.length, dead: dead.length });
    summary.scanned.torbox = { total: list.length, dead: dead.length };
    for (const t of dead) {
      const title = torrentTitleLike(t);
      const ok = await tryReaddViaProwlarr(title, "realdebrid");
      if (ok) summary.readded.push({ provider: "realdebrid", title });
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
