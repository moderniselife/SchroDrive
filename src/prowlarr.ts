import axios from "axios";
import { config } from "./config";

export type ProwlarrResult = {
  title?: string;
  guid?: string;
  magnetUrl?: string;
  link?: string;
  seeders?: number;
  leechers?: number;
  size?: number;
  indexer?: string;
  categories?: number[] | string[];
  [key: string]: any;
};

export async function searchProwlarr(query: string, opts?: {
  categories?: string[];
  indexerIds?: string[];
  limit?: number;
}): Promise<ProwlarrResult[]> {
  if (!config.prowlarrUrl || !config.prowlarrApiKey) {
    throw new Error("Prowlarr not configured. Set PROWLARR_URL and PROWLARR_API_KEY.");
  }

  const url = new URL("/api/v1/search", config.prowlarrUrl);
  const params: Record<string, string> = {
    query,
    apikey: config.prowlarrApiKey,
    type: "search",
  };

  const categories = (opts?.categories || config.prowlarrCategories);
  if (categories && categories.length) {
    params["categories"] = categories.join(",");
    params["cat"] = categories.join(","); // compatibility
  }

  if (opts?.indexerIds && opts.indexerIds.length) {
    params["indexerIds"] = opts.indexerIds.join(",");
  }

  if (opts?.limit && opts.limit > 0) {
    params["limit"] = String(opts.limit);
  }

  const res = await axios.get<ProwlarrResult[]>(url.toString(), {
    params,
    timeout: 45000, // Increased from 20s to 45s
  });

  return Array.isArray(res.data) ? res.data : [];
}

export function pickBestResult(results: ProwlarrResult[]): ProwlarrResult | undefined {
  const withMagnet = results.filter((r) => getMagnet(r));
  const pool = withMagnet.length ? withMagnet : results;
  return pool
    .slice()
    .sort((a, b) => (b.seeders || 0) - (a.seeders || 0) || (b.size || 0) - (a.size || 0))
    [0];
}

export function getMagnet(r: ProwlarrResult | undefined): string | undefined {
  if (!r) return undefined;
  const magnet = r.magnetUrl || r.guid || r.link;
  if (typeof magnet === "string" && magnet.startsWith("magnet:")) return magnet;
  return undefined;
}
