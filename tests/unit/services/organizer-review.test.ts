import { describe, expect, test } from "bun:test";
import {
  clearOrganizerReviews,
  decideOrganizerReview,
  listOrganizerReviewAudit,
  listOrganizerReviews,
  recordOrganizerReview,
} from "../../../src/services/organizerReview";

const parsed = {
  status: "ambiguous" as const,
  kind: "movie" as const,
  title: "Example",
  extension: ".mkv",
  sourceBasename: "Example.mkv",
  confidence: 0.45,
  reason: "title heuristic without year",
};

describe("Organizer review queue", () => {
  test("deduplicates by source path and records a decision", () => {
    clearOrganizerReviews();
    const first = recordOrganizerReview("/mount/Example.mkv", parsed);
    const same = recordOrganizerReview("/mount/Example.mkv", parsed);
    expect(same.id).toBe(first.id);
    expect(listOrganizerReviews()).toHaveLength(1);

    const decided = decideOrganizerReview(first.id, "accepted", { title: "Example Film", year: 2024 });
    expect(decided?.decision).toBe("accepted");
    expect(listOrganizerReviews()).toHaveLength(0);
    expect(listOrganizerReviews(true)[0].override?.year).toBe(2024);
    expect(listOrganizerReviewAudit(first.id).map((item) => item.action)).toEqual(["recorded", "recorded", "accepted"]);
    clearOrganizerReviews();
  });

  test("returns undefined for an unknown review id", () => {
    clearOrganizerReviews();
    expect(decideOrganizerReview("missing", "dismissed")).toBeUndefined();
  });
});
