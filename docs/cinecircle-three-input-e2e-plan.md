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

Existing coverage is `tests/e2e/arr-bridge/qbittorrent-api.test.ts`,
`tests/e2e/arr-bridge/categories.test.ts`,
`tests/e2e/arr-bridge/restart-recovery.test.ts`, and
`tests/unit/services/arrBridge-correlation.test.ts`. A full isolated
Seerr-to-Arr chain test remains to be added.

## C — direct/Prowlarr/AllDebrid intake

1. Feed a fixture provider snapshot or Prowlarr result to the polling adapter;
   do not perform a real provider operation.
2. Assert SchröDrive detects the item once, classifies Movies versus Shows,
   selects the appropriate Arr, and submits a file/path handoff.
3. Assert Arr performs metadata matching and import, with retry/idempotency
   and Review only for unresolved normalization/matching.
4. Assert no duplicate import, provider mutation, rename, or sidecar write.

This path is currently a blocker: `arrBridge.ts` covers Arr-to-SchröDrive
download lifecycle, while `organizer.ts` does not yet expose the required
provider-poll-to-Arr file/path adapter. The CineCircle fork must add and test
the adapter with stable deduplication/state, provider new-file polling,
classification, Arr routing, retries, restart recovery, Arr-owned metadata
matching/import, and Review handoff for unmatched or ambiguous items. Keep
these adapter/configuration/docs/tests in the fork; add generic SchröDrive
improvements upstream separately. Do not claim DavDebrid removal before this
contract passes.

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

Use the repository’s parser harness references in
`cinecircle-parser-provenance-2026-09-17.md`; both harnesses must consume one
frozen manifest and stay shadow-only. Acceptance requires A, B, and C,
including the C adapter, plus the existing 603-item benchmark summary. Only
then may a separate authorization gate approve a Portainer production
cutover; without explicit authorization, no Portainer save/redeploy, DNS
change, or production action is permitted.
