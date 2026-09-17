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

Result: 10 tests passed, 0 failed. The three-input harness covers:

- A: historical fixture parsing and Movies/Shows classification with no write
  boundary;
- B: Seerr-shaped movie and TV fixtures routed to Radarr/Sonarr scan commands,
  authenticated and command-status polled through a fake HTTP transport;
- C: direct AllDebrid fixture event routed to Sonarr and considered complete
  only after Arr command status is successful.

The existing complete isolated suite also passes: 94 tests, 0 failures.

## Remaining blockers

1. Capture sanitized installed Arr API metadata or fixture traffic for the
   exact manual-import POST resource and its movie/episode candidate payload.
2. Add compose-level, non-provider fixture tests that exercise actual Seerr,
   Radarr, Sonarr, and media-server containers without real media/provider
   operations.
3. Add full Arr already-imported/duplicate response fixtures and verify Review
   UI persistence/resume across the compose stack.
4. The direct AllDebrid adapter remains fork/test-only and is not wired to any
   production runtime.
