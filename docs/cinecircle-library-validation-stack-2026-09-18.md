# CineCircle library validation stack

Read-only preparation record, 2026-09-18. No Portainer stack was created or
started in this phase. The existing stack and all current services remain
unchanged.

## Portainer identity and blockers

- Portainer endpoint: `https://127.0.0.1:9443`.
- Portainer version: `2.33.2`.
- Local Docker endpoint: Portainer endpoint ID `3` (`local`).
- The actual existing stack is `cinecircle`, stack ID `77`, with source under
  `/data/compose/77`. Its Docker Compose project label is also `cinecircle`.
- No Portainer stack named `cinecircle-old` or `CineCircle Fold` was found in
  the local Portainer database snapshot. The old stack must not be renamed or
  stopped based on those aliases.
- A second stack cannot safely use the existing name `cinecircle`; the
  proposed non-conflicting Portainer name is `cinecircle-validation` pending
  owner confirmation.
- Portainer API authentication was not available to this session. The stack
  was therefore not saved, deployed, restarted, or edited. Docker Compose was
  not used as a deployment substitute.

## Read-only media inventory

The existing library paths are `/mnt/riven/Movies` and `/mnt/riven/Shows`.
They contain symlinks into `/mnt/debrid/alldebrid`, so a container that must
resolve the existing library links needs both sources mounted read-only.

Sanitized host-side inventory, obtained without opening or changing media:

| Root | Directories | Files | Video files |
|---|---:|---:|---:|
| Movies | 162 | 171 | included in total |
| Shows | 44 | 437 | included in total |
| Combined | 206 | 608 | 599 |

There are 612 symlinks and 9 subtitle files with the supported extensions
counted by the read-only inventory. No recognition, import, rename, or
classification result is claimed because the isolated Portainer stack could
not be created.

## Portainer editor proposal (not saved)

Create a new Portainer Docker Compose stack named
`cinecircle-validation`, only after confirming the name and authenticating in
Portainer. It should contain only SchröDrive, one Radarr, and one Sonarr for
the first validation pass, with separate storage locations:

| Component | Separate host config/state | Proposed host port |
|---|---|---:|
| SchröDrive | `/home/samtruman/docker/cinecircle-validation/schrodrive` | API `8970`, GUI `8971`, qBittorrent bridge `8972` |
| Radarr | `/home/samtruman/docker/cinecircle-validation/radarr` | `7877` |
| Sonarr | `/home/samtruman/docker/cinecircle-validation/sonarr` | `8988` |

Use UID/GID `1000:1000`, a private validation network, and no production
container names. Mount the existing library read-only as:

- `/mnt/riven/Movies` → validation Movies library, `ro`;
- `/mnt/riven/Shows` → validation Shows library, `ro`;
- `/mnt/debrid/alldebrid` → the matching symlink target, `ro`.

The validation services must use separate writable config/database paths, no
provider credentials, polling disabled, no download client enabled, and no
automatic import/rename/delete operation. SchröDrive may expose its
qBittorrent-compatible endpoint for readback, but it must not receive a
download request. Prowlarr/Torrentio configuration should only be read back
or connected after the stack exists; it must not alter Mircrew or the active
indexer set.

## Required validation after authorization

1. Confirm the Portainer stack name and save the pre-create Portainer state.
2. Create and start the new stack through Portainer only.
3. Verify health and that ports `8970`, `8971`, `8972`, `7877`, and `8988`
   do not conflict with existing services.
4. Configure Arr roots against the read-only library only for scan/readback;
   do not issue import, rename, download, or delete commands.
5. Run the library scan and record file count, recognized films, recognized
   series/seasons/episodes, unmatched items, ambiguous items, and sanitized
   reason classes.
6. Verify the old `cinecircle` stack, Plex `32400`, Jellyfin `8096`, and all
   other existing services are unchanged.
7. Roll back by removing only the new validation stack through Portainer if
   validation fails; do not touch stack ID `77`.

The production cutover remains blocked. A Portainer credential/session and
owner confirmation of the distinct validation stack name are required before
creation.
