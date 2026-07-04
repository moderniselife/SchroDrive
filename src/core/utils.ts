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
 * Returns a promise that resolves after the specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
