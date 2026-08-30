/**
 * Regression test for a CodeQL js/request-forgery finding on
 * registry.ts's addTorrentFileFromUrl (alert #12).
 *
 * https://github.com/moderniselife/SchroDrive/security/code-scanning/12
 *
 * addTorrentFileFromUrl fetches a .torrent URL that ultimately comes from
 * Prowlarr/Jackett search results — semi-trusted third-party content. A
 * malicious/compromised indexer result could point that URL at an internal
 * service (cloud metadata endpoint, LAN admin UI, etc.) and this server
 * would fetch it with no user interaction, via the watchlist poller / dead
 * scanner. assertPublicHttpUrl() rejects non-http(s) schemes and IP
 * literals in loopback/private/link-local ranges before the request is
 * made.
 *
 * Run: bun test tests/regressions/codeql-ssrf-torrent-url/
 */

import { describe, expect, test } from 'bun:test';
import { assertPublicHttpUrl } from '../../../src/providers/registry';

describe('CodeQL #12 — SSRF guard on .torrent URL fetch', () => {
  test('allows ordinary public http(s) URLs', () => {
    expect(() => assertPublicHttpUrl('https://example.com/file.torrent')).not.toThrow();
    expect(() => assertPublicHttpUrl('http://tracker.example.org/dl?id=1')).not.toThrow();
  });

  test('rejects non-http(s) schemes', () => {
    expect(() => assertPublicHttpUrl('file:///etc/passwd')).toThrow();
    expect(() => assertPublicHttpUrl('gopher://internal:70/x')).toThrow();
  });

  test('rejects localhost', () => {
    expect(() => assertPublicHttpUrl('http://localhost/x')).toThrow();
    expect(() => assertPublicHttpUrl('http://sub.localhost/x')).toThrow();
  });

  test('rejects loopback and private IPv4 literals', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/x')).toThrow();
    expect(() => assertPublicHttpUrl('http://10.0.0.5/x')).toThrow();
    expect(() => assertPublicHttpUrl('http://172.16.0.1/x')).toThrow();
    expect(() => assertPublicHttpUrl('http://192.168.1.1/x')).toThrow();
  });

  test('rejects the cloud metadata link-local address', () => {
    expect(() => assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).toThrow();
  });

  test('rejects IPv6 loopback and unique-local addresses', () => {
    expect(() => assertPublicHttpUrl('http://[::1]/x')).toThrow();
    expect(() => assertPublicHttpUrl('http://[fd00::1]/x')).toThrow();
  });

  test('does not reject a public IPv4 address that merely starts with a private octet', () => {
    // 172.32.x.x is outside the 172.16.0.0/12 private range (16-31)
    expect(() => assertPublicHttpUrl('http://172.32.0.1/x')).not.toThrow();
  });
});
