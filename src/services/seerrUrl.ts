/**
 * Normalises a configured Seerr service URL to its API root.
 * Both a service root and an already-entered /api/v1 URL are accepted.
 */
export function seerrApiBaseUrl(value: string): string {
  const base = value.replace(/\/+$/, "");
  return base.endsWith("/api/v1") ? base : `${base}/api/v1`;
}
