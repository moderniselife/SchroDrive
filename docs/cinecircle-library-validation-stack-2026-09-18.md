# CineCircle library validation stack

Validation record, 2026-09-18. The new stack was created and started through
the Portainer API only. The existing stack and all current services remain
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
  non-conflicting validation stack is `cinecircle-validation`, ID `88`.
- Portainer pre-create state was saved locally under
  `/home/samtruman/backups/portainer-pre-cinecircle-validation-20260918/`.
  The saved stack-77 source and Portainer stack metadata are local rollback
  evidence; no token or secret is included in this report.
- The new stack was created with the Portainer standalone-string API on
  endpoint `3`; no external Compose deployment was used.

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

There are 612 symlinks and 9 subtitle files with the supported extensions.
The parser scan used the same read-only mounts and completed without content
writes:

| Result | Count |
|---|---:|
| Video files scanned | 599 |
| Matched films | 142 |
| Matched series episodes | 428 |
| Recognized series | 40 |
| Recognized seasons | 63 |
| Recognized episodes (unique identity) | 396 |
| Ambiguous | 29 |
| Unmatched | 0 |

The 29 ambiguous items all had the sanitized reason `title heuristic without
year`. No real titles or paths were persisted in the report.

## Riven vs Radarr/Sonarr catalog comparison

The earlier SchröDrive-vs-Riven parser comparison is superseded and is not
used for this validation. The frozen 599-item manifest was compared only with
the catalog state of the new validation-stack Arr instances. The Riven
baseline was the historical contract at
`/home/samtruman/docker/cinecircle/mediabridge-riven/src/media_parser.py`,
using its `plex_parser_v2.py` fallback with the optional modern sidecar
disabled.

The validation stack was updated through Portainer stack 88 after saving the
pre-change compose at `/tmp/cinecircle-validation-stack-before-rw.json`.
Only the Arr media mounts changed from read-only to read-write; SchröDrive,
the AllDebrid mount, production stack 77, and other services were untouched.
The Arr container paths are `/media/Movies` and `/media/Shows`, mapped from
the host paths `/mnt/riven/Movies` and `/mnt/riven/Shows`.

Radarr 6.3.0.10514 and Sonarr 4.0.19.2979 then registered those roots and
cataloged with native TMDB/TVDB lookup. All created records had
`monitored=false`, `searchForMovie=false` or the Sonarr v4 equivalent search
flags false, and both download-client lists remained empty. No download,
rename, move, or delete was requested. Rescan commands were submitted and
Radarr completed its queue. Sonarr progressed but stalled with a sanitized
operational state of 14 queued and 3 started commands; the local polling job
was stopped after the required no-progress timeout, without changing the Arr
containers.

| Comparison path | Riven inputs | Arr recognized | Missing from Arr catalog | Ambiguous reported by Arr | TMDB/IMDb association |
|---|---:|---:|---:|---:|---|
| Movies → Radarr | 171 (28.55%) | 138 (80.70%) | 33 (19.30%) | 0 Arr ambiguity; 10 lookup groups unresolved | Arr IDs present for 138; Riven emits none |
| Series/episodes → Sonarr | 428 (71.45%) | 179 (41.82%) | 249 (58.18%) | 0 Arr ambiguity; 5 lookup groups unresolved | Arr IDs present for 179; Riven emits none |
| Total | 599 (100%) | 317 (52.92%) | 282 (47.08%) | 0 Arr ambiguity | Riven emits no IDs |

Riven's actual parse output classified 171 movies and 428 episodes, covering
40 unique series, 63 series/seasons, and 396 unique series/season/episode
identities. Its emitted fields were `type`, `title`, `show`, `year`,
`season`, `episode`, `file`, `parser`, and `regex`; it emitted no TMDB, IMDb,
or TVDB identity field. Among path-recognized files, the only measured shared
field difference was title normalization for 29 Radarr files; no year or
season/episode difference was emitted by the comparison. Arr identities are
available on the recognized Radarr/Sonarr records, but cannot be matched to a
Riven identity because Riven did not emit one. Arr reported no ambiguous
catalog record; unresolved lookup groups are tracked separately as missing
catalog candidates.

The sanitized aggregate is versioned here. The 599 per-file read-only rows
are local only at `/tmp/cinecircle-validation-riven-vs-arr-final.jsonl`; raw
manifest, titles, paths, IDs, and runtime data are not versioned.

## Portainer stack and readback

The created stack contains only SchröDrive, one Radarr, and one Sonarr, with
separate storage locations:

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

Readback PASS:

- SchröDrive health: HTTP 200; container healthy.
- Radarr and Sonarr ping: HTTP 200.
- qBittorrent-compatible bridge: version `4.6.7`.
- Radarr movie records: `0`; Sonarr series records: `0`.
- Radarr download clients: `0`; Sonarr download clients: `0`.
- All media mounts are read-only; only the separate config/data paths are
  writable.
- Requested host ports `8970`, `8971`, `8972`, `7877`, and `8988` were free
  before creation and are now bound only by stack ID `88`.

## Required validation after authorization

1. Preserve the saved Portainer pre-create state.
2. Keep Arr roots limited to the read-only library for scan/readback;
   do not issue import, rename, download, or delete commands.
3. Run the library scan and record file count, recognized films, recognized
   series/seasons/episodes, unmatched items, ambiguous items, and sanitized
   reason classes.
4. Verify the old `cinecircle` stack, Plex `32400`, Jellyfin `8096`, and all
   other existing services are unchanged.
5. Roll back by removing only stack ID `88` through Portainer if
   validation fails; do not touch stack ID `77`.

Rollback was not exercised because it would remove the validation stack;
the saved Portainer state and stack ID provide the rollback boundary. The
production cutover remains blocked and was not attempted.
