"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isRDConfigured = isRDConfigured;
exports.listRDTorrents = listRDTorrents;
exports.addMagnetToRD = addMagnetToRD;
exports.selectAllFilesRD = selectAllFilesRD;
exports.isRDTorrentDead = isRDTorrentDead;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
function isRDConfigured() {
    return !!config_1.config.rdAccessToken;
}
function rdHeaders() {
    return { Authorization: `Bearer ${config_1.config.rdAccessToken}` };
}
async function listRDTorrents() {
    if (!isRDConfigured())
        return [];
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents`;
    const res = await axios_1.default.get(url, { headers: rdHeaders(), timeout: 20000 }).catch((err) => {
        console.error(`[${new Date().toISOString()}][rd] list torrents failed`, { err: err?.message || String(err) });
        return { data: [] };
    });
    const arr = Array.isArray(res?.data) ? res?.data : [];
    return arr;
}
async function addMagnetToRD(magnet) {
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents/addMagnet`;
    const params = new URLSearchParams();
    params.set("magnet", magnet);
    const res = await axios_1.default.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
    return res.data || {};
}
async function selectAllFilesRD(id) {
    if (!id)
        return;
    const base = (config_1.config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
    const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
    const params = new URLSearchParams();
    params.set("files", "all");
    await axios_1.default.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }).catch((err) => {
        console.warn(`[${new Date().toISOString()}][rd] select all files failed`, { id, err: err?.message || String(err) });
    });
}
function isRDTorrentDead(t) {
    const s = String(t?.status || "").toLowerCase();
    if (typeof t?.progress === "number" && t.progress >= 100)
        return false;
    if (s.includes("error") || s.includes("dead"))
        return true;
    return false;
}
