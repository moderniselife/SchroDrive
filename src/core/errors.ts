/**
 * SchroDrive — Custom Errors
 */

/**
 * Thrown when a torrent is permanently unplayable (e.g. RAR archive,
 * or files inside cannot be mapped to streamable debrid download links).
 */
export class UnplayableTorrentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnplayableTorrentError";
    // Set the prototype explicitly.
    Object.setPrototypeOf(this, UnplayableTorrentError.prototype);
  }
}
