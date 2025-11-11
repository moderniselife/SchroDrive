"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDeadOnce = scanDeadOnce;
exports.startDeadScanner = startDeadScanner;
const config_1 = require("./config");
const prowlarr_1 = require("./prowlarr");
const torbox_1 = require("./torbox");
const realdebrid_1 = require("./realdebrid");
const torbox_2 = require("./torbox");
function torrentTitleLike(t) {
    return (t?.name || t?.filename || t?.title || t?.originalName || t?.displayName || "");
}
async function tryReaddViaProwlarr(title, prefer = "any") {
    const results = await (0, prowlarr_1.searchProwlarr)(title);
    const best = (0, prowlarr_1.pickBestResult)(results);
    let magnet = (0, prowlarr_1.getMagnet)(best);
    if (!magnet) {
        try {
            magnet = await (0, prowlarr_1.getMagnetOrResolve)(best);
        }
        catch { }
    }
    if (!magnet) {
        console.warn(`[${new Date().toISOString()}][dead-scan] no magnet for`, { title });
        return false;
    }
    const pset = (0, config_1.providersSet)();
    if ((prefer === "torbox" || prefer === "any") && pset.has("torbox")) {
        try {
            await (0, torbox_1.addMagnetToTorbox)(magnet, title);
            console.log(`[${new Date().toISOString()}][dead-scan] re-added to TorBox`, { title });
            return true;
        }
        catch (e) {
            console.warn(`[${new Date().toISOString()}][dead-scan] TorBox add failed`, { title, err: e?.message || String(e) });
        }
    }
    if ((prefer === "realdebrid" || prefer === "any") && pset.has("realdebrid")) {
        try {
            const res = await (0, realdebrid_1.addMagnetToRD)(magnet);
            if (res?.id) {
                await (0, realdebrid_1.selectAllFilesRD)(res.id);
            }
            console.log(`[${new Date().toISOString()}][dead-scan] re-added to RealDebrid`, { title });
            return true;
        }
        catch (e) {
            console.warn(`[${new Date().toISOString()}][dead-scan] RD add failed`, { title, err: e?.message || String(e) });
        }
    }
    return false;
}
async function scanDeadOnce() {
    const pset = (0, config_1.providersSet)();
    const summary = { scanned: {}, readded: [] };
    if (pset.has("realdebrid")) {
        const list = await (0, realdebrid_1.listRDTorrents)();
        const dead = list.filter(realdebrid_1.isRDTorrentDead);
        console.log(`[${new Date().toISOString()}][dead-scan] RD`, { total: list.length, dead: dead.length });
        summary.scanned.realdebrid = { total: list.length, dead: dead.length };
        for (const t of dead) {
            const title = torrentTitleLike(t);
            const ok = await tryReaddViaProwlarr(title, "torbox");
            if (ok)
                summary.readded.push({ provider: "torbox", title });
        }
    }
    if (pset.has("torbox")) {
        const list = await (0, torbox_2.listTorboxTorrents)();
        const dead = list.filter(torbox_2.isTorboxTorrentDead);
        console.log(`[${new Date().toISOString()}][dead-scan] TorBox`, { total: list.length, dead: dead.length });
        summary.scanned.torbox = { total: list.length, dead: dead.length };
        for (const t of dead) {
            const title = torrentTitleLike(t);
            const ok = await tryReaddViaProwlarr(title, "realdebrid");
            if (ok)
                summary.readded.push({ provider: "realdebrid", title });
        }
    }
    return summary;
}
function startDeadScanner() {
    const intervalMs = Math.max(60, config_1.config.deadScanIntervalSeconds || 600) * 1000;
    console.log(`[${new Date().toISOString()}][dead-scan] starting`, { everySeconds: Math.round(intervalMs / 1000) });
    const run = async () => {
        try {
            await scanDeadOnce();
        }
        catch (e) {
            console.error(`[${new Date().toISOString()}][dead-scan] error`, e?.message || String(e));
        }
    };
    run();
    setInterval(run, intervalMs);
}
