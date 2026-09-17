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
