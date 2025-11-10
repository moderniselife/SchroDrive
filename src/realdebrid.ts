import axios from "axios";
import { config } from "./config";

export function isRDConfigured(): boolean {
  return !!config.rdAccessToken;
}

function rdHeaders() {
  return { Authorization: `Bearer ${config.rdAccessToken}` } as Record<string, string>;
}

export async function listRDTorrents(): Promise<any[]> {
  if (!isRDConfigured()) return [];
  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents`;
  const res = await axios.get(url, { headers: rdHeaders(), timeout: 20000 }).catch((err: any) => {
    console.error(`[${new Date().toISOString()}][rd] list torrents failed`, { err: err?.message || String(err) });
    return { data: [] } as any;
  });
  const arr = Array.isArray(res?.data) ? res?.data : [];
  return arr;
}

export async function addMagnetToRD(magnet: string): Promise<{ id?: string; uri?: string }> {
  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/addMagnet`;
  const params = new URLSearchParams();
  params.set("magnet", magnet);
  const res = await axios.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 });
  return res.data || {};
}

export async function selectAllFilesRD(id: string): Promise<void> {
  if (!id) return;
  const base = (config.rdApiBase || "https://api.real-debrid.com/rest/1.0").replace(/\/$/, "");
  const url = `${base}/torrents/selectFiles/${encodeURIComponent(id)}`;
  const params = new URLSearchParams();
  params.set("files", "all");
  await axios.post(url, params, { headers: { ...rdHeaders(), "Content-Type": "application/x-www-form-urlencoded" }, timeout: 20000 }).catch((err: any) => {
    console.warn(`[${new Date().toISOString()}][rd] select all files failed`, { id, err: err?.message || String(err) });
  });
}

export function isRDTorrentDead(t: any): boolean {
  const s = String(t?.status || "").toLowerCase();
  if (typeof t?.progress === "number" && t.progress >= 100) return false;
  if (s.includes("error") || s.includes("dead")) return true;
  return false;
}
