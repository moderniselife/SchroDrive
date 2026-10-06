import { describe, expect, test } from "bun:test";
import { resolveRuntimeOrPersistedValue } from "../../../src/core/configApi";

describe("configuration loading", () => {
  test("uses a non-empty runtime value before persisted .env", () => {
    expect(resolveRuntimeOrPersistedValue("runtime", "persisted")).toBe("runtime");
  });

  test("uses persisted .env when Docker supplied an empty placeholder", () => {
    expect(resolveRuntimeOrPersistedValue("", "persisted")).toBe("persisted");
    expect(resolveRuntimeOrPersistedValue(undefined, "persisted")).toBe("persisted");
  });
});
