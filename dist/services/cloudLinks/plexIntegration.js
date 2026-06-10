"use strict";
/**
 * SchroDrive — Plex Media Server Integration
 *
 * Provides automatic Plex library scan triggering after the cloud-links
 * bridge cache is warmed. Also supports auto-discovery of Plex on the
 * local network when env vars aren't explicitly set.
 *
 * @module cloudLinks/plexIntegration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.triggerPlexScan = triggerPlexScan;
exports.isPlexReachable = isPlexReachable;
const PLEX_LOG_PREFIX = '[cloud-links][plex]';
/**
 * Triggers a Plex library scan for the specified section IDs.
 * If no section IDs are provided, scans all sections.
 *
 * Uses PLEX_URL and PLEX_TOKEN environment variables.
 * Falls back to localhost:32400 for URL if not set.
 * Silently skips if no PLEX_TOKEN is configured.
 */
async function triggerPlexScan(sectionIds) {
    const plexUrl = (process.env.PLEX_URL || 'http://localhost:32400').replace(/\/+$/, '');
    const plexToken = process.env.PLEX_TOKEN;
    if (!plexToken) {
        console.log(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} No PLEX_TOKEN configured — skipping scan trigger`);
        return;
    }
    try {
        if (!sectionIds || sectionIds.length === 0) {
            // Discover all sections first
            sectionIds = await discoverPlexSections(plexUrl, plexToken);
            if (sectionIds.length === 0) {
                console.log(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} No Plex library sections found`);
                return;
            }
        }
        console.log(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Triggering Plex scan for ${sectionIds.length} section(s): ${sectionIds.join(', ')}`);
        for (const id of sectionIds) {
            try {
                const resp = await fetch(`${plexUrl}/library/sections/${id}/refresh?X-Plex-Token=${plexToken}`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(10000),
                });
                if (resp.ok) {
                    console.log(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Scan triggered for section ${id}`);
                }
                else {
                    console.warn(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Scan trigger failed for section ${id}: HTTP ${resp.status}`);
                }
            }
            catch (err) {
                console.warn(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Scan trigger error for section ${id}: ${err?.message}`);
            }
        }
    }
    catch (err) {
        console.error(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Plex scan trigger failed: ${err?.message}`);
    }
}
/**
 * Discovers all Plex library section IDs by querying the Plex API.
 * Returns an array of section key numbers.
 */
async function discoverPlexSections(plexUrl, plexToken) {
    try {
        const resp = await fetch(`${plexUrl}/library/sections?X-Plex-Token=${plexToken}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!resp.ok) {
            console.warn(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Failed to discover sections: HTTP ${resp.status}`);
            return [];
        }
        const xml = await resp.text();
        // Parse section keys from XML: key="1", key="2", etc.
        const keys = [];
        const keyRegex = /Directory[^>]*key="(\d+)"/g;
        let match;
        while ((match = keyRegex.exec(xml)) !== null) {
            keys.push(parseInt(match[1], 10));
        }
        console.log(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Discovered ${keys.length} Plex section(s): ${keys.join(', ')}`);
        return keys;
    }
    catch (err) {
        console.warn(`[${new Date().toISOString()}]${PLEX_LOG_PREFIX} Plex discovery failed: ${err?.message}`);
        return [];
    }
}
/**
 * Checks if Plex is reachable at the configured URL.
 * Returns true if Plex responds to an identity request.
 */
async function isPlexReachable() {
    const plexUrl = (process.env.PLEX_URL || 'http://localhost:32400').replace(/\/+$/, '');
    const plexToken = process.env.PLEX_TOKEN;
    if (!plexToken)
        return false;
    try {
        const resp = await fetch(`${plexUrl}/identity?X-Plex-Token=${plexToken}`, {
            signal: AbortSignal.timeout(5000),
        });
        return resp.ok;
    }
    catch {
        return false;
    }
}
