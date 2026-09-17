# SchröDrive production cutover plan

This plan is documentation only. Portainer is the sole production control
plane. Do not use, edit, or deploy from an external production compose file.
No fork, PR, production change, DNS change, or unrelated-service change is
authorized by this document.

The current Portainer stack is `cinecircle` (stack ID `77`), managed at
`https://127.0.0.1:9443`. Its compose source is retained inside Portainer at
`/data/compose/77/docker-compose.yml`. The current stack source contains no
`schrodrive` service, so the target service and production data mount must be
resolved in Portainer before any cutover can be authorized.

## 1. Read-only prechecks

In Portainer, inspect the `cinecircle` stack and record:

1. The exact production service name to change. Do not infer it from a test
   container or add a new production service during precheck.
2. The current SchröDrive image digest, container status/health, published
   ports, redacted environment variable names, bind mounts/volumes, and the
   real data mount. Confirm the mount is not a test path.
3. The saved Portainer stack version that represents the rollback point.
   Confirm it can be restored from Portainer before editing anything.
4. Free space on the data and Portainer storage paths, plus the location and
   recoverability of a backup/snapshot of the real SchröDrive data.
5. The candidate digest and test evidence: valid test compose, healthy
   `schrodrive-test`, 88 passing tests, 13 passing existing E2E tests, and
   passing Review GUI/API matrix on test ports `8979`, `8980`, and `8981`.
6. Confirm the final candidate stack contains no `davdebrid` or
   `davdebrid-plexparser` service and no external DavDebrid webhook or
   source-snapshot dependency. AllDebrid polling, snapshot diff,
   classification, and internal events must be owned by SchröDrive.

The Portainer API may be used for authenticated read-only inspection only.
Never use a mutating API endpoint during precheck. Do not change DNS or
restart, recreate, rebuild, or stop any service.

### Current pre-cutover status

The recorded precheck is in
`docs/cinecircle-portainer-precheck-2026-09-17.md`. It found Portainer stack
`cinecircle` (ID `77`) but no production SchröDrive service or production
SchröDrive data mount. Therefore the cutover is currently **BLOCKED** and the
target compose cannot be treated as deployable. The read-only editor proposal
is in `docs/cinecircle-portainer-stack-proposal.md`; its blocker markers must
be resolved by the owner inside Portainer.

The test-only port sequence is API `8979→8978`, GUI `8980→3000`, and host
qBittorrent bridge `8981→8282`; Arr clients use the internal
`schrodrive-test:8282` address. These are not production port assignments.

## 2. Portainer-only staged cutover

After the final authorization gate has been recorded:

1. In Portainer, open **Stacks → cinecircle → Editor** and save/record the
   current stack version as the rollback point.
2. Edit only the approved SchröDrive service image/reference and required
   service settings in the Portainer editor. Preserve the existing stack
   name, service name, folders, environment, volumes, devices, network, and
   production ports. Do not edit an external compose copy.
3. Use Portainer’s **Update the stack** / redeploy action to save the edited
   stack and recreate only the approved SchröDrive service. Do not use a
   project-wide external `docker compose up`, rebuild unrelated services, or
   change DNS.
4. Verify health, API/configuration, data mount visibility, provider
   connectivity, Review queue continuity, and Arr bridge behavior in
   Portainer and the service logs. Compare with the recorded precheck.
5. Resume production requests only after the operator confirms the full
   observation window is clean.

The cutover target removes DavDebrid from the final stack. No DavDebrid
container, webhook route, cache, or source-snapshot endpoint is retained as a
runtime dependency. Its useful polling, snapshot diff, file-tree filtering,
and category behavior is ported into the CineCircle SchröDrive fork and must
pass the test gates before the authorization gate can be satisfied.

### Target wiring and reused resources

The Portainer Editor must reuse the existing `cinecircle` stack, its existing
Docker network, and owner-approved existing folders/volumes wherever their
purpose and permissions match. The proposal maps the observed source mount,
Arr-facing download mount, Riven data, and service network, but does not
invent a production SchröDrive `/data`, `/config`, or media path. The owner
must confirm each mapping in the editor before saving.

Target wiring, in order of dependency:

1. SchröDrive mounts the approved existing media/provider tree read-only where
   appropriate and uses a separately approved persistent state directory.
2. The optional Seerr inbound route is enabled with `RUN_WEBHOOK=true` only if
   this path is intentionally owned by SchröDrive. It is `POST
   /webhook/overseerr`; it is unrelated to AllDebrid notifications.
3. The AllDebrid fork worker is enabled only through explicit fork
   configuration. It polls AllDebrid status and file trees internally,
   persists snapshots/cursors, retains video plus subtitle siblings, and
   emits added/changed/deleted events. It does not use DavDebrid or a provider
   webhook.
4. Movies events route to Radarr and Shows events to Sonarr. SchröDrive sends
   the Arr command, polls its command ID, persists correlation/idempotency, and
   sends permanent failures to Review. Arr performs metadata matching/import.
5. Remove the approved DavDebrid service and its outbound webhook/source
   dependency only in the same authorized Portainer edit. Remove its mount
   helper only when the replacement mount is confirmed; do not remove Riven,
   Arr, Seerr, Plex, Jellyfin, or unrelated services by inference.

### Stop/start order

During the authorized maintenance window, use Portainer stack controls and
the smallest approved service scope:

1. Freeze new Seerr requests and record queue/Review/Arr state.
2. Stop the legacy DavDebrid-dependent intake in Portainer, then stop only the
   approved legacy DavDebrid and mount-helper services after their diagnostics
   and backup checks are complete.
3. Apply the saved editor change removing DavDebrid runtime dependencies and
   adding/replacing SchröDrive with the approved digest, mounts, network,
   environment, healthcheck, and preserved ports.
4. Start/verify the provider mount and persistent state availability, then
   SchröDrive; do not enable destructive import or provider operations during
   the first health check.
5. Verify Radarr and Sonarr connectivity and command polling, then enable the
   approved internal AllDebrid worker and its recent/full schedules.
6. Enable/verify `RUN_WEBHOOK=true` only for the approved Seerr inbound path;
   keep the optional Seerr poller disabled when Seerr→Arr owns Path B.
7. Run smoke checks through Arr, Plex, and Jellyfin, observe the agreed
   window, and unfreeze requests only after the success criteria pass.

## 3. Portainer rollback

Rollback immediately if health, data, Review records, mount visibility, or
Arr operations regress:

1. Pause production requests and preserve Portainer/service diagnostics.
2. In **Stacks → cinecircle → Versions/history**, restore the saved
   pre-cutover Portainer stack version.
3. Use Portainer’s **Update the stack** / redeploy action to apply that saved
   version. Keep the existing data paths and production ports unchanged.
4. Verify health, mount, Review queue, and Arr bridge behavior against the
   precheck observations.
5. Restore the real data from the recorded backup only if integrity checks
   require it and an operator explicitly approves that recovery.

### Backup and rollback readiness

Before editing, the owner must record a recoverable backup of the real
SchröDrive state and any affected Arr/Riven configuration, verify its size and
restore readability, and save the current Portainer stack version/history.
SQLite WAL/SHM files are runtime artifacts and must be handled consistently by
the approved backup procedure; they are never copied into review material.
Rollback is not “start the old container”: it is restoring the saved Portainer
stack version, redeploying it through Portainer, and rechecking the recorded
mount, health, Review, Arr, Plex, and Jellyfin observations.

### Verification checklist

| Check | Success condition | Failure action |
|---|---|---|
| Portainer/config | Saved stack version and edited config are visible in Portainer | Do not save/redeploy; resolve blocker |
| SchröDrive health | `/health` is healthy and persistent state opens | Roll back before enabling intake |
| Mount/data | Approved mount is visible, correct, and writable only where intended | Stop and roll back; never guess a path |
| Seerr webhook | Fixture reaches `/webhook/overseerr`; response and auth match policy | Keep route disabled and retain Path B ownership in Arr |
| AllDebrid worker | Internal polling produces stable add/change/delete events; subtitles remain in tree | Disable worker and review state; no provider mutation |
| Radarr/Sonarr | Correct Movies/Shows route, accepted command, polled successful status, persisted correlation | Route permanent failure to Review; roll back if systemic |
| Duplicate/retry | Already-imported/duplicate item is idempotent; transient errors retry; permanent errors are visible in Review | Pause intake and use rollback criteria |
| Plex/Jellyfin | Expected library scan/visibility smoke checks pass without duplicate or missing entries | Do not unfreeze requests; roll back if not resolved |
| DavDebrid removal | No final runtime service, webhook, or source-snapshot dependency remains | Abort cutover; restore saved version |

### Explicit success/failure criteria

Success requires every checklist row to pass, no unexplained queue growth or
Review regression during the observation window, and owner sign-off. Failure is
any health/data/mount regression, Arr command failure or duplicate mutation,
missing subtitle association, unexplained media-server visibility regression,
or remaining DavDebrid runtime dependency. Failure triggers request freeze and
Portainer-version rollback; it does not authorize ad-hoc fixes or DNS changes.

### Window and authorization

The maintenance window, observation duration, on-call operator, backup owner,
and rollback owner are **TBD and blocking**. The final authorization record
must explicitly approve the Portainer Editor save and redeploy, the exact
candidate digest, service replacement/removal list, confirmed paths/ports,
backup, and rollback version. No commit, test result, or request to “proceed”
is a production authorization.

## 4. Final production authorization gate

No Portainer edit, save, update, redeploy, or rollback may be performed until
the owner explicitly authorizes all of the following in the active change
record:

- the exact Portainer endpoint, `cinecircle` stack, and SchröDrive service;
- the candidate image digest and preserved production ports/data paths;
- the read-only prechecks, backup/snapshot, and saved Portainer rollback
  version;
- the maintenance window, observation owner, and rollback owner; and
- the Portainer stack edit/save/redeploy operation for that service.

A passing test run, a commit, or a generic request to proceed does not satisfy
this gate. Until the gate is recorded, stop after read-only Portainer and test
validation.
