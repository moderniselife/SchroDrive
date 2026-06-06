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
  fn: () => Promise<string | void>,
  timeoutMs: number = TEST_TIMEOUT
): Promise<TestResult> {
  const start = performance.now();
  try {
    const details = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Test timed out after ${timeoutMs}ms`)),
          timeoutMs
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

/** State shared between infringement CRUD tests */
let createdInfringementId: string | null = null;

const tests: Array<{ name: string; fn: () => Promise<string | void>; timeoutMs?: number }> = [
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
        "watchlistPoller",
      ], "services");

      const indexer = body.indexer as Record<string, unknown> | undefined;
      assert(indexer !== undefined, "indexer object missing");
      assertType(indexer!.configured, "boolean", "indexer.configured");

      assertType(body.mediaServers, "object", "mediaServers");
      const mediaServers = body.mediaServers as Record<string, unknown>;
      assertHasKeys(mediaServers, ["plex", "jellyfin", "emby"], "mediaServers");

      const infringementList = body.infringementList as Record<string, unknown> | undefined;
      assert(infringementList !== undefined, "infringementList missing");
      assertHasKeys(
        infringementList!,
        ["version", "lastModified", "count"],
        "infringementList"
      );
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

  // 6. Downloads (longer timeout — hits multiple provider APIs)
  {
    name: 'Downloads endpoint',
    timeoutMs: 30_000,
    fn: async () => {
      const { body } = await fetchJson('/api/downloads');
      assert(body.ok === true, 'Expected ok: true');
      assertType(body.downloads, 'array', 'downloads');
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

  // 8. Infringement List (GET)
  {
    name: "Infringement list",
    fn: async () => {
      const { body } = await fetchJson("/api/infringement-list");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.entries, "array", "entries");
    },
  },

  // 9. Infringement Check
  {
    name: "Infringement check",
    fn: async () => {
      const { body } = await fetchJson("/api/infringement-list/check?name=test");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.blocked, "boolean", "blocked");
    },
  },

  // 10a. Infringement Add
  {
    name: "Infringement add",
    fn: async () => {
      const { status, body } = await fetchJson("/api/infringement-list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pattern: "_test_pattern_",
          blockedBy: "both",
          reason: "Integration test",
          matchType: "contains",
        }),
      });
      assert(status === 201, `Expected status 201, got ${status}`);
      // Store the ID for later cleanup
      const entry = body.entry as Record<string, unknown> | undefined;
      if (entry && typeof entry.id === "string") {
        createdInfringementId = entry.id;
      } else if (typeof body.id === "string") {
        createdInfringementId = body.id;
      }
      return `Created entry ID: ${createdInfringementId ?? "unknown"}`;
    },
  },

  // 10b. Infringement verify exists
  {
    name: "Infringement verify added",
    fn: async () => {
      const { body } = await fetchJson("/api/infringement-list");
      const entries = body.entries as Array<Record<string, unknown>>;
      const found = entries.some(
        (e) => e.pattern === "_test_pattern_" || e.id === createdInfringementId
      );
      assert(found, "Test infringement entry not found after creation");
    },
  },

  // 10c. Infringement delete
  {
    name: "Infringement delete",
    fn: async () => {
      assert(
        createdInfringementId !== null,
        "No infringement entry ID — add test must have failed"
      );
      const { body } = await fetchJson(
        `/api/infringement-list/${createdInfringementId}`,
        { method: "DELETE" }
      );
      assert(body.ok === true, "Expected ok: true on delete");
    },
  },

  // 10d. Infringement verify removed
  {
    name: "Infringement verify removed",
    fn: async () => {
      const { body } = await fetchJson("/api/infringement-list");
      const entries = body.entries as Array<Record<string, unknown>>;
      const found = entries.some(
        (e) => e.pattern === "_test_pattern_" || e.id === createdInfringementId
      );
      assert(!found, "Test infringement entry still present after deletion");
    },
  },

  // 11. Rate Limits
  {
    name: "Rate limits endpoint",
    fn: async () => {
      const { body } = await fetchJson("/api/rate-limits");
      assert(body.ok === true, "Expected ok: true");
      assertType(body.learned, "object", "learned");
      assertType(body.current, "object", "current");
    },
  },

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
// Cleanup — ensure test infringement entries are removed on failure
// ---------------------------------------------------------------------------

async function cleanup(): Promise<void> {
  if (createdInfringementId) {
    try {
      await fetch(`${BASE_URL}/api/infringement-list/${createdInfringementId}`, {
        method: "DELETE",
      });
    } catch {
      // Best-effort cleanup — ignore errors
    }
  }

  // Also search for any orphaned test patterns
  try {
    const res = await fetch(`${BASE_URL}/api/infringement-list`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      const entries = (data.entries as Array<Record<string, unknown>>) ?? [];
      for (const entry of entries) {
        if (entry.pattern === "_test_pattern_" && typeof entry.id === "string") {
          await fetch(`${BASE_URL}/api/infringement-list/${entry.id}`, {
            method: "DELETE",
          });
        }
      }
    }
  } catch {
    // Best-effort cleanup
  }
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
    const result = await runTest(test.name, test.fn, test.timeoutMs);
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
