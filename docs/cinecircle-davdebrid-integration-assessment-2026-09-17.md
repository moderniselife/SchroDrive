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

## Correct integration proposal

Use DavDebrid as the AllDebrid integration owner during the CineCircle fork
transition:

1. Add a fork-only DavDebrid webhook consumer to SchröDrive. Accept and
   authenticate the configured endpoint, validate `event`, `event_id`, file
   ID, category, media type, and timestamp, then map each file to the existing
   direct-file event contract.
2. Use `event_id + file.id + action` as the primary dedupe key, retaining the
   DavDebrid file ID as provider correlation. Do not re-poll AllDebrid for
   every webhook.
3. Route `new_files` to classification-preserving Arr scan/manual-import,
   poll Arr command status, persist correlation, and require Arr success before
   completion. Route `deleted_files` to state reconciliation only; never issue
   destructive Arr or provider operations automatically.
4. Run a low-frequency read-only reconciliation against DavDebrid’s protected
   `/api/source-snapshot` to recover missed webhooks and detect same-ID file
   changes. Emit `changed` only when the sanitized file fingerprint changes.
5. Keep the current direct AllDebrid status/files source as a disabled fallback
   test harness, not as a second production detector. Generic multi-provider
   polling remains future scope.

This reuses DavDebrid’s existing AllDebrid polling, cache, classification, and
retry behavior while preserving SchröDrive’s required Arr handoff and Review
state machine. It also keeps DavDebrid removable later: once webhook/snapshot
consumption and Arr E2E pass, the provider polling owner can be replaced by the
fork consumer without running two detectors.

## Remaining blockers

- A webhook consumer endpoint and authenticated private-network contract are
  not yet implemented in SchröDrive.
- DavDebrid currently has no `changed` event; snapshot fingerprinting is
  required for that case.
- The live local OpenAPI JSON for Arr is unavailable, so exact manual-import
  payload capture remains a separate blocker.
- No production configuration or Portainer change is authorized by this note.
