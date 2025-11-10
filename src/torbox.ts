import { TorboxClient } from "node-torbox-api";
import { config, requireEnv } from "./config";

let client: TorboxClient | null = null as any;

function getClient(): TorboxClient {
  requireEnv("torboxApiKey");
  if (!client) {
    const maskedKey = config.torboxApiKey ? `${config.torboxApiKey.slice(0, 4)}…` : "unset";
    console.log(`[${new Date().toISOString()}][torbox] init client`, { baseURL: config.torboxBaseUrl, apiKey: maskedKey });
    client = new TorboxClient({ apiKey: config.torboxApiKey, baseURL: config.torboxBaseUrl });
  }
  return client;
}

export async function checkExistingTorrents(searchTitle: string): Promise<boolean> {
  const c = getClient();
  console.log(`[${new Date().toISOString()}][torbox] checking existing torrents`, { searchTitle });
  const started = Date.now();
  
  try {
    // Get all torrents and filter them locally since the API doesn't support search
    const res = await c.torrents.getTorrentList({ 
      limit: 100 // Get more torrents to check against
    });
    
    // Handle both single torrent and array responses
    const existingTorrents = Array.isArray(res.data) ? res.data : [res.data].filter(Boolean);
    console.log(`[${new Date().toISOString()}][torbox] existing torrents check`, { 
      searchTitle, 
      count: existingTorrents.length,
      ms: Date.now() - started 
    });
    
    // Check if any existing torrent matches our search title
    // We'll do a case-insensitive contains check
    const normalizedSearch = searchTitle.toLowerCase();
    const hasExisting = existingTorrents.some((torrent: any) => {
      const torrentName = (torrent.name || '').toLowerCase();
      return torrentName.includes(normalizedSearch) || normalizedSearch.includes(torrentName);
    });
    
    if (hasExisting) {
      console.log(`[${new Date().toISOString()}][torbox] found existing torrent`, { 
        searchTitle,
        existingNames: existingTorrents.slice(0, 3).map((t: any) => t.name)
      });
    }
    
    return hasExisting;
  } catch (err: any) {
    console.error(`[${new Date().toISOString()}][torbox] existing torrents check failed`, {
      searchTitle,
      error: err?.message || String(err),
      status: err?.response?.status,
      statusText: err?.response?.statusText,
    });
    // If we can't check existing torrents, assume it doesn't exist to avoid missing content
    return false;
  }
}

export async function addMagnetToTorbox(magnet: string, name?: string) {
  const c = getClient();
  const teaser = magnet.slice(0, 80) + '...';
  console.log(`[${new Date().toISOString()}][torbox] createTorrent`, { name, teaser });
  const started = Date.now();
  const res = await c.torrents.createTorrent({ magnet, name }).catch((err: any) => {
    console.error(`[${new Date().toISOString()}][torbox] createTorrent failed`, {
      name,
      teaser,
      error: err?.message || String(err),
      status: err?.response?.status,
      statusText: err?.response?.statusText,
    });
    throw err;
  });
  console.log(`[${new Date().toISOString()}][torbox] createTorrent done`, { ms: Date.now() - started });
  return res;
}
