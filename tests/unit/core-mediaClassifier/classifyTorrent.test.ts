import { describe, expect, test } from "bun:test";
import {
  classifyTorrent,
  filterByCategory,
  isMediaView,
  onlyBiggestFile,
} from "../../../src/core/mediaClassifier";

describe("media classification", () => {
  test("prioritises anime CRC releases over show episode markers", () => {
    expect(classifyTorrent("[SubsPlease] One Piece S01E01 [AB12CD34].mkv")).toBe("anime");
    expect(classifyTorrent("Anime Collection", ["Season 1/01 [AB12CD34].mkv"])).toBe("anime");
  });

  test("recognises common show naming formats", () => {
    for (const name of ["The Bear S2E3", "Planet Earth 1x01", "Show Complete Series", "Show Season 1"]) {
      expect(classifyTorrent(name)).toBe("shows");
    }
  });

  test("uses movies as the safe catch-all", () => {
    expect(classifyTorrent("Inception 2010 1080p BluRay")).toBe("movies");
  });

  test("filters entries without changing their object identity", () => {
    const movie = { name: "Arrival 2016" };
    const show = { name: "Severance S01E01" };
    expect(filterByCategory([movie, show], "movies")).toEqual([movie]);
    expect(filterByCategory([movie, show], "movies")[0]).toBe(movie);
  });

  test("validates media views and keeps only the largest file", () => {
    expect(isMediaView("__all__")).toBe(true);
    expect(isMediaView("music")).toBe(false);
    const files = [{ name: "sample.mkv", size: 5 }, { name: "movie.mkv", size: 100 }, { name: "sub.srt", size: 10 }];
    expect(onlyBiggestFile(files)).toEqual([files[1]]);
    expect(onlyBiggestFile([files[0]])).toEqual([files[0]]);
  });
});
