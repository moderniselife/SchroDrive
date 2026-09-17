/** Persistent review queue for Organizer identity decisions. */

import type { ParsedMediaIdentity } from "./mediaParser";
import { getDb } from "../core/db";

export type ReviewDecision = "pending" | "accepted" | "dismissed";

export interface OrganizerReviewEntry {
  id: string;
  sourcePath: string;
  sourceBasename: string;
  parsed: ParsedMediaIdentity;
  decision: ReviewDecision;
  createdAt: string;
  updatedAt: string;
  override?: ReviewOverride;
}

export interface ReviewOverride {
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  kind?: "movie" | "episode";
}

export function validateReviewOverride(value: unknown): ReviewOverride | undefined {
  if (value == null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("override must be an object");
  const input = value as Record<string, unknown>;
  const result: ReviewOverride = {};
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim().length < 1 || input.title.length > 300) {
      throw new Error("override.title must be a non-empty string of at most 300 characters");
    }
    result.title = input.title.trim();
  }
  for (const [key, min, max] of [["year", 1800, 2200], ["season", 0, 99], ["episode", 0, 9999]] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== "number" || !Number.isInteger(input[key]) || input[key] < min || input[key] > max) {
        throw new Error(`override.${key} is outside the supported range`);
      }
      result[key] = input[key];
    }
  }
  if (input.kind !== undefined) {
    if (input.kind !== "movie" && input.kind !== "episode") throw new Error("override.kind is invalid");
    result.kind = input.kind;
  }
  if (Object.keys(result).length === 0) throw new Error("override must contain a supported field");
  return result;
}

function keyFor(sourcePath: string): string {
  return Buffer.from(sourcePath).toString("base64url").slice(0, 48);
}

/** Returns the persisted review decision for one source path, if present. */
export function getOrganizerReview(sourcePath: string): OrganizerReviewEntry | undefined {
  return listOrganizerReviews(true).find((entry) => entry.id === keyFor(sourcePath));
}

function parseStoredJson<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(value) as T; }
  catch { return undefined; }
}

export function recordOrganizerReview(sourcePath: string, parsed: ParsedMediaIdentity): OrganizerReviewEntry {
  const id = keyFor(sourcePath);
  const now = new Date().toISOString();
  const database = getDb();
  const old = database.prepare("SELECT * FROM organizer_reviews WHERE id = ?").get(id) as any;
  const oldOverride = parseStoredJson<ReviewOverride>(old?.override_json);
  const entry: OrganizerReviewEntry = old
    ? { id, sourcePath: old.source_path, sourceBasename: old.source_basename, parsed, decision: old.decision, createdAt: old.created_at, updatedAt: now, ...(oldOverride ? { override: oldOverride } : {}) }
    : { id, sourcePath, sourceBasename: parsed.sourceBasename, parsed, decision: "pending", createdAt: now, updatedAt: now };
  database.prepare(`INSERT INTO organizer_reviews
    (id, source_path, source_basename, parsed_json, decision, override_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET parsed_json=excluded.parsed_json, updated_at=excluded.updated_at`).run(
    entry.id, entry.sourcePath, entry.sourceBasename, JSON.stringify(entry.parsed), entry.decision,
    entry.override ? JSON.stringify(entry.override) : null, entry.createdAt, entry.updatedAt,
  );
  database.prepare("INSERT INTO organizer_review_audit (review_id, action, payload_json, created_at) VALUES (?, ?, ?, ?)")
    .run(id, "recorded", JSON.stringify(parsed), now);
  return entry;
}

export function listOrganizerReviews(includeResolved = false, status?: ReviewDecision): OrganizerReviewEntry[] {
  const decision = status || (includeResolved ? undefined : "pending");
  const query = decision
    ? "SELECT * FROM organizer_reviews WHERE decision = ? ORDER BY updated_at DESC"
    : "SELECT * FROM organizer_reviews ORDER BY updated_at DESC";
  const rows = (decision ? getDb().prepare(query).all(decision) : getDb().prepare(query).all()) as any[];
  return rows.flatMap((row) => {
    const parsed = parseStoredJson<ParsedMediaIdentity>(row.parsed_json);
    if (!parsed) return [];
    const override = parseStoredJson<ReviewOverride>(row.override_json);
    return [{
      id: row.id, sourcePath: row.source_path, sourceBasename: row.source_basename,
      parsed, decision: row.decision,
      createdAt: row.created_at, updatedAt: row.updated_at,
      ...(override ? { override } : {}),
    }];
  });
}

export function decideOrganizerReview(
  id: string,
  decision: Exclude<ReviewDecision, "pending">,
  override?: ReviewOverride,
): OrganizerReviewEntry | undefined {
  const database = getDb();
  const row = database.prepare("SELECT * FROM organizer_reviews WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  const updatedAt = new Date().toISOString();
  const effectiveOverride = override || parseStoredJson<ReviewOverride>(row.override_json);
  database.prepare("UPDATE organizer_reviews SET decision = ?, override_json = ?, updated_at = ? WHERE id = ?")
    .run(decision, effectiveOverride ? JSON.stringify(effectiveOverride) : null, updatedAt, id);
  database.prepare("INSERT INTO organizer_review_audit (review_id, action, payload_json, created_at) VALUES (?, ?, ?, ?)")
    .run(id, decision, effectiveOverride ? JSON.stringify(effectiveOverride) : null, updatedAt);
  const updated: OrganizerReviewEntry = {
    id, sourcePath: row.source_path, sourceBasename: row.source_basename,
    parsed: parseStoredJson<ParsedMediaIdentity>(row.parsed_json) || { status: "unmatched", extension: "", sourceBasename: row.source_basename, confidence: 0, reason: "stored review record was malformed" }, decision, createdAt: row.created_at, updatedAt,
    ...(effectiveOverride ? { override: effectiveOverride } : {}),
  };
  return updated;
}

export function clearOrganizerReviews(): void {
  const database = getDb();
  database.exec("DELETE FROM organizer_review_audit; DELETE FROM organizer_reviews;");
}

export function listOrganizerReviewAudit(reviewId: string): Array<{
  action: string;
  payload?: unknown;
  createdAt: string;
}> {
  const rows = getDb().prepare("SELECT action, payload_json, created_at FROM organizer_review_audit WHERE review_id = ? ORDER BY id ASC").all(reviewId) as any[];
  return rows.map((row) => ({
    action: row.action,
    ...(parseStoredJson(row.payload_json) !== undefined ? { payload: parseStoredJson(row.payload_json) } : {}),
    createdAt: row.created_at,
  }));
}
