import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { makeSymlink, resolveCollisionTarget } from "../../../src/services/organizer";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "schrodrive-organizer-collision-"));
  temporaryRoots.push(root);
  const sources = path.join(root, "sources");
  const organized = path.join(root, "organized");
  await fs.mkdir(sources, { recursive: true });
  await fs.mkdir(organized, { recursive: true });
  return { root, sources, organized };
}

describe("Organizer collision safety", () => {
  test("preserves both versions with a deterministic alternate target", async () => {
    const { sources, organized } = await fixture();
    const first = path.join(sources, "release-a.mkv");
    const second = path.join(sources, "release-b.mkv");
    const canonical = path.join(organized, "Movie (2025).mkv");
    await fs.writeFile(first, "a");
    await fs.writeFile(second, "b");
    await makeSymlink(first, canonical, false);

    const alternate = await resolveCollisionTarget(second, canonical);
    await makeSymlink(second, alternate, false);

    expect(await fs.readlink(canonical)).toBe(path.relative(path.dirname(canonical), first));
    expect(await fs.readlink(alternate)).toBe(path.relative(path.dirname(alternate), second));
    expect(path.basename(alternate)).toMatch(/^Movie \(2025\) - [a-f0-9]{8}\.mkv$/);
    expect(await resolveCollisionTarget(second, canonical)).toBe(alternate);
    await makeSymlink(second, alternate, false);
    expect(await fs.readlink(alternate)).toBe(path.relative(path.dirname(alternate), second));
  });

  test("is order-independent when sources are processed deterministically", async () => {
    const { sources, organized } = await fixture();
    const inputs = [path.join(sources, "release-b.mkv"), path.join(sources, "release-a.mkv")];
    await Promise.all(inputs.map((file, index) => fs.writeFile(file, String(index))));
    const canonical = path.join(organized, "Movie (2025).mkv");

    for (const source of [...inputs].sort((a, b) => a.localeCompare(b))) {
      const target = await resolveCollisionTarget(source, canonical);
      await makeSymlink(source, target, false);
    }

    const sorted = [...inputs].sort((a, b) => a.localeCompare(b));
    expect(await fs.readlink(canonical)).toBe(path.relative(path.dirname(canonical), sorted[0]));
    expect((await fs.readdir(organized)).sort()).toEqual([
      "Movie (2025) - " + createHash("sha1").update(sorted[1]).digest("hex").slice(0, 8) + ".mkv",
      "Movie (2025).mkv",
    ].sort());
  });

  test("is idempotent and does not replace real files or directories", async () => {
    const { sources, organized } = await fixture();
    const source = path.join(sources, "release.mkv");
    const canonical = path.join(organized, "Movie (2025).mkv");
    await fs.writeFile(source, "source");
    await fs.writeFile(canonical, "keep");
    await makeSymlink(source, canonical, false);
    expect(await fs.readFile(canonical, "utf8")).toBe("keep");

    const directory = path.join(organized, "Directory (2025).mkv");
    await fs.mkdir(directory);
    await makeSymlink(source, directory, false);
    expect((await fs.stat(directory)).isDirectory()).toBe(true);
  });

  test("does not destroy an existing valid symlink", async () => {
    const { sources, organized } = await fixture();
    const source = path.join(sources, "release.mkv");
    const canonical = path.join(organized, "Movie (2025).mkv");
    await fs.writeFile(source, "source");
    await makeSymlink(source, canonical, false);
    await makeSymlink(source, canonical, false);
    expect(await fs.readlink(canonical)).toBe(path.relative(path.dirname(canonical), source));
  });
});
