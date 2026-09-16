import { describe, expect, test } from "bun:test";
import { refreshRcloneMount } from "../../../src/services/mount";

describe("targeted rclone mount refresh", () => {
  test("is a safe no-op when the mount has no RC endpoint", async () => {
    expect(await refreshRcloneMount("alldebrid", "__all__/release")).toBe(false);
  });
});
