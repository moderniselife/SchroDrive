import axios from 'axios';
import dns from 'node:dns';
import http from 'http';
import https from 'https';
import net from 'node:net';
import { config } from '../core/config';
import { base32ToHex } from '../core/utils';
import type { DebridProvider, AddStrategy, AddMagnetResult } from './index';
import { isKnownMagnet, addKnownMagnet } from '../core/db';

/** Extracts the infohash from a magnet URI. Supports 40-char hex and 32-char base32. */
function extractInfoHash(magnet: string): string | null {
  const match = magnet.match(/urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (!match) return null;
  const raw = match[1];
  if (raw.length === 32) {
    const hex = base32ToHex(raw);
    return hex ?? raw.toUpperCase();
  }
  return raw.toUpperCase();
}

/**
 * Rejects .torrent URLs that aren't http(s) or point at loopback/private/
 * link-local IP literals — these values come from indexer search results
 * (Prowlarr/Jackett), which is semi-trusted third-party content, so a
 * malicious result shouldn't be able to make this server fetch internal
 * services (e.g. cloud metadata endpoints, admin UIs on the LAN).
 *
 * This only catches IP literals in the URL, not hostnames that resolve to
 * a private address (DNS rebinding) — it's the synchronous baseline layer.
 * Pair it with {@link assertPublicResolvableHttpUrl} (DNS resolution check)
 * and {@link createPublicOnlyLookup} (connection-time DNS pinning) for the
 * full guard, as done in `addTorrentFileFromUrl`.
 */
export function assertPublicHttpUrl(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Refusing to fetch .torrent URL with scheme "${parsed.protocol}"`);
  }

  if (parsed.username || parsed.password) {
    // No legitimate indexer serves credential-bearing .torrent URLs: API
    // keys travel in query strings (unaffected by this check). Embedded
    // userinfo is rejected because it is a classic SSRF obfuscation shape
    // (e.g. http://trusted@evil/) and because this module logs request URLs
    // in plaintext — accepted credentials would leak into logs. Supporting
    // authenticated .torrent hosts is a separate feature (it needs log
    // redaction and per-host credential handling, not silent passthrough).
    throw new Error('Refusing to fetch .torrent URL containing embedded credentials');
  }

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new Error('Refusing to fetch .torrent URL pointing at localhost');
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    const isPrivate =
      a === 127 || // loopback
      a === 10 || // 10.0.0.0/8
      a === 0 || // 0.0.0.0/8
      (a === 169 && b === 254) || // link-local / cloud metadata
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168); // 192.168.0.0/16
    if (isPrivate) {
      throw new Error(`Refusing to fetch .torrent URL pointing at private address ${host}`);
    }
  }

  // IPv6 literals: Bun keeps brackets in hostname ("[::1]"), Node strips them ("::1") — handle both.
  const rawHostForV6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  if (rawHostForV6.includes(':')) {
    const ipv6 = rawHostForV6.toLowerCase();
    if (ipv6 === '::1' || ipv6 === '0:0:0:0:0:0:0:1' ||
        ipv6.startsWith('fe80:') || ipv6.startsWith('fc') || ipv6.startsWith('fd') ||
        ipv6.startsWith('::ffff:')) {
      throw new Error(`Refusing to fetch .torrent URL pointing at private IPv6 address ${host}`);
    }
  }
}

/** An IPv4 octet tuple parsed from a dotted-quad literal, or null. */
function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const octets = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (octets.some((o) => o > 255)) return null;
  return octets as [number, number, number, number];
}

/** Expands an IPv6 literal (no brackets, no zone id) to eight 16-bit groups, or null if invalid. */
function expandIpv6(ip: string): number[] | null {
  const zone = ip.indexOf('%');
  const addr = (zone === -1 ? ip : ip.slice(0, zone)).toLowerCase();
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const out: number[] = [];
    for (const part of side.split(':')) {
      if (part === '') return null;
      // Embedded IPv4 in the last group (e.g. ::ffff:192.0.2.1).
      if (part.includes('.')) {
        const v4 = parseIpv4(part);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(parseInt(part, 16));
    }
    return out;
  };
  const head = parseSide(halves[0]);
  if (!head) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = parseSide(halves[1]);
  if (!tail) return null;
  if (head.length + tail.length > 7) return null;
  return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
}

/**
 * Returns true when an IP literal is a globally routable public address.
 * Anything else (loopback, RFC1918, link-local, CGNAT, multicast, reserved,
 * documentation, IPv4-mapped/compatible, ULA, unspecified) returns false.
 */
export function isPublicIpAddress(ip: string): boolean {
  const v4 = parseIpv4(ip);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return false; // 0.0.0.0/8 — this host on this network
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGNAT
    if (a === 127) return false; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 0 && v4[2] === 0) return false; // 192.0.0.0/24 IETF protocol assignments
    if (a === 192 && b === 0 && v4[2] === 2) return false; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 2) return false; // 192.0.2.0/24 TEST-NET-1
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51 && v4[2] === 100) return false; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0 && v4[2] === 113) return false; // 203.0.113.0/24 TEST-NET-3
    if (a >= 224 && a <= 239) return false; // 224.0.0.0/4 multicast
    if (a >= 240) return false; // 240.0.0.0/4 reserved + broadcast
    return true;
  }
  const clean = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const groups = expandIpv6(clean);
  if (!groups) return false;
  const [g0, g1] = groups;
  if (groups.every((g) => g === 0)) return false; // :: unspecified
  if (g0 === 0 && groups.slice(0, 5).every((g) => g === 0)) {
    // ::/96 well-known forms embed an IPv4 address — judge the embedded address.
    // ::ffff:0:0/96 is IPv4-mapped (::ffff:a.b.c.d); ::/96 with a zero
    // group 5 is the deprecated IPv4-compatible form (covers ::1, ::2, ...).
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    if (groups[5] === 0xffff || groups[5] === 0) return isPublicIpAddress(embedded);
  }
  if ((g0 & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local (top 10 bits)
  if ((g0 & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
  if ((g0 & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (g0 === 0x2001 && g1 === 0xdb8) return false; // 2001:db8::/32 documentation
  if (g0 === 0x0064 && g1 === 0xff9b) {
    // 64:ff9b::/96 IPv4/IPv6 translation — judge the embedded IPv4.
    const embedded = `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
    return isPublicIpAddress(embedded);
  }
  return true;
}

/**
 * Full asynchronous SSRF guard for a .torrent URL: runs the synchronous
 * literal checks, then resolves the hostname and requires EVERY resolved
 * address to be a public IP (fail-closed on DNS errors or empty results).
 * Returns the parsed URL for the caller to fetch.
 */
export async function assertPublicResolvableHttpUrl(rawUrl: string): Promise<URL> {
  assertPublicHttpUrl(rawUrl);
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new Error(`Refusing to fetch .torrent URL: DNS lookup failed for ${hostname}`);
  }
  if (!records || records.length === 0) {
    throw new Error(`Refusing to fetch .torrent URL: no DNS records for ${hostname}`);
  }
  for (const record of records) {
    if (!isPublicIpAddress(record.address)) {
      throw new Error(`Refusing to fetch .torrent URL resolving to non-public address ${record.address}`);
    }
  }
  return parsed;
}

/**
 * Builds a `lookup` function for `http`/`https` agents that re-resolves the
 * hostname at connection time and only ever returns a public IP. This pins
 * the connection to an address that passed validation, closing the
 * check-then-connect DNS-rebinding (TOCTOU) window for the initial request.
 * Redirects are disabled separately (`maxRedirects: 0`) so no later hop can
 * bounce to an internal target.
 */
export function createPublicOnlyLookup(): (
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) => void {
  return (hostname, options, callback) => {
    const done = callback as (err: Error | null, address?: string, family?: number) => void;
    dns.promises.lookup(hostname, { all: true }).then(
      (records) => {
        const publicRecords = (records || []).filter((r) => isPublicIpAddress(r.address));
        const wantedFamily =
          typeof options === 'number' ? options : (options && (options as dns.LookupOptions).family) || 0;
        const pool = wantedFamily
          ? publicRecords.filter((r) => r.family === wantedFamily)
          : publicRecords;
        if (pool.length === 0) {
          done(new Error(`SSRF guard: ${hostname} has no public ${wantedFamily || ''} address`));
          return;
        }
        done(null, pool[0].address, pool[0].family);
      },
      (err) => done(err instanceof Error ? err : new Error(String(err))),
    );
  };
}

/**
 * Manages the lifecycle and lookup of registered debrid providers.
 */
class ProviderRegistry {
  private providers: Map<string, DebridProvider> = new Map();

  /**
   * Registers a provider instance. Typically called at module level
   * by each provider's source file.
   *
   * @param provider - The provider instance to register.
   */
  register(provider: DebridProvider): void {
    this.providers.set(provider.id, provider);
    console.log(`[${new Date().toISOString()}][providers] registered: ${provider.displayName} (${provider.id})`);
  }

  /**
   * Retrieves a provider by its unique identifier.
   *
   * @param id - The provider identifier (e.g. `'realdebrid'`).
   * @returns The provider instance, or `undefined` if not registered.
   */
  get(id: string): DebridProvider | undefined {
    return this.providers.get(id);
  }

  /** Returns all registered providers (configured or not). */
  all(): DebridProvider[] {
    return Array.from(this.providers.values());
  }

  /** Returns only providers that have valid API credentials configured. */
  configured(): DebridProvider[] {
    return this.all().filter(p => p.isConfigured());
  }

  /**
   * Returns configured providers in the user's preferred order.
   *
   * @returns An ordered array of configured providers.
   */
  ordered(): DebridProvider[] {
    const order = config.providers; // e.g. ['torbox', 'realdebrid']
    const configured = this.configured();
    const ordered: DebridProvider[] = [];
    for (const id of order) {
      const p = configured.find(c => c.id === id);
      if (p) ordered.push(p);
    }
    // Append any configured providers not in the order list
    for (const p of configured) {
      if (!ordered.includes(p)) ordered.push(p);
    }
    return ordered;
  }

  /**
   * Checks all configured providers for an existing torrent with a similar title.
   *
   * @param title - The title to search for among existing torrents.
   * @returns An object indicating whether a match was found and which provider.
   */
  async checkExistingAcrossAll(title: string): Promise<{ exists: boolean; provider?: string }> {
    for (const p of this.configured()) {
      try {
        if (await p.checkExisting(title)) {
          return { exists: true, provider: p.id };
        }
      } catch (e: any) {
        console.warn(`[${new Date().toISOString()}][providers] ${p.id} duplicate check failed`, { err: e?.message });
      }
    }
    return { exists: false };
  }

  /**
   * Adds a magnet link using the configured strategy.
   *
   * @param magnet - The magnet URI to add.
   * @param name - Optional human-readable name for the torrent.
   * @param strategy - The distribution strategy. Defaults to `'all'`.
   * @returns An object containing per-provider results.
   */
  async addMagnetWithStrategy(
    magnet: string,
    name?: string,
    strategy: AddStrategy = 'all',
  ): Promise<{ results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> }> {
    // Auto-detect .torrent file URLs (returned by getMagnetOrResolve with torrent: prefix)
    // and transparently delegate to addTorrentFileFromUrl instead
    if (magnet.startsWith('torrent:')) {
      const torrentUrl = magnet.slice('torrent:'.length);
      console.log(`[${new Date().toISOString()}][registry] Detected .torrent file URL — delegating to file upload`, { url: torrentUrl, name });
      return this.addTorrentFileFromUrl(torrentUrl, name || 'unknown', strategy);
    }

    const providers = this.ordered();
    const results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> = [];
    let legallyBlocked = false;

    // Infohash-level deduplication — skip if we've already added this exact torrent
    const infoHash = extractInfoHash(magnet);
    if (infoHash && isKnownMagnet(infoHash)) {
      console.log(`[${new Date().toISOString()}][registry] Skipping known magnet ${infoHash.slice(0, 8)}... — already added previously`);
      return { results };
    }

    for (const p of providers) {
      try {
        console.log(`[${new Date().toISOString()}][providers] adding magnet to ${p.id}`, { name });
        const result = await p.addMagnet(magnet, name);
        console.log(`[${new Date().toISOString()}][providers] ✅ added to ${p.id}`, { id: result.id });
        results.push({ provider: p.id, success: true, result });
        if (infoHash) addKnownMagnet(infoHash, name, p.id);

        if (strategy === 'failover' || strategy === 'single') {
          break; // Success — don't try more providers
        }
      } catch (err: any) {
        const error = err?.message || String(err);
        const status = err?.response?.status || err?.status;
        console.warn(`[${new Date().toISOString()}][providers] ❌ ${p.id} add failed`, { error });
        results.push({ provider: p.id, success: false, error });

        // HTTP 451 = Unavailable For Legal Reasons — auto-blacklist
        if (status === 451) {
          legallyBlocked = true;
          console.warn(`[${new Date().toISOString()}][providers] ⚖️ ${p.id} returned 451 (legally blocked)`, { name });
        }

        if (strategy === 'single') {
          break; // Only try one
        }
      }
    }

    // If ANY provider returned 451, auto-blacklist this torrent so we never retry it
    if (legallyBlocked && name) {
      const { addToBlacklist, isBlacklisted } = await import('../core/blacklist');
      if (!isBlacklisted(name)) {
        addToBlacklist(name, 'HTTP 451 — Unavailable For Legal Reasons', 'auto');
        console.log(`[${new Date().toISOString()}][providers] ⚖️ auto-blacklisted "${name}" (451 legally blocked)`);
      }
    }

    return { results };
  }

  /**
   * Downloads a .torrent file from a URL and uploads it to debrid providers
   * using the configured strategy.
   *
   * Falls back through ordered providers if a provider doesn't support
   * `.torrent` file uploads. Logs each step with ISO timestamps.
   *
   * @param torrentUrl - The HTTP(S) URL of the .torrent file.
   * @param name - Human-readable name for the torrent.
   * @param strategy - The distribution strategy. Defaults to `'all'`.
   * @returns An object containing per-provider results.
   */
  async addTorrentFileFromUrl(
    torrentUrl: string,
    name: string,
    strategy: AddStrategy = 'all',
  ): Promise<{ results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> }> {
    const results: Array<{ provider: string; success: boolean; result?: AddMagnetResult; error?: string }> = [];

    // Download the .torrent file
    console.log(`[${new Date().toISOString()}][registry] Downloading .torrent file: ${torrentUrl}`);
    let fileBuffer: Buffer;
    try {
      // Layered SSRF guard: literal checks + DNS resolution must be public,
      // then pin the connection to a validated address (closes DNS-rebinding
      // TOCTOU). Redirects stay disabled so no hop can bounce internal.
      const safeUrl = (await assertPublicResolvableHttpUrl(torrentUrl)).toString();
      const publicLookup = createPublicOnlyLookup();
      const resp = await axios.get(safeUrl, {
        responseType: 'arraybuffer',
        timeout: 30000,
        maxRedirects: 0,
        httpAgent: new http.Agent({ family: 4, lookup: publicLookup }),
        httpsAgent: new https.Agent({ family: 4, lookup: publicLookup }),
      });
      fileBuffer = Buffer.from(resp.data);
      console.log(`[${new Date().toISOString()}][registry] Downloaded .torrent file (${fileBuffer.length} bytes)`);
    } catch (err: any) {
      const error = `Failed to download .torrent file: ${err?.message || String(err)}`;
      console.error(`[${new Date().toISOString()}][registry] ${error}`);
      return { results: [{ provider: 'registry', success: false, error }] };
    }

    // Upload to providers using the same strategy pattern as addMagnetWithStrategy
    const providers = this.ordered();
    for (const p of providers) {
      try {
        if (p.addTorrentFile) {
          console.log(`[${new Date().toISOString()}][registry] Uploading .torrent file to ${p.id}`, { name });
          const result = await p.addTorrentFile(fileBuffer, name);
          console.log(`[${new Date().toISOString()}][registry] ✅ .torrent file added to ${p.id}`, { id: result.id });
          results.push({ provider: p.id, success: true, result });

          if (strategy === 'failover' || strategy === 'single') {
            break; // Success — don't try more providers
          }
        } else {
          console.warn(`[${new Date().toISOString()}][registry] ${p.id} does not support .torrent file upload — skipping`);
          results.push({ provider: p.id, success: false, error: 'Provider does not support .torrent file upload' });
        }
      } catch (err: any) {
        const error = err?.message || String(err);
        console.error(`[${new Date().toISOString()}][registry] ❌ Failed to upload .torrent to ${p.id}: ${error}`);
        results.push({ provider: p.id, success: false, error });

        if (strategy === 'single') {
          break; // Only try one
        }
      }
    }

    return { results };
  }
}

/** Singleton registry instance shared across the application. */
export const registry = new ProviderRegistry();
