import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getConfigWithSources, saveConfigToFile } from "../../../src/core/configApi";

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
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
