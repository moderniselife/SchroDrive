# CineCircle three-input architecture

Reviewed 2026-09-17 on the SchröDrive development branch. This note defines
the migration boundary: SchröDrive replaces DavDebrid’s source/provider role,
while Radarr/Sonarr remain responsible for metadata matching and import.

## Three distinct inputs

| Path | Owning flow | SchröDrive responsibility | Arr responsibility |
|---|---|---|---|
| A. Historical library import | Existing Riven/MediaBridge library and records | Read-only inventory, classification, identity projection, destination audit, and Review for unresolved cases | Confirm metadata/import behavior in an isolated fixture; no rewrite of existing media during migration |
| B. Normal request | Seerr → Radarr/Sonarr | qBittorrent-compatible provider/download lifecycle, categories, tracking, and completion visibility | Own request identity, search, metadata matching, completed-file import |
| C. Direct/manual intake (CineCircle fork) | SchröDrive in-process AllDebrid recent/full reconciliation | Diff stable file/tree snapshots, emit added/changed/deleted events, preserve Movies/Shows, persist/retry, and route to Arr REST API | Accept scan/manual-import command, match metadata, and import |

Path B must not enable SchröDrive’s optional Seerr poller when Seerr already
hands requests to Arr; that would create duplicate ownership. Path C is a
required CineCircle fork contract, not upstream PR material: the current Arr bridge is
primarily Arr → SchröDrive/qBittorrent-compatible intake, and the existing
organizer does not yet expose a provider-poll → Arr file/path adapter.

DavDebrid is removed from the final architecture. The private fork ports only
its useful polling, snapshot diff, file-tree filtering, and category concepts
into SchröDrive’s in-process AllDebrid reconciler. It must provide stable
deduplication/state, Movies/Shows classification, snapshot-derived changed
detection, correct Radarr/Sonarr routing, Arr-owned metadata matching/import,
retries, restart recovery, and Review handoff for unresolved cases. Its
configuration, docs, and tests remain fork-only; generic provider polling
remains future fallback scope. The required stage boundary is AllDebrid API →
SchröDrive internal event → Arr REST scan or manual import → command status
polling → persistent correlation/idempotency; provider visibility alone is
never completion.

## Evidence and boundaries

- Historical parser/import: `mediabridge-riven/src/media_parser.py`,
  `src/plex_parser_v2.py`, and `src/event_processor.py`.
- Historical source integration: `mediabridge-riven/docs/DAVDEBRID_INTEGRATION.md`.
- SchröDrive parsing/classification: `src/services/mediaParser.ts` and
  `src/core/mediaClassifier.ts`.
- SchröDrive organization and destination projection:
  `src/services/organizer.ts`.
- Arr/qBittorrent-compatible lifecycle: `src/services/arrBridge.ts`.
- Optional Seerr poller (not the normal Path B owner):
  `src/services/overseerr.ts`.

Metadata IDs and final import decisions remain downstream contracts. Review is
for unresolved normalization or matching cases only; it is not a normal-path
metadata service. DavDebrid removal is gated on acceptance of A, B, and C,
including the missing C adapter, with rollback to the saved Portainer stack
version documented separately.

## Validation status

The read-only parser benchmark covered 603 items: classification agreement was
603/603 (100.00%), 560 exact (92.87%), 13 acceptable normalization (2.16%),
and 30 mismatches (4.98%). These figures are summarized without media names,
paths, provider data, or IDs in `cinecircle-parser-comparison-2026-09-17.md`.
