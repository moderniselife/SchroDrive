import { describe, expect, test } from "bun:test";
import { buildMagnetFromHash, stripTmdbQuery } from "../../../src/indexers/shared";

describe("indexer shared helpers", () => {
  test("strips TMDB suffixes without losing the title", () => {
    expect(stripTmdbQuery("The Matrix 1999 TMDB12345")).toBe("The Matrix 1999");
    expect(stripTmdbQuery("  The Matrix   1999   TMDB999  ")).toBe("The Matrix 1999");
  });

  test("builds magnet URIs for both hex and base32 hashes", () => {
    expect(buildMagnetFromHash("aabbccddeeff00112233445566778899aabbccdd", "Movie Title")).toBe(
      "magnet:?xt=urn:btih:AABBCCDDEEFF00112233445566778899AABBCCDD&dn=Movie%20Title",
    );
    expect(buildMagnetFromHash("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ")).toBe(
      "magnet:?xt=urn:btih:GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    );
  });

  test("returns undefined for invalid hashes", () => {
    expect(buildMagnetFromHash("not-a-valid-hash")).toBeUndefined();
  });
});
