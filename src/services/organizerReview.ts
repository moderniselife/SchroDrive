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
  override?: {
    title?: string;
    year?: number;
    season?: number;
    episode?: number;
    kind?: "movie" | "episode";
  };
}

function keyFor(sourcePath: string): string {
  return Buffer.from(sourcePath).toString("base64url").slice(0, 48);
}

export function recordOrganizerReview(sourcePath: string, parsed: ParsedMediaIdentity): OrganizerReviewEntry {
  const id = keyFor(sourcePath);
  const now = new Date().toISOString();
  const database = getDb();
  const old = database.prepare("SELECT * FROM organizer_reviews WHERE id = ?").get(id) as any;
  const entry: OrganizerReviewEntry = old
    ? { id, sourcePath: old.source_path, sourceBasename: old.source_basename, parsed, decision: old.decision, createdAt: old.created_at, updatedAt: now, ...(old.override_json ? { override: JSON.parse(old.override_json) } : {}) }
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

export function listOrganizerReviews(includeResolved = false): OrganizerReviewEntry[] {
  const rows = getDb().prepare(includeResolved
    ? "SELECT * FROM organizer_reviews ORDER BY updated_at DESC"
    : "SELECT * FROM organizer_reviews WHERE decision = 'pending' ORDER BY updated_at DESC").all() as any[];
  return rows.map((row) => ({
    id: row.id, sourcePath: row.source_path, sourceBasename: row.source_basename,
    parsed: JSON.parse(row.parsed_json), decision: row.decision,
    createdAt: row.created_at, updatedAt: row.updated_at,
    ...(row.override_json ? { override: JSON.parse(row.override_json) } : {}),
  }));
}

export function decideOrganizerReview(
  id: string,
  decision: Exclude<ReviewDecision, "pending">,
  override?: OrganizerReviewEntry["override"],
): OrganizerReviewEntry | undefined {
  const database = getDb();
  const row = database.prepare("SELECT * FROM organizer_reviews WHERE id = ?").get(id) as any;
  if (!row) return undefined;
  const updatedAt = new Date().toISOString();
  const effectiveOverride = override || (row.override_json ? JSON.parse(row.override_json) : undefined);
  database.prepare("UPDATE organizer_reviews SET decision = ?, override_json = ?, updated_at = ? WHERE id = ?")
    .run(decision, effectiveOverride ? JSON.stringify(effectiveOverride) : null, updatedAt, id);
  database.prepare("INSERT INTO organizer_review_audit (review_id, action, payload_json, created_at) VALUES (?, ?, ?, ?)")
    .run(id, decision, effectiveOverride ? JSON.stringify(effectiveOverride) : null, updatedAt);
  const updated: OrganizerReviewEntry = {
    id, sourcePath: row.source_path, sourceBasename: row.source_basename,
    parsed: JSON.parse(row.parsed_json), decision, createdAt: row.created_at, updatedAt,
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
    ...(row.payload_json ? { payload: JSON.parse(row.payload_json) } : {}),
    createdAt: row.created_at,
  }));
}
