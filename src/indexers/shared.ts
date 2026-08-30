export function stripTmdbQuery(query: string): string {
  const cleaned = String(query || "").slice(0, 200);
  return cleaned.replace(/\s*TMDB\d+\b/gi, "").replace(/\s{2,}/g, " ").trim();
}

export function buildMagnetFromHash(hash: string, title?: string): string | undefined {
  const trimmed = hash.trim();
  const hex40 = /^[a-fA-F0-9]{40}$/;
  const b32 = /^[A-Z2-7]{32,39}$/i;
  if (!hex40.test(trimmed) && !b32.test(trimmed)) return undefined;

  const hashUpper = trimmed.toUpperCase();
  const dn = title ? `&dn=${encodeURIComponent(title)}` : "";
  return `magnet:?xt=urn:btih:${hashUpper}${dn}`;
}
