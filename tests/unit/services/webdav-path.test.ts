import { describe, expect, test } from "bun:test";
import { encodeWebDavPath } from "../../../src/services/webdavBridge";

describe("WebDAV multi-file path encoding", () => {
  test("preserves hierarchy for nested provider paths", () => {
    expect(encodeWebDavPath("Season 01/Episode.mkv")).toBe("Season%2001/Episode.mkv");
    expect(encodeWebDavPath("Season 01/Sub Dir/Episode #1.mkv"))
      .toBe("Season%2001/Sub%20Dir/Episode%20%231.mkv");
  });

  test("does not encode the internal separator as %2F", () => {
    expect(encodeWebDavPath("Season 01/Episode.mkv")).not.toContain("%2F");
  });
});
