# cinecircle-test service ports

This is the test-only port map. It does not change production bindings.

## SchröDrive sequence

| Purpose | Test host port | Container port | Address |
| --- | ---: | ---: | --- |
| Backend API and health | 8979 | 8978 | `http://127.0.0.1:8979` |
| Web GUI | 8980 | 3000 | `http://127.0.0.1:8980` |
| qBittorrent-compatible Arr bridge | 8981 | 8282 | `http://127.0.0.1:8981` |

The bridge's container port remains `8282`. Radarr/Sonarr address it as
`http://schrodrive-test:8282` on the `cinecircle-test` network; the host port
`8981` is for diagnostics and host-side testing only.

## Other test services

These existing mappings are retained to avoid unnecessary reconfiguration:

| Service | Test host port | Container port |
| --- | ---: | ---: |
| `radarr-test` | 7879 | 7878 |
| `radarr-4k-test` | 7880 | 7878 |
| `sonarr-test` | 8990 | 8989 |
| `prowlarr-test` | 9697 | 9696 |
| `seerr-test` | 5056 | 5055 |
| `jellyfin-test` | 8097 | 8096 |
| `plex-test` | 32401 | 32400 |

The authoritative configuration is
`/home/samtruman/docker/cinecircle-test/compose.yml`.
