# DavDebrid fork integration assessment

Read-only comparison performed 2026-09-17 against the running `davdebrid`
container and the matching local fork source. No container, provider,
production, DNS, or Portainer state was changed.

## Evidence from the real container

| Component | Observed evidence |
|---|---|
| Runtime | Container command `node src/index.js`; image `samtruman/davdebrid-plexparser:latest` |
| Local source | `docker/cinecircle/tools/davdebrid-plexparser/src/lib/debrid/alldebrid.js` and `src/lib/davdebrid.js` |
| AllDebrid listing | `getRecentFiles()` and `getFiles()` call `GET /v4.1/magnet/status`, then `GET /v4/magnet/files`; auth is Bearer API key |
| Current intervals | Container environment has recent check 30 seconds and full check 300 seconds; code enforces minimums and runs the watcher at recent interval + 1 when Plex credentials are configured |
| Persistent detector state | Cache key `debridFiles:<userHash>` and recent-check key in the persistent SQLite cache database |
| Classification | `src/lib/fileOrganizer.js` + `src/lib/mediaClassifier.js`; only video/subtitle files are included and categories are `Movies` or `Shows` |
| Webhook configuration | Running container is configured with `new_files` and `deleted_files` subscribers; delivery is outbound HTTP from DavDebrid |

The watcher calls `updatePlexOnChange()`, which calls the cached private
`#getFiles()`. The first successful full listing creates the baseline and emits
no changes. After that, the cache path works as follows:

1. Recent check: status/files for the first 30 magnets; newly unseen file IDs
   emit `new_files`.
2. Full check after the all-file cache expires: status/files for all magnets;
   set difference by file ID emits both `new_files` and `deleted_files`.
3. A failed webhook delivery leaves the old snapshot eligible for retry on the
   next check. A successful delivery advances the cached snapshot.

This confirms periodic polling, recent/full snapshot detection, and deleted
file detection. It is not a provider push feed.

## Webhook contract

The fork’s `src/lib/webhook.js` sends:

```text
POST <configured consumer URL>
Content-Type: application/json
X-DavDebrid-Event: new_files | deleted_files
X-DavDebrid-Event-ID: sha256(event + sorted file IDs)
```

The JSON shape is:

```json
{
  "event": "new_files",
  "event_id": "<stable event hash>",
  "timestamp": "<ISO timestamp>",
  "source": "AD",
  "files": [
    {
      "id": "<stable DavDebrid file ID>",
      "name": "<basename>",
      "size": 0,
      "type": "video",
      "category": "Movies"
    }
  ]
}
```

`deleted_files` uses the same file shape and `category` values. Subtitles may
be included with video; non-media files are filtered out. The README and code
state that delivery is successful for any 2xx response, the response body is
ignored, and failed deliveries are retried. Event IDs and headers are not
authentication credentials; the consumer must use a private network or an
additional authenticated ingress.

The optional read-only `GET /api/source-snapshot` endpoint, protected by its
configured Bearer token, returns the current classified media manifest with
stable file ID, name, type, category, size, and parent metadata. It bypasses
the detector cache and does not emit webhooks, making it suitable for an
independent reconciliation pass.

## Duplication analysis

The new `cinecircleAlldebridIntake.ts` currently duplicates the lower half of
DavDebrid’s pipeline:

- it calls AllDebrid status and completed file-tree APIs again;
- it independently decides when an item is visible and removed;
- it independently classifies Movies versus Shows;
- it maintains a second event/state/deduplication model.

The direct adapter also has a different identity granularity: it keys on the
AllDebrid magnet and tree fingerprint, while DavDebrid emits stable file IDs.
Running both as active detectors would create duplicate API polling and could
submit duplicate Arr scans. The direct adapter’s `changed` event has no direct
DavDebrid equivalent because DavDebrid diffs only file IDs.

## Correct final integration proposal

DavDebrid must be removed from the final system. Its runtime is not the target
control plane and no SchröDrive production component should consume its
webhook or source-snapshot endpoint. The technically useful behavior is to be
ported into SchröDrive’s CineCircle fork:

1. Reuse the concept of a persisted current snapshot, a bounded recent scan,
   a periodic full scan, and diff-by-stable-file identity. Use SchröDrive’s
   existing current AllDebrid API client and rate limiting rather than copying
   DavDebrid’s older HTTP implementation.
2. Reuse useful file-tree flattening and video/subtitle filtering. Align its
   Movies/Shows classifier with the existing fork contract and keep
   classification as an internal event field, not an external DavDebrid
   dependency.
3. Convert diffs directly into SchröDrive internal `added`, `changed`, and
   `deleted` events. `changed` is a fork improvement based on a file/tree
   fingerprint because DavDebrid only emits new/deleted ID differences.
4. Route added/changed events to the correct Arr REST scan/manual-import stage,
   poll command status, persist correlation/idempotency, retry transient
   failures, and send permanent failures to Review. Deleted events update
   state only and never trigger destructive provider or Arr actions.
5. Retain the existing direct adapter as the implementation seam and test
   fixture, then replace its current source wiring with the in-process
   SchröDrive AllDebrid reconciler. Generic multi-provider polling remains
   future fallback scope.

This ports useful DavDebrid behavior without keeping its container, service,
webhook, cache, or source-snapshot API in the final system. It avoids duplicate
polling and preserves SchröDrive’s required Arr and Review boundaries.

## Remaining blockers

- The in-process fork reconciler is not yet wired into SchröDrive’s runtime;
  the current source is a test-only seam.
- DavDebrid currently has no `changed` event; snapshot fingerprinting is
  required for that case.
- The live local OpenAPI JSON for Arr is unavailable, so exact manual-import
  payload capture remains a separate blocker.
- A migration test must prove that the final stack has no DavDebrid service or
  webhook dependency before cutover.
- No production configuration or Portainer change is authorized by this note.
