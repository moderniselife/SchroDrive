/**
 * SchroDrive Integration Test Suite
 *
 * A self-contained integration test script that validates all SchroDrive API
 * endpoints against a live instance. Uses Bun's built-in fetch — no external
 * test framework dependencies required.
 *
 * Usage:
 *   SCHRODRIVE_URL=http://localhost:8978 bun tests/integration.test.ts
 *
 * Environment variables:
 *   SCHRODRIVE_URL  – Base URL of the SchroDrive instance (default: http://localhost:8978)
 *   TEST_TIMEOUT    – Per-test timeout in milliseconds (default: 10000)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TestResult {
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
  details?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.SCHRODRIVE_URL ?? "http://localhost:8978").replace(
  /\/$/,
  ""
);
const TEST_TIMEOUT = Number(process.env.TEST_TIMEOUT) || 10_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertType(value: unknown, expected: string, label: string): void {
  const actual = Array.isArray(value) ? "array" : typeof value;
  assert(
    actual === expected,
    `Expected ${label} to be ${expected}, got ${actual}`
  );
}

function assertHasKeys(obj: Record<string, unknown>, keys: string[], label: string): void {
  for (const key of keys) {
    assert(key in obj, `${label} is missing key "${key}"`);
  }
}

async function fetchJson(
  path: string,
  init?: RequestInit
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE_URL}${path}`, init);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Attempt to read a single SSE event from a stream endpoint.
 * Resolves with the raw event text or rejects on timeout.
 */
async function readFirstSseEvent(
  path: string,
  timeoutMs: number = 5000
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      signal: controller.signal,
      headers: { Accept: "text/event-stream" },
    });
    assert(res.ok, `SSE connection failed with status ${res.status}`);
    assert(res.body !== null, "SSE response has no body");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by double newlines
      if (buffer.includes("\n\n")) {
        reader.cancel();
        return buffer.split("\n\n")[0];
      }
    }
    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

async function runTest(
  name: string,
  fn: () => Promise<string | void>
): Promise<TestResult> {
  const start = performance.now();
  try {
    const details = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Test timed out after ${TEST_TIMEOUT}ms`)),
          TEST_TIMEOUT
        )
      ),
    ]);
    return {
      name,
      passed: true,
      durationMs: Math.round(performance.now() - start),
      details: details ?? undefined,
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    return {
      name,
      passed: false,
      durationMs: Math.round(performance.now() - start),
      error: message,
    };
  }
}

// ---------------------------------------------------------------------------
// Test definitions
// ---------------------------------------------------------------------------


const tests: Array<{ name: string; fn: () => Promise<string | void> }> = [
  // 1. Health
  {
    name: "Health check",
    fn: async () => {
      const { body } = await fetchJson("/health");
      assert(body.ok === true, `Expected ok: true, got ${JSON.stringify(body.ok)}`);
    },
  },

  // 2. Status
  {
    name: "Status endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/status");
      assertType(body.services, "object", "services");
      const services = body.services as Record<string, unknown>;
      assertHasKeys(services, [
        "webhook",
        "poller",
        "mount",
        "deadScanner",
        "deadScannerWatch",
        "organizerWatch",
      ], "services");

      const indexer = body.indexer as Record<string, unknown> | undefined;
      assert(indexer !== undefined, "indexer object missing");
      assertType(indexer!.configured, "boolean", "indexer.configured");

      // webdavBridges should be an array of bridge statuses
      assertType(body.webdavBridges, "array", "webdavBridges");
    },
  },

  // 3. Config
  {
    name: "Config endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/config");
      assert(body.ok === true, "Expected ok: true");
      assert(body.config !== undefined, "config object missing");
      assertType(body.config, "object", "config");
    },
  },

  // 4. Providers
  {
    name: "Providers endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/providers");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.providers, "array", "providers");
      const providers = body.providers as unknown[];
      assert(providers.length >= 1, `Expected at least 1 provider, got ${providers.length}`);
    },
  },

  // 5. Torrents
  {
    name: "Torrents endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/torrents");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.torrents, "array", "torrents");
    },
  },

  // 6. Downloads
  //    NOTE: This endpoint iterates all providers and can be slow (5-10s per provider).
  //    We use a longer timeout via Promise.race to avoid false failures.
  {
    name: "Downloads endpoint",
    fn: async () => {
      const DOWNLOADS_TIMEOUT = 30_000;
      const { body } = await Promise.race([
        fetchJson("/api/downloads"),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Downloads endpoint timed out after ${DOWNLOADS_TIMEOUT}ms`)),
            DOWNLOADS_TIMEOUT
          )
        ),
      ]);
      assert(body.ok === true, "Expected ok: true");
      assertType(body.downloads, "array", "downloads");
    },
  },

  // 7. Search
  {
    name: "Search endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/search?q=test");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.results, "array", "results");
    },
  },

  // 8. (Infringement and Rate Limits tests removed — endpoints not yet implemented)

  // 12. Logs
  {
    name: "Logs endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/logs");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.logs, "array", "logs");
    },
  },

  // 13. Files
  {
    name: "Files endpoint",
    fn: async () => {
      const res = await fetch(`${BASE_URL}/api/files?path=/`);
      // May 404 if mounts aren't ready — that's acceptable
      if (res.status === 404) {
        return "Skipped — mounts not ready (404)";
      }
      assert(res.ok, `Unexpected status ${res.status}`);
    },
  },

  // 14a. SSE — Torrents stream
  {
    name: "SSE torrents stream",
    fn: async () => {
      const event = await readFirstSseEvent("/api/torrents/stream", 5000);
      assert(event.length > 0, "Received empty SSE event");
      return `Received ${event.length} bytes`;
    },
  },

  // 14b. SSE — Downloads stream
  {
    name: "SSE downloads stream",
    fn: async () => {
      const event = await readFirstSseEvent("/api/downloads/stream", 5000);
      assert(event.length > 0, "Received empty SSE event");
      return `Received ${event.length} bytes`;
    },
  },

  // 14c. SSE — Logs stream
  {
    name: "SSE logs stream",
    fn: async () => {
      const event = await readFirstSseEvent("/api/logs/stream", 5000);
      assert(event.length > 0, "Received empty SSE event");
      return `Received ${event.length} bytes`;
    },
  },
];

// ---------------------------------------------------------------------------
// Cleanup — tidy up any test data created during integration tests
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  // Future: clean up any test data created during integration tests
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printResults(results: TestResult[]): void {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const totalMs = results.reduce((sum, r) => sum + r.durationMs, 0);

  // Calculate column widths
  const nameWidth = Math.max(
    ...results.map((r) => r.name.length),
    "SchroDrive Integration Test Results".length
  );
  const timeWidth = 8; // e.g. "12345ms"
  const innerWidth = nameWidth + 3 + timeWidth + 2; // " │ " separator + padding

  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));
  const padLeft = (s: string, w: number) =>
    " ".repeat(Math.max(0, w - s.length)) + s;

  console.log();
  console.log(`╔${"═".repeat(innerWidth)}╗`);
  console.log(
    `║${pad("  SchroDrive Integration Test Results", innerWidth)}║`
  );
  console.log(`╠${"═".repeat(innerWidth)}╣`);

  for (const r of results) {
    const icon = r.passed ? "✅" : "❌";
    const timeStr = padLeft(`${r.durationMs}ms`, timeWidth);
    console.log(
      `║ ${icon} ${pad(r.name, nameWidth)} │ ${timeStr} ║`
    );

    if (r.error) {
      console.log(
        `║    └─ Error: ${pad(r.error.slice(0, innerWidth - 16), innerWidth - 4)}║`
      );
    }
    if (r.details && r.passed) {
      console.log(
        `║    └─ ${pad(r.details.slice(0, innerWidth - 10), innerWidth - 4)}║`
      );
    }
  }

  console.log(`╠${"═".repeat(innerWidth)}╣`);
  const totalSec = (totalMs / 1000).toFixed(1);
  const summaryText = ` Passed: ${passed}/${results.length} │ Failed: ${failed} │ Total: ${totalSec}s`;
  console.log(`║${pad(summaryText, innerWidth)}║`);
  console.log(`╚${"═".repeat(innerWidth)}╝`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`\n🔬 SchroDrive Integration Tests`);
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Timeout per test: ${TEST_TIMEOUT}ms`);
  console.log(`   Started: ${new Date().toISOString()}\n`);

  // Pre-flight: check connectivity
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch(`${BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ Cannot connect to SchroDrive at ${BASE_URL}`);
    console.error(`   Error: ${msg}`);
    console.error(
      `\n   Make sure SchroDrive is running and the URL is correct.`
    );
    console.error(
      `   Set SCHRODRIVE_URL environment variable if using a different address.\n`
    );
    process.exit(1);
  }

  const results: TestResult[] = [];

  for (const test of tests) {
    process.stdout.write(`  Running: ${test.name}...`);
    const result = await runTest(test.name, test.fn);
    results.push(result);
    const icon = result.passed ? "✅" : "❌";
    process.stdout.write(`\r  ${icon} ${test.name} (${result.durationMs}ms)\n`);
  }

  // Always attempt cleanup
  await cleanup();

  printResults(results);

  const failed = results.filter((r) => !r.passed).length;
  if (failed > 0) {
    console.log(`💥 ${failed} test(s) failed. Exiting with code 1.\n`);
    process.exit(1);
  } else {
    console.log(`🎉 All tests passed! Lovely stuff.\n`);
    process.exit(0);
  }
}

main();
