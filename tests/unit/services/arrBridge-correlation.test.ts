import { describe, expect, test } from "bun:test";
import { correlateProviderTorrent, normaliseTorrentName } from "../../../src/services/arrBridge";

function snapshot(provider: string, id: string, name: string, progress = 100) {
  return {
    provider,
    torrent: {
      id,
      name,
      status: "downloaded",
      progress,
      bytes: 100,
      files: [],
    },
  } as any;
}

describe("Arr bridge provider torrent correlation", () => {
  test("normalises release punctuation without dropping useful tokens", () => {
    expect(normaliseTorrentName("Twisted Metal S02 1080p")).toBe(
      normaliseTorrentName("Twisted.Metal.S02.1080p"),
    );
    expect(normaliseTorrentName("Show S02E05 2026")).toContain("s02e05");
  });

  test("provider ID wins even when names are unrelated", () => {
    const tracked = {
      name: "Arr display name",
      providerResults: [{ provider: "alldebrid", id: "12345", success: true }],
    };
    const result = correlateProviderTorrent(tracked, [
      snapshot("alldebrid", "12345", "Provider release with another name"),
    ]);
    expect(result?.torrent.id).toBe("12345");
  });

  test("uses normalised names when the provider ID is unavailable", () => {
    const result = correlateProviderTorrent({
      name: "Twisted Metal S02 1080p",
      providerResults: [{ provider: "alldebrid", id: "wrong", success: true }],
    }, [snapshot("alldebrid", "other", "Twisted.Metal.S02.1080p")]);
    expect(result?.torrent.id).toBe("other");
  });

  test("provider ID avoids an ambiguous similar-name match", () => {
    const result = correlateProviderTorrent({
      name: "Series S01 1080p",
      providerResults: [{ provider: "alldebrid", id: "right", success: true }],
    }, [
      snapshot("alldebrid", "wrong", "Series.S01.1080p"),
      snapshot("alldebrid", "right", "Completely different provider title"),
    ]);
    expect(result?.torrent.id).toBe("right");
  });

  test("searches the provider named by each successful result", () => {
    const result = correlateProviderTorrent({
      name: "Same Release",
      providerResults: [
        { provider: "realdebrid", id: "rd-1", success: true },
        { provider: "alldebrid", id: "ad-1", success: true },
      ],
    }, [
      snapshot("realdebrid", "wrong", "Same Release"),
      snapshot("alldebrid", "ad-1", "Different name"),
    ]);
    expect(result?.provider).toBe("alldebrid");
    expect(result?.torrent.id).toBe("ad-1");
  });

  test("ignores failed provider results", () => {
    const result = correlateProviderTorrent({
      name: "Failed Provider Release",
      providerResults: [{ provider: "alldebrid", id: "failed-id", success: false }],
    }, [snapshot("alldebrid", "failed-id", "Failed Provider Release")]);
    expect(result).toBeUndefined();
  });
});
