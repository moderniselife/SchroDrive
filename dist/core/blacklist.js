"use strict";
/**
 * SchroDrive — Torrent Blacklist
 *
 * Persistent blacklist of torrent hashes/names that have been flagged as dead.
 * Prevents the system from re-adding the same broken torrent after deletion.
 *
 * Stored as a JSON file on disk so it persists across container restarts.
 * The file path is configurable via BLACKLIST_PATH env var.
 *
 * @module blacklist
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBlacklist = loadBlacklist;
exports.addToBlacklist = addToBlacklist;
exports.isBlacklisted = isBlacklisted;
exports.getBlacklistEntries = getBlacklistEntries;
exports.getBlacklistCount = getBlacklistCount;
exports.removeFromBlacklist = removeFromBlacklist;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("./config");
const db_1 = require("./db");
// ===========================================================================
// Blacklist Store
// ===========================================================================
const OLD_BLACKLIST_PATH = "/tmp/schrodrive/blacklist.json";
const BLACKLIST_PATH = process.env.BLACKLIST_PATH || path.join(config_1.config.dataDir, 'blacklist.json');
/** In-memory blacklist set (normalised lowercase names). */
let blacklistSet = new Set();
/** Full blacklist entries for persistence. */
let blacklistEntries = [];
/**
 * Loads the blacklist from disk. Safe to call multiple times —
 * silently creates an empty list if the file doesn't exist.
 */
function loadBlacklist() {
    try {
        // Auto-migrate from old /tmp path if the new path doesn't exist but the old one does
        if (!fs.existsSync(BLACKLIST_PATH) && fs.existsSync(OLD_BLACKLIST_PATH)) {
            console.log(`[${new Date().toISOString()}][blacklist] Migrating from ${OLD_BLACKLIST_PATH} to ${BLACKLIST_PATH}`);
            const dir = path.dirname(BLACKLIST_PATH);
            if (!fs.existsSync(dir))
                fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(OLD_BLACKLIST_PATH, BLACKLIST_PATH);
        }
        if (fs.existsSync(BLACKLIST_PATH)) {
            const raw = fs.readFileSync(BLACKLIST_PATH, "utf8");
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error("Blacklist file is empty or not an array");
            }
            blacklistEntries = parsed;
            blacklistSet = new Set(blacklistEntries.map((e) => e.name.toLowerCase()));
            console.log(`[${new Date().toISOString()}][blacklist] Loaded ${blacklistSet.size} entries from ${BLACKLIST_PATH}`);
        }
        else {
            console.log(`[${new Date().toISOString()}][blacklist] No blacklist file found, starting empty`);
        }
    }
    catch (e) {
        console.warn(`[${new Date().toISOString()}][blacklist] Failed to load from file: ${e?.message}`);
        // Attempt recovery from SQLite backup
        try {
            const recovered = (0, db_1.recoverBlacklistFromDb)();
            if (recovered.length > 0) {
                blacklistEntries = recovered;
                blacklistSet = new Set(blacklistEntries.map((e) => e.name.toLowerCase()));
                console.log(`[${new Date().toISOString()}][blacklist] Recovered ${recovered.length} entries from SQLite backup`);
                // Re-save the recovered data to the JSON file
                saveBlacklist();
            }
            else {
                console.warn(`[${new Date().toISOString()}][blacklist] No entries in SQLite backup, starting empty`);
            }
        }
        catch (dbErr) {
            console.warn(`[${new Date().toISOString()}][blacklist] SQLite recovery also failed: ${dbErr?.message}`);
        }
    }
}
/**
 * Saves the current blacklist to disk.
 */
function saveBlacklist() {
    try {
        const dir = path.dirname(BLACKLIST_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(BLACKLIST_PATH, JSON.stringify(blacklistEntries, null, 2), "utf8");
    }
    catch (e) {
        console.error(`[${new Date().toISOString()}][blacklist] failed to save: ${e?.message}`);
    }
}
/**
 * Adds a torrent name to the blacklist.
 *
 * @param name - The torrent name to blacklist.
 * @param reason - Why it was blacklisted.
 * @param provider - Which provider flagged it.
 */
function addToBlacklist(name, reason, provider) {
    const normalised = name.toLowerCase();
    if (blacklistSet.has(normalised))
        return; // Already blacklisted
    blacklistSet.add(normalised);
    const entry = {
        name,
        reason,
        provider,
        blacklistedAt: new Date().toISOString(),
    };
    blacklistEntries.push(entry);
    saveBlacklist();
    // Backup to SQLite for disaster recovery
    try {
        (0, db_1.backupBlacklistEntry)(name, reason, provider, Date.now(), JSON.stringify(entry));
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}][blacklist] SQLite backup failed: ${err?.message}`);
    }
    console.log(`[${new Date().toISOString()}][blacklist] Added: "${name}" (${reason})`);
}
/**
 * Checks if a torrent name is blacklisted.
 *
 * Uses normalised bi-directional substring matching — if the blacklisted
 * name is a substring of the candidate (or vice versa), it's a match.
 * This handles cases where torrents have slightly different naming.
 *
 * @param name - The torrent name to check.
 * @returns `true` if the name matches a blacklisted entry.
 */
function isBlacklisted(name) {
    const normalised = name.toLowerCase();
    // Exact match
    if (blacklistSet.has(normalised))
        return true;
    // Substring match (both directions)
    for (const entry of blacklistSet) {
        if (normalised.includes(entry) || entry.includes(normalised)) {
            return true;
        }
    }
    return false;
}
/**
 * Returns all current blacklist entries.
 */
function getBlacklistEntries() {
    return [...blacklistEntries];
}
/**
 * Returns the number of blacklisted entries.
 */
function getBlacklistCount() {
    return blacklistSet.size;
}
/**
 * Removes an entry from the blacklist by name.
 *
 * @param name - The exact torrent name to remove.
 * @returns `true` if the entry was found and removed.
 */
function removeFromBlacklist(name) {
    const normalised = name.toLowerCase();
    if (!blacklistSet.has(normalised))
        return false;
    blacklistSet.delete(normalised);
    blacklistEntries = blacklistEntries.filter((e) => e.name.toLowerCase() !== normalised);
    saveBlacklist();
    console.log(`[${new Date().toISOString()}][blacklist] removed: "${name}"`);
    return true;
}
