/**
 * Regression tests for the hardened SSRF guard on registry.ts's
 * addTorrentFileFromUrl (CodeQL alert #12, js/request-forgery).
 *
 * https://github.com/moderniselife/SchroDrive/security/code-scanning/12
 *
 * Layered defense under test:
 *  1. assertPublicHttpUrl() — synchronous literal checks (scheme, localhost,
 *     private IP literals, embedded credentials).
 *  2. assertPublicResolvableHttpUrl() — resolves the hostname and requires
 *     EVERY resolved address to be public (fail-closed on DNS errors).
 *  3. createPublicOnlyLookup() — agent `lookup` hook that re-validates at
 *     connection time, pinning the socket to a public IP (closes the
 *     check-then-connect DNS-rebinding window). Redirects stay disabled
 *     (`maxRedirects: 0`) at the call site.
 *
 * All cases are offline-safe: they use IP literals, RFC 2606 `.invalid`
 * names (guaranteed unresolvable), or `localhost` (hosts-file resolution).
 *
 * Run: bun test tests/regressions/codeql-ssrf-torrent-url/
 */

import { describe, expect, test } from 'bun:test';
import {
  assertPublicHttpUrl,
  assertPublicResolvableHttpUrl,
  createPublicOnlyLookup,
  isPublicIpAddress,
} from '../../../src/providers/registry';

describe('CodeQL #12 — public IP classification', () => {
  test('accepts globally routable addresses', () => {
    for (const ip of [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '172.32.0.1', // just outside 172.16.0.0/12
      '172.15.255.255',
      '100.128.0.1', // just outside CGNAT 100.64.0.0/10
      '192.0.1.1', // just outside 192.0.0.0/24
      '2001:4860:4860::8888',
      '2606:4700:4700::1111',
      '::ffff:8.8.8.8', // v4-mapped public stays public
      '64:ff9b::808:808', // NAT64 of 8.8.8.8 stays public
    ]) {
      expect(isPublicIpAddress(ip), ip).toBe(true);
    }
  });

  test('rejects loopback, private, and special-purpose ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.0.0.5',
      '100.64.0.1', // CGNAT
      '100.127.255.255', // CGNAT
      '127.0.0.1',
      '169.254.169.254', // cloud metadata
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1', // IETF protocol assignments
      '192.0.2.1', // TEST-NET-1
      '192.168.1.1',
      '198.18.0.1', // benchmarking
      '198.51.100.7', // TEST-NET-2
      '203.0.113.9', // TEST-NET-3
      '224.0.0.1', // multicast
      '240.0.0.1', // reserved
      '255.255.255.255', // broadcast
      '::', // unspecified
      '::1', // loopback
      '0:0:0:0:0:0:0:1', // loopback, full form
      'fe80::1', // link-local
      'febf:1234::1', // still within fe80::/10
      'fc00::1', // unique-local
      'fd12:3456::1', // unique-local
      'ff02::1', // multicast
      '2001:db8::1', // documentation
      '::ffff:127.0.0.1', // v4-mapped loopback
      '::ffff:10.0.0.1', // v4-mapped private
      '64:ff9b::c000:201', // NAT64 of TEST-NET-1 192.0.2.1
      'not-an-ip',
    ]) {
      expect(isPublicIpAddress(ip), ip).toBe(false);
    }
  });
});

describe('CodeQL #12 — async DNS-layer guard', () => {
  test('rejects URLs with embedded credentials without touching DNS', async () => {
    await expect(assertPublicResolvableHttpUrl('http://user:pass@example.com/x')).rejects.toThrow();
    await expect(assertPublicResolvableHttpUrl('https://token@example.com/x')).rejects.toThrow();
  });

  test('rejects localhost and private literals', async () => {
    await expect(assertPublicResolvableHttpUrl('http://localhost/x')).rejects.toThrow();
    await expect(assertPublicResolvableHttpUrl('http://127.0.0.2/x')).rejects.toThrow();
    await expect(assertPublicResolvableHttpUrl('http://10.1.2.3/x')).rejects.toThrow();
    await expect(assertPublicResolvableHttpUrl('http://[::1]/x')).rejects.toThrow();
  });

  test('fails closed when the hostname does not resolve', async () => {
    // .invalid is RFC 2606 reserved and never resolves.
    await expect(assertPublicResolvableHttpUrl('http://nonexistent.invalid/x')).rejects.toThrow();
  });

  test('allows a public IP literal (no DNS needed)', async () => {
    const parsed = await assertPublicResolvableHttpUrl('http://93.184.216.34/x');
    expect(parsed.hostname).toBe('93.184.216.34');
  });
});

describe('CodeQL #12 — connection-time DNS pinning lookup', () => {
  function lookup(hostname: string, family = 0): Promise<{ address: string; family: number }> {
    const fn = createPublicOnlyLookup();
    return new Promise((resolve, reject) => {
      fn(hostname, { family, all: true } as never, ((err: Error | null, address?: string, fam?: number) => {
        if (err) reject(err);
        else resolve({ address: address as string, family: fam as number });
      }) as never);
    });
  }

  test('returns a public literal directly', async () => {
    const { address } = await lookup('93.184.216.34', 4);
    expect(address).toBe('93.184.216.34');
  });

  test('refuses localhost (resolves to loopback)', async () => {
    await expect(lookup('localhost')).rejects.toThrow();
  });

  test('refuses private literals', async () => {
    await expect(lookup('10.1.2.3')).rejects.toThrow();
  });

  test('refuses unresolvable hosts', async () => {
    await expect(lookup('nonexistent.invalid')).rejects.toThrow();
  });

  test('respects a requested family when a public address exists', async () => {
    const { address, family } = await lookup('93.184.216.34', 4);
    expect(family).toBe(4);
    expect(address).toBe('93.184.216.34');
  });
});

describe('CodeQL #12 — sync guard additions', () => {
  test('rejects embedded credentials', () => {
    expect(() => assertPublicHttpUrl('http://user:pass@example.com/x')).toThrow();
    expect(() => assertPublicHttpUrl('https://token@example.com/x')).toThrow();
  });
});
