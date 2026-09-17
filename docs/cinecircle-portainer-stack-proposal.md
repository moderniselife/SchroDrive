# Proposed Portainer stack editor diff: SchröDrive

Read-only proposal for Portainer stack `cinecircle` (stack ID `77`). The
active replacement target is `/davdebrid` (`davdebrid-plexparser`); there is
no SchröDrive production service today. This is
not saved in Portainer and must not be deployed as written. It is an editor
draft only; every `<BLOCKER: ...>` marker requires resolution in Portainer by
the production owner before authorization.

Source inspected: Portainer `/data/compose/77/docker-compose.yml`, SHA-256
`5a47f4aff3834107a8efd6d63ce3c3be456563b663204a4ea36adb210f811bae`.

## Replacement assessment

| Existing service | Functional overlap | Proposal status | Reason/blocker |
| --- | --- | --- | --- |
| `davdebrid-plexparser` (`davdebrid`) | Debrid file discovery/source snapshot | Replace target | Active legacy container; reuse its existing config/data roles only if compatible. |
| `cinecircle-parser` | Legacy MediaBridge parsing | Remove | Confirmed legacy path; SchröDrive owns classification in the target. |
| `cinecircle-webhook` | Legacy MediaBridge outbound webhook | Remove | Confirmed legacy path; Seerr inbound is SchröDrive `/webhook/overseerr`. |
| `rclone-davdebrid` | WebDAV/rclone mount into `/mnt/debrid/alldebrid` | Retain | No evidence authorizes removal; preserve mount and propagation. |
| `rdtclient` | qBittorrent-compatible Arr client | Remove after bridge check | Prowlarr/Arr use SchröDrive’s qBittorrent-compatible bridge; this is an operational cutover check. |
| `riven` / `riven-frontend` | Request/organizer/orchestration UI | Not classified as replacement | No evidence establishes feature parity or an approved migration; Riven currently consumes the legacy mount/source services. |
| `prowlarr`, `seerr`, `plex`, `jellyfin`, `watchstate`, `tautulli`, `riven`, `riven-db`, `riven-frontend`, `pelagica` | Request/indexer/media/state services | Retain | No assessment evidence authorizes removal. |

The confirmed legacy services and `rdtclient` are the only services shown for
removal. Prowlarr and Arr must use SchröDrive’s bridge before `rdtclient` is
removed. Retained service ports and mounts are unchanged.

## Existing relevant bindings

All listed services are on the external Docker network `cinecircle_default`.

| Service | Published ports | Bind/volume paths | Relevant dependency |
| --- | --- | --- | --- |
| `davdebrid-plexparser` | `8090:8080` | `/home/samtruman/docker/cinecircle/davdebrid:/config`; named volume `cinecircle_davdebrid_data:/data` | Provides `davdebrid:8080` source snapshot to Riven. |
| `rclone-davdebrid` | none | `/home/samtruman/docker/cinecircle/rclone/rclone.conf:/config/rclone/rclone.conf:ro`; `/mnt/debrid/alldebrid:/mnt/alldebrid:rshared` | Depends on `davdebrid-plexparser`; supplies the mounted source. |
| `rdtclient` | `6500:6500` | `/home/samtruman/docker/cinecircle/rdtclient/db:/data/db`; `/home/samtruman/docker/cinecircle/rdtclient/downloads:/data/downloads`; `/mnt/debrid/alldebrid:/mnt/debrid/alldebrid:rslave` | Used by Arr/Prowlarr; depends on `davdebrid-plexparser`. |
| `riven` | `127.0.0.1:8088:8080`, `127.0.0.1:8092:8090` | `/home/samtruman/docker/cinecircle/riven/data:/riven/data`; `/home/samtruman/docker/cinecircle/tools/plex_parser/tmdb_series_preview.json:/riven/tmdb_series_preview.json:ro`; `/mnt/riven:/mount:rshared,z`; `/mnt/debrid/alldebrid:/mnt/debrid/alldebrid:rslave` | Reads the legacy mount and `http://davdebrid:8080/api/source-snapshot`. |

The current production host port `3000` is occupied by `riven-frontend`.
Plex `32400`, Jellyfin `8096`, Riven `127.0.0.1:8088` and `127.0.0.1:8092`,
Prowlarr `9696`, Seerr `127.0.0.1:5055`, and every other retained published
port must remain exactly unchanged. Test ports `8979`, `8980`, and `8981` are
not production assignments. No new `/data`, `/config`, `/mnt/schrodrive`, or
`AR/adjustment` path is proposed.

## Non-deployable proposed editor diff

This excerpt is intentionally blocked and is not a valid deployment payload
until all markers are replaced with owner-confirmed values in Portainer.

```diff
 services:
   ... existing retained services unchanged ...
-  davdebrid-plexparser:
-    image: samtruman/davdebrid-plexparser:latest
-    container_name: davdebrid
-    ... existing service definition retained in the saved Portainer version ...
-  cinecircle-parser:
-    ... confirmed legacy MediaBridge service removed ...
-  cinecircle-webhook:
-    ... confirmed legacy MediaBridge service removed ...
-  rdtclient:
-    image: rogerfar/rdtclient:latest
-    container_name: rdtclient
-    ... removed after the operational Prowlarr/Arr bridge check ...
+  schrodrive:
+    # Candidate identity: local image ID/digest verified in cinecircle-test.
+    # Portainer must verify the exact pullable image reference resolves to it.
+    image: schrodrive:cinecircle-review-blocker@sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8
+    container_name: <BLOCKER: owner-confirmed replacement for davdebrid>
+    restart: unless-stopped
+    # Do not invent production host ports. Preserve the legacy 8090 binding
+    # only if the replacement exposes the required contract; retained service
+    # ports cannot be changed.
+    environment:
+      TZ: Europe/Rome
+      PUID: "1000"
+      PGID: "1000"
+      DATA_DIR: /data
+      PORT: "8978"
+      PROVIDERS: <BLOCKER: approved production provider set>
+      <BLOCKER: approved provider credentials and endpoint environment names>
+      RUN_MOUNT: "true"
+      MOUNT_BASE: <BLOCKER: exact existing approved mount target>
+      MOUNT_UID: "1000"
+      MOUNT_GID: "1000"
+      MOUNT_ALLOW_OTHER: "true"
+      ARR_BRIDGE_ENABLED: "true"
+      ARR_BRIDGE_PORT: "8282"
+      RUN_WEB_GUI: "true"
+      WEB_PORT: "3000"
+      BACKEND_URL: http://localhost:8978
+      AUTO_UPDATE_ENABLED: "false"
+    volumes:
+      - type: bind
+        source: /home/samtruman/docker/cinecircle/davdebrid
+        target: /config
+      - type: volume
+        source: cinecircle_davdebrid_data
+        target: /data
+      - type: bind
+        source: <BLOCKER: exact existing provider/media mount confirmed in Portainer>
+        target: <BLOCKER: SchröDrive target>
+        bind:
+          propagation: <BLOCKER: preserve existing propagation>
+    devices:
+      - /dev/fuse:/dev/fuse:rwm
+    cap_add:
+      - SYS_ADMIN
+    security_opt:
+      - apparmor:unconfined
+      - no-new-privileges
+    networks:
+      - default
+    healthcheck:
+      test: ["CMD-SHELL", "curl -f http://localhost:8978/health || exit 1"]
+      interval: 30s
+      timeout: 10s
+      retries: 5
+      start_period: 30s
 ```

The digest above is the requested candidate identity. The image reference
format must be verified in Portainer before use because the observed digest is
the local Docker image ID; no registry pull or production image resolution was
performed.

## Blockers before an editor diff can become deployable

1. Portainer must confirm `/davdebrid` and the exact SchröDrive service name;
   no SchröDrive service currently exists in stack `cinecircle`.
2. The owner must confirm reuse of `/home/samtruman/docker/cinecircle/davdebrid:/config`
   and `cinecircle_davdebrid_data:/data`, plus the exact existing provider/media
   mount. No new path is allowed.
3. Confirm removal of `davdebrid-plexparser`, `cinecircle-parser`,
   `cinecircle-webhook`, and `rdtclient` after the operational Prowlarr/Arr
   bridge check; retain all other evidenced active services.
4. The owner must confirm provider credentials/environment names, Arr client
   URLs, download paths, and state migration.
5. Portainer must confirm a non-conflicting GUI host port; production `3000`
   is currently used by `riven-frontend`.
6. A recoverable backup and a saved Portainer stack version must exist before
   any edit/save/redeploy action.
7. The exact candidate image reference must resolve to digest
   `sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8`.

No Portainer save, deployment, restart, service removal, DNS change, or
external compose deployment is part of this proposal.
