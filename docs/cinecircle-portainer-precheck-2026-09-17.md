# Portainer production cutover precheck

Read-only snapshot taken 2026-09-17. No Portainer mutating endpoint, service
restart, rebuild, deployment, DNS change, or unrelated-service change was
performed.

## Control plane and stack

- Portainer endpoint: `https://127.0.0.1:9443`
- Portainer version: `2.33.2`
- Unauthenticated status endpoint: HTTP 200. Read-only stack/endpoints API
  probes returned HTTP 401; no authentication token was used.
- Production stack: `cinecircle`, inferred from Docker Compose labels.
- Portainer stack ID/source: `77`, `/data/compose/77/docker-compose.yml`
  inside the Portainer data volume.
- Compose source SHA-256: `5a47f4aff3834107a8efd6d63ce3c3be456563b663204a4ea36adb210f811bae`
- Source was copied from the Portainer container to `/tmp` for read-only
  inspection; it was not edited or used for deployment.
- Source services: `cinecircle-parser`, `cinecircle-webhook`,
  `davdebrid-plexparser`, `jellyfin`, `pelagica`, `plex`, `prowlarr`,
  `rclone-davdebrid`, `rdtclient`, `riven`, `riven-db`, `riven-frontend`,
  `seerr`, `tautulli`, and `watchstate`.

## SchröDrive production target

- SchröDrive service: **not present** in the Portainer `cinecircle` stack.
- Production SchröDrive container: **not found**; only `schrodrive-test` was
  present among matching containers.
- Current production SchröDrive image digest: **N/A**.
- Production SchröDrive health/status: **N/A**.
- Production SchröDrive published ports: **N/A**.
- Production SchröDrive redacted environment names: **N/A**.
- Production SchröDrive bind/volume paths and data mount: **N/A**.
- Precheck result: **BLOCKED before authorization** until the intended
  SchröDrive service and real production data mount are identified and saved
  in Portainer.

The existing production stack does contain Riven and related services, but
they are not treated as a SchröDrive service or a cutover target.

## Current production stack observations

The Portainer-managed services were running during inspection. Relevant
published ports included Riven `127.0.0.1:8088→8080` and
`127.0.0.1:8092→8090`, Riven frontend `3000→3000`, Plex `32400→32400`,
Jellyfin `8096→8096`, Prowlarr `9696→9696`, and Seerr
`127.0.0.1:5055→5055`. These were observed only and not changed.

Observed production bind/volume examples from the Portainer source included
`/home/samtruman/docker/cinecircle/riven/data`,
`/home/samtruman/docker/cinecircle/riven/db`, `/mnt/riven`,
`/mnt/debrid/alldebrid`, and the Portainer-managed `davdebrid_data` volume.
None is identified as a SchröDrive data mount.

## Redacted environment inventory

The Portainer source was inspected for names only; values were not copied
into this report. The stack’s environment names include `TZ`, `PUID`, `PGID`,
`DATA_FOLDER`, `DEBRID_ID`, `DEBRID_API_KEY`, `PLEX_URL`,
`PLEX_TOKEN`, `JELLYFIN_URL`, `JELLYFIN_API_KEY`, `RIVEN_DATABASE_HOST`,
`BRIDGE_DATABASE_URL`, `MODERN_PARSER_URL`, `RIVEN_MANUAL_API_URL`,
`RIVEN_SYMLINK_RCLONE_PATH`, `RIVEN_SYMLINK_LIBRARY_PATH`, `TMDB_MAPPING`,
`BACKEND_URL`, `DATABASE_URL`, `WEBHOOK_HOST`, `WEBHOOK_PORT`,
`WEBHOOK_QUEUE_DB`, `WEBHOOK_QUEUE_WORKERS`, `PGDATA`, `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, and `ORIGIN`.

There is no SchröDrive-specific production environment block to record.

## Storage and backup readiness

- `/home/samtruman/docker/cinecircle`: 229G total, 181G used, 39G free,
  83% used.
- `/mnt/riven`: on the same 229G filesystem, 39G free, 83% used.
- `/mnt/debrid/alldebrid`: WebDAV mount reported 1.0P available by `df`.
- Portainer data is mounted at `/data` inside Portainer; its host volume path
  was not accessed directly.
- A real SchröDrive production data directory and backup were not found,
  because no production SchröDrive service/mount exists in this stack.
- Backup readiness: **not ready for authorization**. The operator must first
  identify the production SchröDrive data mount in Portainer and create/verify
  a recoverable backup before any edit or redeploy.

## Candidate comparison

- Candidate image: `schrodrive:cinecircle-review-blocker`
- Candidate digest: `sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8`
- Test tag points to the same digest; `schrodrive-test` was running and
  healthy.
- Test-only ports: API `8979`, GUI `8980`, host bridge `8981`; internal Arr
  bridge remains `schrodrive-test:8282`.
- Recorded gates: Docker backend/web build passed; 88 tests passed with 0
  failures; existing E2E passed 13/13; Review GUI/API matrix passed.
- Candidate comparison: **test gates pass**, but production cutover remains
  **not authorized and not actionable** until Portainer has an identified
  SchröDrive service, data mount, backup, and saved rollback version.

## Proposed Portainer editor diff

The read-only proposal is in
[`cinecircle-portainer-stack-proposal.md`](cinecircle-portainer-stack-proposal.md).
It identifies `davdebrid-plexparser`, `rclone-davdebrid`, and `rdtclient` as
conditional direct-overlap replacements, while retaining Riven, its frontend,
parser, webhook, request/indexer, and media services pending explicit owner
decisions. It maps the existing `cinecircle_default` network, ports, and
bind/volume paths and drafts a SchröDrive service pinned to candidate digest
`sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8`.

The proposal is intentionally non-deployable: the production SchröDrive
service name, real `/mnt/schrodrive`, `/data`, and `/config` sources, provider
values, Arr/state migration, GUI host port, and Portainer image reference
resolution are blockers. It was not saved in Portainer and no production
state was changed.

## Stop point

This precheck stops here. Do not edit/save/redeploy the Portainer stack until
the explicit final production authorization gate in
[`cinecircle-cutover-plan.md`](cinecircle-cutover-plan.md) is recorded.
