/**
 * SchroDrive — Shared Utilities
 *
 * Common helper functions used across multiple modules. Extracted to
 * eliminate duplication — these were previously copy-pasted in 13+ files.
 *
 * @module core/utils
 */

/**
 * Sanitises a string for use as a filesystem path component.
 * Removes or replaces characters that are problematic on common filesystems
 * (Windows NTFS, macOS HFS+, Linux ext4).
 *
 * @param name - The raw name to sanitise.
 * @returns A filesystem-safe string.
 */
export function sanitiseName(name: string): string {
  return name
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/_+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    || 'unnamed';
}

/**
 * Splits a comma-delimited environment variable into a clean string array.
 *
 * @param value - Raw env value, e.g. "a,b, c"
 * @param options - Optional trimming/lowercasing and empty-item filtering
 */
export function splitCsv(
  value: string | undefined | null,
  options: { trim?: boolean; lowerCase?: boolean; dropEmpty?: boolean } = {},
): string[] {
  const { trim = true, lowerCase = false, dropEmpty = true } = options;
  if (value == null) return [];

  return value
    .split(',')
    .map((part) => (trim ? part.trim() : part))
    .map((part) => (lowerCase ? part.toLowerCase() : part))
    .filter((part) => !dropEmpty || part.length > 0);
}

/**
 * Parses a boolean-like env value with a sensible fallback.
 */
export function asBool(value: string | undefined | null, fallback = false): boolean {
  if (value == null) return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

/**
 * Parses a numeric env value with a fallback when invalid.
 */
export function asNumber(value: string | undefined | null, fallback: number): number {
  if (value == null) return fallback;

  const trimmed = value.trim();
  if (trimmed === '') return fallback;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Returns a promise that resolves after the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Decodes an RFC4648 base32 string to hex (upper-case).
 * Used to normalise magnet info-hashes that are 32-char base32 (160-bit)
 * into the canonical 40-char hex representation.
 *
 * Returns null if the input contains non-base32 characters or does not
 * decode to exactly 20 bytes (32-char base32 → 160-bit).
 *
 * @param b32 - Base32 string (with or without padding, case-insensitive).
 * @returns Upper-case hex string or null on invalid input.
 */
export function base32ToHex(b32: string): string | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const upper = b32.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of upper) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  // 32-char base32 must decode to exactly 20 bytes (160-bit infohash)
  if (bytes.length !== 20) return null;
  return Buffer.from(bytes).toString('hex').toUpperCase();
}
