import fs from "fs";
import os from "os";
import path from "path";
import { config } from "../../../src/core/config";
import { evaluateMountReadiness } from "../../../src/services/mount";
import { organizeOnce } from "../../../src/services/organizer";

const mountInfoFor = (mountPath: string) => `42 24 0:42 / ${mountPath.replace(/ /g, "\\\\040")} rw,relatime - fuse.rclone rclone rw`;

describe("shared mount readiness guard", () => {
  test("ready mountpoint with a responding non-empty filesystem is ready", async () => {
    const result = await evaluateMountReadiness(["/mnt/media"], {
      platform: "linux",
      mountInfo: mountInfoFor("/mnt/media"),
      readDir: async () => ["provider"],
    });
    expect(result).toEqual({ ready: true, reason: "ready" });
  });

  test("existing directory without a mount entry is not ready", async () => {
    const result = await evaluateMountReadiness(["/mnt/media"], {
      platform: "linux",
      mountInfo: "42 24 0:42 / /mnt rw,relatime - ext4 /dev/sda rw",
      readDir: async () => ["provider"],
    });
    expect(result.reason).toBe("not-mounted");
  });

  test("empty observed mount is ready, while unavailable mount is fail-closed", async () => {
    const empty = await evaluateMountReadiness(["/mnt/media"], {
      platform: "linux",
      mountInfo: mountInfoFor("/mnt/media"),
      readDir: async () => [],
    });
    const unavailable = await evaluateMountReadiness(["/mnt/media"], {
      platform: "linux",
      mountInfo: mountInfoFor("/mnt/media"),
      readDir: async () => { throw new Error("EIO"); },
    });
    expect(empty).toEqual({ ready: true, reason: "ready" });
    expect(unavailable.reason).toBe("unavailable");
  });

  test("a later successful probe becomes ready and no longer fails closed", async () => {
    let available = false;
    const probe = {
      platform: "linux" as const,
      mountInfo: mountInfoFor("/mnt/media"),
      readDir: async () => available ? ["provider"] : [],
    };
    expect((await evaluateMountReadiness(["/mnt/media"], probe)).ready).toBe(true);
    available = true;
    expect((await evaluateMountReadiness(["/mnt/media"], probe)).ready).toBe(true);
  });

  test("organizer does not prune when the configured provider mount is not ready", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "schrodrive-mount-guard-"));
    const organized = path.join(temp, "organized");
    const provider = path.join(temp, "provider");
    fs.mkdirSync(path.join(organized, "Movies"), { recursive: true });
    fs.mkdirSync(provider, { recursive: true });
    const stale = path.join(organized, "Movies", "stale.mkv");
    fs.symlinkSync(path.join(provider, "missing.mkv"), stale);

    const original = {
      organizedBase: config.organizedBase,
      mountBase: config.mountBase,
      providers: config.providers,
      runMount: config.runMount,
    };
    try {
      config.organizedBase = organized;
      config.mountBase = temp;
      config.providers = ["provider"];
      config.runMount = true;
      await organizeOnce();
      expect(fs.lstatSync(stale).isSymbolicLink()).toBe(true);
    } finally {
      config.organizedBase = original.organizedBase;
      config.mountBase = original.mountBase;
      config.providers = original.providers;
      config.runMount = original.runMount;
      fs.rmSync(temp, { recursive: true, force: true });
    }
  });

  test("non-mount-dependent empty input has no mount guard failure", async () => {
    await expect(evaluateMountReadiness([])).resolves.toEqual({ ready: true, reason: "ready" });
  });

  test("ready and unavailable provider mounts are evaluated independently", async () => {
    const statuses = await Promise.all([
      evaluateMountReadiness(["/mnt/ready"], {
        platform: "linux",
        mountInfo: mountInfoFor("/mnt/ready"),
        readDir: async () => [],
      }),
      evaluateMountReadiness(["/mnt/unavailable"], {
        platform: "linux",
        mountInfo: mountInfoFor("/mnt/unavailable"),
        readDir: async () => { throw new Error("EIO"); },
      }),
    ]);
    expect(statuses[0].ready).toBe(true);
    expect(statuses[1].ready).toBe(false);
  });
});
