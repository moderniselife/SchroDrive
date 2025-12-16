import { config } from "./config";
import {
  searchProwlarr,
  pickBestResult as pickBestProwlarr,
  getMagnet as getMagnetProwlarr,
  getMagnetOrResolve as getMagnetOrResolveProwlarr,
  testProwlarrConnection,
  ProwlarrResult,
} from "./prowlarr";
import {
  searchJackett,
  pickBestResult as pickBestJackett,
  getMagnet as getMagnetJackett,
  getMagnetOrResolve as getMagnetOrResolveJackett,
  testJackettConnection,
  JackettResult,
} from "./jackett";

export type IndexerResult = ProwlarrResult | JackettResult;

export type IndexerProvider = "prowlarr" | "jackett";

export interface SearchOptions {
  categories?: string[];
  indexerIds?: string[];
  limit?: number;
}

let cachedProvider: IndexerProvider | null = null;

function isJackettConfigured(): boolean {
  return !!(config.jackettUrl && config.jackettApiKey);
}

function isProwlarrConfigured(): boolean {
  return !!(config.prowlarrUrl && config.prowlarrApiKey);
}

export async function detectActiveProvider(): Promise<IndexerProvider | null> {
  if (cachedProvider) return cachedProvider;

  const provider = config.indexerProvider;

  if (provider === "jackett") {
    if (isJackettConfigured()) {
      cachedProvider = "jackett";
      return "jackett";
    }
    console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=jackett but Jackett not configured`);
    return null;
  }

  if (provider === "prowlarr") {
    if (isProwlarrConfigured()) {
      cachedProvider = "prowlarr";
      return "prowlarr";
    }
    console.warn(`[${new Date().toISOString()}][indexer] INDEXER_PROVIDER=prowlarr but Prowlarr not configured`);
    return null;
  }

  // Auto mode: try Jackett first (if configured), then Prowlarr
  if (isJackettConfigured()) {
    console.log(`[${new Date().toISOString()}][indexer] auto-detected Jackett as indexer provider`);
    cachedProvider = "jackett";
    return "jackett";
  }

  if (isProwlarrConfigured()) {
    console.log(`[${new Date().toISOString()}][indexer] auto-detected Prowlarr as indexer provider`);
    cachedProvider = "prowlarr";
    return "prowlarr";
  }

  console.warn(`[${new Date().toISOString()}][indexer] no indexer provider configured`);
  return null;
}

export function getActiveProvider(): IndexerProvider | null {
  if (cachedProvider) return cachedProvider;

  const provider = config.indexerProvider;

  if (provider === "jackett" && isJackettConfigured()) {
    cachedProvider = "jackett";
    return "jackett";
  }

  if (provider === "prowlarr" && isProwlarrConfigured()) {
    cachedProvider = "prowlarr";
    return "prowlarr";
  }

  // Auto mode
  if (provider === "auto") {
    if (isJackettConfigured()) {
      cachedProvider = "jackett";
      return "jackett";
    }
    if (isProwlarrConfigured()) {
      cachedProvider = "prowlarr";
      return "prowlarr";
    }
  }

  return null;
}

export function clearProviderCache(): void {
  cachedProvider = null;
}

export async function testIndexerConnection(): Promise<boolean> {
  const provider = getActiveProvider();

  if (provider === "jackett") {
    return testJackettConnection();
  }

  if (provider === "prowlarr") {
    return testProwlarrConnection();
  }

  console.warn(`[${new Date().toISOString()}][indexer] no provider configured for connection test`);
  return false;
}

export async function searchIndexer(query: string, opts?: SearchOptions): Promise<IndexerResult[]> {
  const provider = getActiveProvider();

  if (provider === "jackett") {
    return searchJackett(query, opts);
  }

  if (provider === "prowlarr") {
    return searchProwlarr(query, opts);
  }

  throw new Error("No indexer provider configured. Set JACKETT_URL/JACKETT_API_KEY or PROWLARR_URL/PROWLARR_API_KEY.");
}

export function pickBestResult(results: IndexerResult[]): IndexerResult | undefined {
  const provider = getActiveProvider();

  if (provider === "jackett") {
    return pickBestJackett(results as JackettResult[]);
  }

  // Default to Prowlarr logic (works for both since structures are similar)
  return pickBestProwlarr(results as ProwlarrResult[]);
}

export function getMagnet(r: IndexerResult | undefined): string | undefined {
  if (!r) return undefined;

  const provider = getActiveProvider();

  if (provider === "jackett") {
    return getMagnetJackett(r as JackettResult);
  }

  return getMagnetProwlarr(r as ProwlarrResult);
}

export async function getMagnetOrResolve(r: IndexerResult | undefined): Promise<string | undefined> {
  if (!r) return undefined;

  const provider = getActiveProvider();

  if (provider === "jackett") {
    return getMagnetOrResolveJackett(r as JackettResult);
  }

  return getMagnetOrResolveProwlarr(r as ProwlarrResult);
}

export function getProviderName(): string {
  const provider = getActiveProvider();
  return provider || "none";
}

export function isIndexerConfigured(): boolean {
  return isJackettConfigured() || isProwlarrConfigured();
}
