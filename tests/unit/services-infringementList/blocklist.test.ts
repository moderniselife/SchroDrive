import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "schrodrive-blocklist-"));
process.env.INFRINGEMENT_LIST_PATH = join(directory, "list.json");
const { addBlocked, checkBlocked, getBlocklistInfo, reloadList, removeBlocked } = await import("../../../src/services/infringementList");

beforeAll(() => reloadList());
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("infringement blocklist", () => {
  test("matches exact, contains, and regex entries", () => {
    const exact = addBlocked("Exact Title", "realdebrid", "rejected", "exact");
    addBlocked("copyrighted", "torbox", "rejected", "contains");
    addBlocked("^Forbidden \\d+$", "realdebrid", "rejected", "regex");
    expect(checkBlocked("Exact Title")?.id).toBe(exact.id);
    expect(checkBlocked("a copyrighted release", "torbox")?.pattern).toBe("copyrighted");
    expect(checkBlocked("Forbidden 42")?.matchType).toBe("regex");
  });

  test("filters provider-specific checks and upgrades shared hits", () => {
    const entry = addBlocked("Shared Title", "realdebrid", "first");
    expect(checkBlocked("Shared Title", "torbox")).toBeNull();
    const updated = addBlocked("Shared Title", "torbox", "second");
    expect(updated.blockedBy).toBe("both");
    expect(updated.hitCount).toBe(2);
    expect(checkBlocked("Shared Title", "torbox")?.reason).toBe("second");
    expect(getBlocklistInfo().count).toBe(4);
    expect(removeBlocked(entry.id)).toBe(true);
    expect(removeBlocked(entry.id)).toBe(false);
  });
});
