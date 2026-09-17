# CineCircle fork review material

Local-only, sanitized review material for the CineCircle fork. This is not a
pull request, has not been pushed, and contains no media names, real paths,
provider records, identifiers, secrets, manifests, or runtime databases.

## Scope

- Keep generic SchröDrive fixes separate from the CineCircle fork.
- Add the AllDebrid-specific internal polling/reconciliation worker only in the
  fork: recent/full status and tree reads, persistent snapshot diff,
  added/changed/deleted events, Movies/Shows classification, deduplication,
  retry, restart recovery, subtitle-tree retention, and Review handoff.
- Route detected Movies to Radarr and Shows to Sonarr through the Arr command
  boundary. Arr remains responsible for metadata matching and import.
- Keep DavDebrid and its outbound webhook out of the final architecture.

## Validation evidence

- Three-input isolated harness: 13 passing tests.
- Full isolated repository suite: 105 passing tests, 0 failures, 234
  assertions across 19 files.
- Review UI/API report: `docs/review-validation-report.md`.
- Detailed fork validation: `docs/cinecircle-three-inputs-validation-2026-09-17.md`.
- Test compose wiring: `/home/samtruman/docker/cinecircle-test/compose.yml`,
  with `RUN_WEBHOOK=true` for the optional Seerr inbound route. The AllDebrid
  path is internal polling and does not use that route or a provider webhook.

## Reproducible commands

```text
docker run --rm --network none --entrypoint bun \
  -e DATA_DIR=/tmp/schro-test-data -e ALLDEBRID_API_KEY= \
  -e RUN_WEBHOOK=false -e RUN_POLLER=false \
  -e RUN_WATCHLIST_POLLER=false -e RUN_MOUNT=false \
  -e ARR_BRIDGE_ENABLED=true \
  -v /home/samtruman/src/schrodrive:/app:ro oven/bun:1.4.2 \
  test --timeout 15000 /app/tests/unit /app/tests/e2e /app/tests/regressions
```

The runtime Seerr route probe uses the test container with `RUN_WEBHOOK=true`,
temporary database storage, and all provider/indexer operations unconfigured;
the expected fixture response is HTTP 503 before any external work. No
production deployment, DNS change, Portainer save, provider operation, or
push is part of this material.

## Remaining authorization gates

Before any production action, the owner must authorize a Portainer-only edit,
confirm the candidate image and real data mounts, verify a recoverable backup,
save the current Portainer stack version, and explicitly authorize the
redeploy. Rollback must use the saved Portainer version. Until then this fork
material remains local and non-deployable.
