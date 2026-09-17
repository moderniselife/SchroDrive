import { describe, expect, test } from "bun:test";
import { normalizeMediaTitle, parseMediaFilename, scoreMediaCandidates, selectMediaCandidate } from "../../../src/services/mediaParser";

describe("structured media parser", () => {
  test.each([
    ["The Conversation (1974).mkv", "movie", "The Conversation", 1974],
    ["Dune.Part.Two.2024.ITA.2160p.WEB-DL.HEVC.mkv", "movie", "Dune Part Two", 2024],
    ["Atomic.S01E03-E04.ITA.1080p.WEB-DL.mkv", "episode", "Atomic", undefined],
    ["The.Bear.S02E01E02.1080p.WEB-DL.mkv", "episode", "The Bear", undefined],
    ["The.Boys.3x02.1080p.WEB-DL.mkv", "episode", "The Boys", undefined],
    ["One.Piece - 1100.mkv", "anime-episode", "One Piece", undefined],
  ])("parses %s", (filename, kind, title, year) => {
    const parsed = parseMediaFilename(filename);
    expect(parsed.status).toBe("matched");
    expect(parsed.kind).toBe(kind);
    expect(parsed.title).toBe(title);
    if (year) expect(parsed.year).toBe(year);
  });

  test("keeps release basename and nested source path separate", () => {
    const parsed = parseMediaFilename(
      "Show.Name.S01E02-03.[Group].mkv",
      "/mount/__all__/release/Season 01/Show.Name.S01E02-03.[Group].mkv",
    );
    expect(parsed.sourceBasename).toBe("Show.Name.S01E02-03.[Group].mkv");
    expect(parsed.season).toBe(1);
    expect(parsed.episode).toBe(2);
    expect(parsed.episodeEnd).toBe(3);
  });

  test("does not treat a four digit movie year as an anime episode", () => {
    const parsed = parseMediaFilename("Davos.1917.2160p.HDR.mkv");
    expect(parsed.kind).toBe("movie");
    expect(parsed.title).toBe("Davos");
    expect(parsed.year).toBe(1917);
  });

  test("parses a numeric movie title followed by its release year", () => {
    const parsed = parseMediaFilename("1917.2019.PROPER.1080p.BluRay.x265-RARBG.mp4");
    expect(parsed.status).toBe("matched");
    expect(parsed.kind).toBe("movie");
    expect(parsed.title).toBe("1917");
    expect(parsed.year).toBe(2019);
  });

  test("reports an ambiguous path-only identity", () => {
    const parsed = parseMediaFilename("Episode.mkv", "/mount/shows/Example Show/Season 01/Episode.mkv");
    expect(parsed.status).toBe("ambiguous");
    expect(parsed.title).toBe("Example Show");
  });

  test("normalizes punctuation for deterministic candidate scoring", () => {
    expect(normalizeMediaTitle("The.Boys — S03")).toBe("theboyss03");
    const scored = scoreMediaCandidates(
      { title: "The.Boys", year: 2019, kind: "episode" },
      [
        { id: "wrong", title: "The Boy", kind: "show", year: 2019 },
        { id: "right", title: "The Boys", kind: "show", year: 2019 },
      ],
    );
    expect(scored[0].id).toBe("right");
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  test("selects an exact metadata candidate and rejects a close tie", () => {
    const exact = selectMediaCandidate(
      { title: "Atomic", year: 2025, kind: "episode" },
      [
        { id: "2", title: "Atomic", kind: "show", year: 2025 },
        { id: "1", title: "Atomic", kind: "show", year: 2024 },
      ],
    );
    expect(exact.status).toBe("matched");
    expect(exact.candidate?.id).toBe("2");

    const ambiguous = selectMediaCandidate(
      { title: "The Office", kind: "episode" },
      [
        { id: "1", title: "The Office", kind: "show" },
        { id: "2", title: "The Office", kind: "show" },
      ],
    );
    expect(ambiguous.status).toBe("ambiguous");
  });

  test("returns unmatched when no identity can be inferred", () => {
    expect(parseMediaFilename("1080p.REPACK.mkv").status).toBe("unmatched");
  });

  test.each([
    ["Movie.Without.Year.1080p.mkv", "ambiguous"],
    ["Show.S03E07.mkv", "matched"],
    ["Film.2023.mkv", "matched"],
    ["clip.txt", "ambiguous"],
  ])("classifies edge case %s as %s", (filename, status) => {
    expect(parseMediaFilename(filename).status).toBe(status);
  });

  test("keeps matching deterministic for ties and accented titles", () => {
    const parsed = parseMediaFilename("Citta.Violenta.1970.ITA.mkv");
    const ranked = scoreMediaCandidates(parsed, [
      { id: "b", title: "Città Violenta", kind: "movie", year: 1970 },
      { id: "a", title: "Citta Violenta", kind: "movie", year: 1970 },
    ]);
    expect(ranked.map((candidate) => candidate.id)).toEqual(["a", "b"]);
    expect(selectMediaCandidate(parsed, ranked).status).toBe("ambiguous");
  });
});
