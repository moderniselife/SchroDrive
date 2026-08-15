/**
 * Regression test for GitHub issue #57.
 *
 * https://github.com/moderniselife/SchroDrive/issues/57
 *
 * Bug: with ARR_BRIDGE_ENABLED=true, startArrBridge() threw synchronously
 * while registering the catch-all route `app.all('/api/v2/*', ...)`, because
 * Express 5 (path-to-regexp v8) dropped support for bare `*` wildcards:
 *
 *   Missing parameter name at index 9: /api/v2/*
 *
 * That throw was caught as "non-fatal" by src/index.ts and logged, but it
 * meant the bridge never bound to its port, so Radarr/Sonarr got
 * "connection refused" when testing the qBittorrent download client.
 *
 * Fix: use Express 5's named-wildcard syntax `/api/v2/{*splat}`, matching
 * the pattern already used in src/services/webdavBridge.ts.
 *
 * If this test starts failing again, re-open #57 — do not just patch the
 * route and move on without checking whether Express/path-to-regexp changed
 * its wildcard syntax again.
 *
 * Run: bun test tests/regressions/57-arr-bridge-wildcard-route/
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { config } from '../../../src/core/config';
import { startArrBridge, stopArrBridge } from '../../../src/services/arrBridge';

const PORT = 18284;
const BASE_URL = `http://localhost:${PORT}`;

beforeAll(async () => {
  config.arrBridgePort = PORT;
  config.mountBase = fs.mkdtempSync(path.join(os.tmpdir(), 'schrodrive-arrbridge-regression-'));
});

afterAll(async () => {
  await stopArrBridge();
});

describe('#57 — *arr bridge Express 5 wildcard route', () => {
  test('startArrBridge() resolves instead of throwing pathToRegexpError', async () => {
    // Before the fix, this rejected with:
    // "Missing parameter name at index 9: /api/v2/*"
    await expect(startArrBridge()).resolves.toBeUndefined();
  });

  test('bridge actually binds to its configured port (not just "non-fatal" and dead)', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
  });

  test('unimplemented /api/v2/* paths are handled by the catch-all, not connection-refused', async () => {
    const res = await fetch(`${BASE_URL}/api/v2/some/future/endpoint/radarr/sonarr/dont/know/about/yet`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});
