import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { browseMountedFilesystem, FilesystemBrowserError } from "../../../src/core/filesystemBrowser";

let fixtureDir = "";

afterEach(async () => {
  if (fixtureDir) {
    await fs.rm(fixtureDir, { recursive: true, force: true });
    fixtureDir = "";
  }
});

async function fixture(): Promise<string> {
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), "schrodrive-files-"));
  await fs.mkdir(path.join(fixtureDir, "Directory"));
  await fs.writeFile(path.join(fixtureDir, "movie.mkv"), "fixture");
  return fixtureDir;
}

describe("mounted filesystem browser", () => {
  test("lists directories before files using asynchronous filesystem operations", async () => {
    const root = await fixture();
    const result = await browseMountedFilesystem(root, "/");

    expect(result.type).toBe("directory");
    if (result.type !== "directory") throw new Error("Expected directory result");
    expect(result.items.map((item) => item.name)).toEqual(["Directory", "movie.mkv"]);
    expect(result.items[1].size).toBe(7);
  });

  test("returns file metadata", async () => {
    const root = await fixture();
    const result = await browseMountedFilesystem(root, "/movie.mkv");

    expect(result.type).toBe("file");
    if (result.type !== "file") throw new Error("Expected file result");
    expect(result.name).toBe("movie.mkv");
    expect(result.size).toBe(7);
  });

  test("rejects paths outside the mount", async () => {
    const root = await fixture();
    await expect(browseMountedFilesystem(root, "../../etc/passwd"))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<FilesystemBrowserError>);
  });

  test("reports a missing path", async () => {
    const root = await fixture();
    await expect(browseMountedFilesystem(root, "/missing.mkv"))
      .rejects.toMatchObject({ status: 404 } satisfies Partial<FilesystemBrowserError>);
  });
});
