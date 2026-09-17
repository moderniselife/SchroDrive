# Three-input classification-first E2E plan

This is the cinecircle-test validation plan for removing DavDebrid’s source
role. Tests are isolated, read-only with respect to production, and use fake
or fixture provider responses. Review is exercised only for unresolved cases.
The direct-provider adapter described below is CineCircle-specific fork scope,
not upstream PR material.

## A — historical library import

1. Freeze a fixture inventory representing existing Riven library records and
   paths; do not scan or rewrite the production library.
2. Run the historical `media_parser.parse` contract and SchröDrive parser and
   classifier in shadow mode.
3. Assert film/series classification, title/year, season/episode, and
   collision/idempotency projections. Assert no provider, Riven DB, sidecar,
   rename, or import writes.
4. Route only intentionally ambiguous identities to Review and assert a
   resolved Review decision changes the projection without changing source
   files.

Relevant existing coverage: `tests/unit/services/mediaParser.test.ts`,
`tests/unit/services/organizer-filename.test.ts`, and
`tests/unit/services/organizer-review.test.ts`. A dedicated fixture-based
historical-import E2E remains to be added.

## B — normal Seerr → Radarr/Sonarr request

1. Submit a fixture request to isolated Seerr and assert the request reaches
   the selected Arr instance with its identity intact.
2. Have Arr call SchröDrive’s qBittorrent-compatible API and assert category,
   URL/multipart handling, tracking, and restart recovery.
3. Complete a fake download and let Arr perform metadata matching and import;
   assert SchröDrive does not duplicate Arr matching or import ownership.
4. Assert no optional SchröDrive Seerr poller is enabled for this path.

Existing coverage is `tests/e2e/cinecircle-three-inputs.test.ts`,
`tests/e2e/arr-bridge/qbittorrent-api.test.ts`,
`tests/e2e/arr-bridge/categories.test.ts`,
`tests/e2e/arr-bridge/restart-recovery.test.ts`, and
`tests/unit/services/arrBridge-correlation.test.ts`. A full isolated
Seerr-to-Arr chain test remains to be added.

## C — direct/manual AllDebrid intake (CineCircle fork only)

1. Reconcile AllDebrid’s read-only `POST /v4.1/magnet/status` listing. For
   completed items, read the recursive file tree through the existing
   `POST /v4/magnet/files` integration. No upload, delete, unlock, or provider
   mutation is part of this path.
2. Emit a direct-file event containing provider item ID, `added`/`changed`/
   `deleted` action, Arr-visible path and tree, Movies/Shows category,
   observed timestamp, and stable dedupe key.
3. Persist item fingerprint, event key, Arr route, command ID, attempt count,
   and terminal result. Reconcile missing status-list IDs as deleted; do not
   treat an in-progress status as deleted.
4. Route Movies to Radarr and Shows to Sonarr. Submit the Arr REST command
   (`DownloadedMoviesScan` or `DownloadedEpisodesScan`) with the Arr-visible
   path, poll `/api/v3/command/<id>`, and require successful Arr processing
   before marking the event complete. Permanent failures and ambiguous or
   unmatched parses go to Review.
5. Assert add/change/delete, missed-round reconciliation, duplicate delivery,
   retry, restart recovery, already-imported behavior, and both Arr routes.
   Use dry-run fixtures only; do not perform real provider operations.

Implementation: `src/services/cinecircleAlldebridIntake.ts` and
`tests/e2e/cinecircle-alldebrid-intake.test.ts`. This is CineCircle-specific
fork scope, not upstream PR material. Generic multi-provider polling is future
fallback scope. The current adapter is intentionally not wired to production;
full compose-level Arr import and Review UI validation remain blockers.

## Commands and acceptance gate

Run the existing isolated suite without the live-service integration test:

```text
docker run --rm --network none --entrypoint bun \
  -e DATA_DIR=/tmp/schro-test-data -e ALLDEBRID_API_KEY= \
  -e RUN_WEBHOOK=false -e RUN_POLLER=false -e RUN_WATCHLIST_POLLER=false \
  -e RUN_MOUNT=false -e ARR_BRIDGE_ENABLED=true \
  -v "$PWD:/app:ro" oven/bun:1.4.2 \
  test --timeout 15000 /app/tests/unit /app/tests/e2e /app/tests/regressions
```

The fixture-only three-input harness is
`tests/e2e/cinecircle-three-inputs.test.ts`; it exercises the historical
parser/classifier boundary, Seerr-shaped movie/TV requests into both Arr scan
commands, and the direct AllDebrid event through Arr command completion. It
does not contact Seerr, AllDebrid, Arr, media servers, or production.

Use the repository’s parser harness references in
`cinecircle-parser-provenance-2026-09-17.md`; both harnesses must consume one
frozen manifest and stay shadow-only. Acceptance requires A, B, and C,
including the C adapter, plus the existing 603-item benchmark summary. Only
then may a separate authorization gate approve a Portainer production
cutover; without explicit authorization, no Portainer save/redeploy, DNS
change, or production action is permitted.
