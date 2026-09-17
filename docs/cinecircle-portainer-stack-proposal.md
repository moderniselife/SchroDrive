# Proposed Portainer stack editor diff: SchröDrive

Read-only proposal for Portainer stack `cinecircle` (stack ID `77`). This is
not saved in Portainer and must not be deployed as written. It is an editor
draft only; every `<BLOCKER: ...>` marker requires resolution in Portainer by
the production owner before authorization.

Source inspected: Portainer `/data/compose/77/docker-compose.yml`, SHA-256
`5a47f4aff3834107a8efd6d63ce3c3be456563b663204a4ea36adb210f811bae`.

## Replacement assessment

| Existing service | Functional overlap | Proposal status | Reason/blocker |
| --- | --- | --- | --- |
| `davdebrid-plexparser` (`davdebrid`) | Debrid file discovery/source snapshot | Conditional replacement | SchröDrive provides provider/mount behavior, but Riven’s source-snapshot dependency must be migrated or explicitly retained. |
| `rclone-davdebrid` | WebDAV/rclone mount into `/mnt/debrid/alldebrid` | Conditional replacement | The real SchröDrive mount source and propagation target are unknown. |
| `rdtclient` | qBittorrent-compatible Arr client | Conditional replacement | Arr client URLs, download paths, and existing state migration must be confirmed. |
| `riven` / `riven-frontend` | Request/organizer/orchestration UI | Not classified as replacement | No evidence establishes feature parity or an approved migration; Riven currently consumes the legacy mount/source services. |
| `cinecircle-parser`, `cinecircle-webhook`, `prowlarr`, `seerr`, `plex`, `jellyfin`, `watchstate` | Parser, webhook, indexer/request/media/state services | Retain | No direct replacement evidence in this proposal. |

The three conditional replacements are the only services shown for removal in
the draft diff. They must not be removed until the Riven dependency decision,
Arr configuration/state migration, and real data backup are approved.

## Existing relevant bindings

All listed services are on the external Docker network `cinecircle_default`.

| Service | Published ports | Bind/volume paths | Relevant dependency |
| --- | --- | --- | --- |
| `davdebrid-plexparser` | `8090:8080` | `/home/samtruman/docker/cinecircle/davdebrid:/config`; named volume `cinecircle_davdebrid_data:/data` | Provides `davdebrid:8080` source snapshot to Riven. |
| `rclone-davdebrid` | none | `/home/samtruman/docker/cinecircle/rclone/rclone.conf:/config/rclone/rclone.conf:ro`; `/mnt/debrid/alldebrid:/mnt/alldebrid:rshared` | Depends on `davdebrid-plexparser`; supplies the mounted source. |
| `rdtclient` | `6500:6500` | `/home/samtruman/docker/cinecircle/rdtclient/db:/data/db`; `/home/samtruman/docker/cinecircle/rdtclient/downloads:/data/downloads`; `/mnt/debrid/alldebrid:/mnt/debrid/alldebrid:rslave` | Used by Arr/Prowlarr; depends on `davdebrid-plexparser`. |
| `riven` | `127.0.0.1:8088:8080`, `127.0.0.1:8092:8090` | `/home/samtruman/docker/cinecircle/riven/data:/riven/data`; `/home/samtruman/docker/cinecircle/tools/plex_parser/tmdb_series_preview.json:/riven/tmdb_series_preview.json:ro`; `/mnt/riven:/mount:rshared,z`; `/mnt/debrid/alldebrid:/mnt/debrid/alldebrid:rslave` | Reads the legacy mount and `http://davdebrid:8080/api/source-snapshot`. |

The current production host port `3000` is occupied by `riven-frontend`.
Production ports `8978` and `8282` were not assigned to an existing
production container during inspection, but Portainer ownership and the final
GUI port still require confirmation.

## Non-deployable proposed editor diff

This excerpt is intentionally blocked and is not a valid deployment payload
until all markers are replaced with owner-confirmed values in Portainer.

```diff
 services:
   ... existing services unchanged ...
-  davdebrid-plexparser:
-    image: samtruman/davdebrid-plexparser:latest
-    container_name: davdebrid
-    ... existing service definition retained in the saved Portainer version ...
-  rclone-davdebrid:
-    image: rclone/rclone:latest
-    container_name: rclone-davdebrid
-    ... existing service definition retained in the saved Portainer version ...
-  rdtclient:
-    image: rogerfar/rdtclient:latest
-    container_name: rdtclient
-    ... existing service definition retained in the saved Portainer version ...
+  schrodrive:
+    # Candidate identity: local image ID/digest verified in cinecircle-test.
+    # Portainer must verify the exact pullable image reference resolves to it.
+    image: schrodrive:cinecircle-review-blocker@sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8
+    container_name: <BLOCKER: owner-confirmed production container name>
+    restart: unless-stopped
+    ports:
+      - "8978:8978" # backend; confirm Portainer host-port availability
+      - "<BLOCKER: GUI host port>:3000" # 3000 is occupied by riven-frontend
+      - "8282:8282" # qBittorrent bridge; confirm host-port ownership
+    environment:
+      TZ: Europe/Rome
+      PUID: "1000"
+      PGID: "1000"
+      DATA_DIR: /data
+      PORT: "8978"
+      PROVIDERS: <BLOCKER: approved production provider set>
+      <BLOCKER: approved provider credentials and endpoint environment names>
+      RUN_MOUNT: "true"
+      MOUNT_BASE: /mnt/schrodrive
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
+        source: <BLOCKER: exact real production mount source>
+        target: /mnt/schrodrive
+        bind:
+          propagation: rshared
+      - type: bind
+        source: <BLOCKER: exact real production DATA_DIR source>
+        target: /data
+      - type: bind
+        source: <BLOCKER: exact approved production config source>
+        target: /config
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

1. Portainer must identify the intended production service name/container
   name; no SchröDrive service currently exists in stack `cinecircle`.
2. The owner must provide the exact real production mount, `/data` path, and
   `/config` path. This proposal deliberately guesses none of them.
3. The owner must decide whether `davdebrid-plexparser`,
   `rclone-davdebrid`, and `rdtclient` are all retired, and how Riven’s
   `davdebrid` source-snapshot and mount dependencies are replaced or kept.
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
