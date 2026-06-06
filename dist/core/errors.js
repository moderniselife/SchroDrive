"use strict";
/**
 * SchroDrive — Custom Errors
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnplayableTorrentError = void 0;
/**
 * Thrown when a torrent is permanently unplayable (e.g. RAR archive,
 * or files inside cannot be mapped to streamable debrid download links).
 */
class UnplayableTorrentError extends Error {
    constructor(message) {
        super(message);
        this.name = "UnplayableTorrentError";
        // Set the prototype explicitly.
        Object.setPrototypeOf(this, UnplayableTorrentError.prototype);
    }
}
exports.UnplayableTorrentError = UnplayableTorrentError;
