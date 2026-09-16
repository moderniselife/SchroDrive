import { afterEach, describe, expect, test } from "bun:test";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { config } from "../../../src/core/config";
import {
  computeTarget,
  makeSymlink,
  selectOrganizerFilename,
  type Parsed,
} from "../../../src/services/organizer";

const movie: Parsed = { type: "movie", title: "Example Film", year: 2024, ext: ".mkv" };
const episode: Parsed = { type: "tv", show: "Example Show", season: 1, episode: 2, ext: ".mkv" };

describe("Organizer filename mode", () => {
  test("defaults to canonical and keeps explicit canonical output unchanged", () => {
    expect(config.organizerFilenameMode).toBe("canonical");
    const target = computeTarget(movie, "Example.Film.2024.1080p.WEB-DL.mkv", "/mount/release/file.mkv");
    expect(target).toEndWith("/Movies/Example Film (2024)/Example Film (2024).mkv");
    expect(selectOrganizerFilename("canonical", "Example Film (2024).mkv", "release.mkv"))
      .toBe("Example Film (2024).mkv");
  });

  test("preserves the original basename for a single-file movie", () => {
    const target = computeTarget(
      movie,
      "Example.Film.2024.1080p.WEB-DL.ITA-ENG.mkv",
      "/mount/__all__/Example.Film.2024.1080p.WEB-DL.ITA-ENG.mkv",
      "original",
    );
    expect(target).toEndWith(
      "/Movies/Example Film (2024)/Example.Film.2024.1080p.WEB-DL.ITA-ENG.mkv",
    );
  });

  test("preserves original basenames for multi-file episodes", () => {
    const target = computeTarget(
      episode,
      "Example.Show.S01E02.1080p.WEB-DL.ITA-ENG.mkv",
      "/mount/__all__/Release/Season 01/Example.Show.S01E02.1080p.WEB-DL.ITA-ENG.mkv",
      "original",
    );
    expect(target).toEndWith(
      "/TV/Example Show/Season 01/Example.Show.S01E02.1080p.WEB-DL.ITA-ENG.mkv",
    );
    expect(target).not.toContain("Season 01/Season 01");
  });

  test("preserves punctuation and extension from the source basename", () => {
    expect(selectOrganizerFilename("original", "Canonical.mkv", "[Group] Title - 01 (Final).MP4"))
      .toBe("[Group] Title - 01 (Final).MP4");
  });

  test("does not silently replace a different original-mode symlink collision", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "schro-organizer-"));
    try {
      const destination = path.join(root, "organized", "same.mkv");
      const first = path.join(root, "source-a.mkv");
      const second = path.join(root, "source-b.mkv");
      await makeSymlink(first, destination, false, true);
      await makeSymlink(second, destination, false, true);
      expect(await fs.readlink(destination)).toBe(path.relative(path.dirname(destination), first));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
