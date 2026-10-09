import { describe, expect, test } from "bun:test";
import { seerrApiBaseUrl } from "../../../src/services/seerrUrl";

describe("Seerr API URL normalization", () => {
  test("accepts a service root and appends the API root", () => {
    expect(seerrApiBaseUrl("http://seerr.example.test")).toBe("http://seerr.example.test/api/v1");
  });

  test("does not duplicate an existing API root", () => {
    expect(seerrApiBaseUrl("http://seerr.example.test/api/v1/")).toBe("http://seerr.example.test/api/v1");
  });
});
