# Three-input validation report

Read-only/fork-test validation, 2026-09-17. No production, DNS, Portainer,
AllDebrid, Seerr, Arr, or media-server state was mutated.

## Arr contract probes

Using the running isolated test services with redacted `X-Api-Key` values,
read-only `GET` probes returned HTTP 200 for both Radarr and Sonarr:

- `/api/v3/system/status`
- `/api/v3/movie` (Radarr) and `/api/v3/series` (Sonarr)
- `/api/v3/rootfolder`
- `/api/v3/qualityprofile`
- `/api/v3/command`
- `/api/v3/manualimport`

The command collection emitted `id`, `name`/`commandName`, `status`, `result`,
queue and timing fields. The installed `/api-docs` page is available, but the
probed OpenAPI/Swagger JSON URLs return 404. No POST was sent to Arr, so exact
manual-import selection payload fields remain a blocker and are not guessed.

The fork fixture validates the non-mutating HTTP contract: `X-Api-Key`,
`POST /api/v3/command` with `DownloadedMoviesScan` or
`DownloadedEpisodesScan`, `path`, and `importMode`, followed by
`GET /api/v3/command/<id>` until `completed`/successful or failure.

## Fork adapter validation

The CineCircle-only worker is implemented in
`src/services/cinecircleAlldebridIntake.ts` and is not started by the normal
application entry point. It uses the existing SchröDrive AllDebrid client:
recent reconciliation bounds directory requests to the newest items, while a
full reconciliation fetches all completed trees. The worker persists item,
event, and recent/full cursor state in dedicated SQLite tables, emits stable
added/changed/deleted events, retries Arr submission, and polls pending Arr
commands after restart. Failed snapshots do not advance deletion state.

The event tree deliberately retains the video and its association files. The
explicitly tested extensions are `.srt`, `.ass`, `.ssa`, `.sub`, and `.vtt`,
plus compatible subtitle attachments `.idx`, `.sup`, `.sbv`, and `.mpsub`.
Unsupported files are filtered out without mutating the provider tree.

The direct adapter test file contains 9 passing tests covering recent/full
source calls, Movies/Radarr and Shows/Sonarr routing, add/change/delete,
deduplication, dry-run, retry, restart recovery, and subtitle-tree retention.
All provider and Arr interactions in these tests are mocked.

## Fixture E2E results

Command:

```text
docker run --rm --network none --entrypoint bun \
  -e DATA_DIR=/tmp/schro-test-data -e ALLDEBRID_API_KEY= \
  -v "$PWD:/app:ro" oven/bun:1.4.2 \
  test --timeout 15000 \
  /app/tests/e2e/cinecircle-three-inputs.test.ts \
  /app/tests/e2e/cinecircle-alldebrid-intake.test.ts
```

Result: 12 tests passed, 0 failed across the two fork harnesses. The
three-input harness covers:

- A: historical fixture parsing and Movies/Shows classification with no write
  boundary;
- B: Seerr-shaped movie and TV fixtures routed to Radarr/Sonarr scan commands,
  authenticated and command-status polled through a fake HTTP transport;
- C: direct AllDebrid fixture event routed to Sonarr and considered complete
  only after Arr command status is successful.

The complete isolated suite also passes: 100 tests, 0 failures, 218
expectations across 18 files. It ran in Docker with `--network none`, with the
repository mounted read-only and provider/service integrations disabled; no
real AllDebrid, Riven, Arr, Seerr, or production calls were made.

Focused TypeScript compilation of the changed provider, worker, and fork tests
also passes. `git diff --check` is required before commit.

## Remaining blockers

1. Capture sanitized installed Arr API metadata or fixture traffic for the
   exact manual-import POST resource and its movie/episode candidate payload.
2. Add compose-level, non-provider fixture tests that exercise actual Seerr,
   Radarr, Sonarr, and media-server containers without real media/provider
   operations.
3. Add full Arr already-imported/duplicate response fixtures and verify Review
   UI persistence/resume across the compose stack.
4. The direct AllDebrid adapter remains fork/test-only and is not wired to any
   production runtime. Compose-level wiring and a real Review persistence
   boundary remain intentionally out of scope for this validation step.
