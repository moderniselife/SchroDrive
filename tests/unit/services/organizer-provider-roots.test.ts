import { describe, expect, test } from "bun:test";
import path from "path";
import { providerMediaKey, selectProviderRoots } from "../../../src/services/organizer";

function directory(name: string): any {
  return {
    name,
    isDirectory: () => true,
    isFile: () => false,
  };
}

describe("provider root selection", () => {
  test("scans category roots and excludes aggregate aliases", () => {
    const base = "/mnt/provider";
    expect(selectProviderRoots(base, [
      directory("__all__"),
      directory("movies"),
      directory("shows"),
      directory("custom"),
    ])).toEqual([
      path.join(base, "movies"),
      path.join(base, "shows"),
      path.join(base, "custom"),
    ]);
  });

  test("uses __all__ only as a legacy fallback", () => {
    const base = "/mnt/provider";
    expect(selectProviderRoots(base, [directory("__all__")])).toEqual([
      path.join(base, "__all__"),
    ]);
  });

  test("uses links and then the provider root as legacy fallbacks", () => {
    const base = "/mnt/provider";
    expect(selectProviderRoots(base, [directory("links")])).toEqual([
      path.join(base, "links"),
    ]);
    expect(selectProviderRoots(base, [])).toEqual([base]);
  });
});

describe("provider alias identity", () => {
  test("uses the complete media path instead of a basename", () => {
    const base = "/mnt";
    const provider = path.join(base, "provider");
    const first = providerMediaKey(base, path.join(provider, "__all__", "movies", "Same Title", "movie.mkv"));
    const second = providerMediaKey(base, path.join(provider, "__all__", "shows", "Same Title", "episode.mkv"));

    expect(first).toBe(path.join("Same Title", "movie.mkv"));
    expect(second).toBe(path.join("Same Title", "episode.mkv"));

    const category = providerMediaKey(base, path.join(provider, "movies", "Same Title", "movie.mkv"));
    const aggregate = providerMediaKey(base, path.join(provider, "__all__", "movies", "Same Title", "movie.mkv"));
    expect(category).toBe(aggregate);
  });
});
