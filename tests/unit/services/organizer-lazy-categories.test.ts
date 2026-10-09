import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { config } from "../../../src/core/config";
import { makeSymlink, organizeOnce } from "../../../src/services/organizer";

const originalMountBase = config.mountBase;
const originalOrganizedBase = config.organizedBase;
const originalProviders = [...config.providers];
const originalWebdavEnabled = config.webdavMountsEnabled;

afterEach(() => {
  config.mountBase = originalMountBase;
  config.organizedBase = originalOrganizedBase;
  config.providers = [...originalProviders];
  config.webdavMountsEnabled = originalWebdavEnabled;
});

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "schrodrive-organizer-categories-"));
}

describe("Organizer lazy category destinations", () => {
  test("missing organized root fails closed", async () => {
    const root = path.join(await tempDir(), "organized");
    config.mountBase = path.dirname(root);
    config.organizedBase = root;
    config.providers = [];
    config.webdavMountsEnabled = false;

    await expect(organizeOnce({ dryRun: false })).rejects.toThrow("organized root unavailable");
    await expect(fs.stat(root)).rejects.toThrow();
  });

  test("an absent unused category does not abort the scan", async () => {
    const root = await tempDir();
    config.mountBase = root;
    config.organizedBase = root;
    config.providers = [];
    config.webdavMountsEnabled = false;
    await organizeOnce({ dryRun: false });

    await expect(fs.stat(path.join(root, "Anime"))).rejects.toThrow();
  });

  test("creates a required generic category lazily", async () => {
    const root = await tempDir();
    const source = path.join(root, "source.mkv");
    const destination = path.join(root, "FutureCategory", "item.mkv");
    await fs.writeFile(source, "fixture");

    await makeSymlink(source, destination, false);

    expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true);
    expect(await fs.readlink(destination)).toBe(path.relative(path.dirname(destination), source));
  });

  test("dry-run does not create a required category", async () => {
    const root = await tempDir();
    const source = path.join(root, "source.mkv");
    const destination = path.join(root, "FutureCategory", "item.mkv");
    await fs.writeFile(source, "fixture");

    await makeSymlink(source, destination, true);

    await expect(fs.stat(path.dirname(destination))).rejects.toThrow();
    await expect(fs.stat(destination)).rejects.toThrow();
  });

  test("uses an existing generic category without changing it", async () => {
    const root = await tempDir();
    const category = path.join(root, "FutureCategory");
    const source = path.join(root, "source.mkv");
    const destination = path.join(category, "item.mkv");
    await fs.mkdir(category);
    await fs.writeFile(source, "fixture");

    await makeSymlink(source, destination, false);

    expect((await fs.lstat(category)).isDirectory()).toBe(true);
    expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true);
  });
});
