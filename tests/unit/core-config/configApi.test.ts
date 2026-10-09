import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfigWithSources, saveConfigToFile } from "../../../src/core/configApi";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe("configuration provenance", () => {
  test("marks a real container environment value as locked", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schrodrive-config-"));
    const envPath = path.join(tempDir, ".env");
    fs.writeFileSync(envPath, "TMDB_API_KEY=persisted-key\n");
    const previous = process.env.TMDB_API_KEY;
    process.env.TMDB_API_KEY = "container-key";

    try {
      const result = getConfigWithSources({ envPath, containerEnvKeys: new Set(["TMDB_API_KEY"]) });
      expect(result.config.TMDB_API_KEY.value).toBe("container-key");
      expect(result.config.TMDB_API_KEY.provenance).toBe("CONTAINER_ENV");
      expect(result.config.TMDB_API_KEY.locked).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.TMDB_API_KEY;
      else process.env.TMDB_API_KEY = previous;
    }
  });

  test("marks a persisted-only value as editable", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schrodrive-config-"));
    const envPath = path.join(tempDir, ".env");
    fs.writeFileSync(envPath, "TMDB_API_KEY=persisted-secret\n");

    const result = getConfigWithSources({ envPath, containerEnvKeys: new Set() });
    expect(result.config.TMDB_API_KEY.value).toBe("persisted-secret");
    expect(result.config.TMDB_API_KEY.provenance).toBe("PERSISTED_DOTENV");
    expect(result.config.TMDB_API_KEY.locked).toBe(false);
  });

  test("marks an absent value as an editable default", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schrodrive-config-"));
    const result = getConfigWithSources({ envPath: path.join(tempDir, ".env"), containerEnvKeys: new Set() });
    expect(result.config.TMDB_API_KEY.value).toBe("");
    expect(result.config.TMDB_API_KEY.provenance).toBe("DEFAULT");
    expect(result.config.TMDB_API_KEY.locked).toBe(false);
  });
});

describe("configuration persistence", () => {
  test("persists canonical Seerr keys and preserves an existing secret on partial save", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "schrodrive-config-"));
    process.chdir(tempDir);
    fs.writeFileSync(path.join(tempDir, ".env"), "SEERR_API_KEY=existing-secret\nTMDB_API_KEY=existing-tmdb\n");

    const result = saveConfigToFile({ SEERR_URL: "http://seerr:5055", SEERR_AUTH: "" });
    expect(result.success).toBe(true);

    const persisted = fs.readFileSync(path.join(tempDir, ".env"), "utf8");
    expect(persisted).toContain("SEERR_URL=http://seerr:5055");
    expect(persisted).toContain("SEERR_API_KEY=existing-secret");
    expect(persisted).not.toContain("OVERSEERR_URL");
    expect(getConfigWithSources().config.SEERR_URL.value).toBe("http://seerr:5055");
    expect(getConfigWithSources().config.SEERR_API_KEY.value).toBe("existing-secret");
  });
});
