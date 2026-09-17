# Prowlarr/Torrentio readback

Read-only operational report, 2026-09-18. No container was recreated or
restarted, no provider/DNS/Portainer operation was performed, and no Prowlarr
or Arr configuration was changed.

## Backup

Backups were created before inspection at:
`/home/samtruman/backups/cinecircle-arr-prowlarr-20260917/`.

| Archive | SHA-256 |
| --- | --- |
| `prowlarr-config.tgz` | `910ed6761e405f058c26595447eee0af832bacad09050ad9af80e9197372617d` |
| `prowlarr-test-config.tgz` | `0990ea62d45f6d77bb34da8f522d951b9c29ab78bed7377e2b6563dc1c6cb342` |
| `radarr-config.tgz` | `4a79a62db15a677291d0a09bda2d640bf2c019727a17ccaf25ba7838e56788ec` |
| `radarr-4k-config.tgz` | `96b557fc66fb37ef2e61f0745566237c95e041031eb6cd3afe93f93496154b51` |
| `sonarr-config.tgz` | `e37b7fc8cdafea7f6e968cba558faa9b4587e2992a94c5f0fac38e54dfa8559d` |

The active Prowlarr container is `prowlarr`, image
`lscr.io/linuxserver/prowlarr:latest`, port `0.0.0.0:9696→9696`, config bind
`/home/samtruman/docker/prowlarr-test/prowlarr:/config`. It is running and
was not recreated.

## Riven Torrentio source

Source: `/home/samtruman/docker/cinecircle/riven/data/settings.json`,
`scraping.torrentio`:

- enabled: `true`
- base URL: `https://torrentio.strem.fun`
- filter: `sort=qualitysize%7Clanguage=italian%7Cqualityfilter=720p,480p,scr,cam,unknown`
- timeout: `30`
- rate limit: `false`
- proxy: empty

The recovered Riven policy therefore requests Italian, sorts by quality/size,
and excludes 720p, 480p, screener, cam, and unknown quality. The documented
ranking enables 2160p before 1080p; this remains separate from the Torrentio
filter.

## Prowlarr readback

API `GET /api/v1/indexer` returned these existing entries; all were preserved
unchanged:

| ID | Name | Enabled | Implementation |
| ---: | --- | --- | --- |
| 4 | 0Magnet | no | Cardigann |
| 1 | 1337x (via Byparr) | no | Cardigann |
| 3 | LimeTorrents | yes | Cardigann |
| 7 | MIRCrew (authenticated scraper) | yes | Torznab |
| 2 | The Pirate Bay | no | Cardigann |
| 6 | Uindex | no | Cardigann |
| 5 | YTS | no | Cardigann |

The existing download client is ID `1`, `RDT Client (AllDebrid)`, enabled,
implementation `QBittorrent`. It was not changed. No native Torrentio entry
was returned.

## Compatibility result

The installed Prowlarr schema (`GET /api/v1/indexer/schema`) exposes no
Torrentio/Stremio definition. The installed custom-definition directory is
`/home/samtruman/docker/prowlarr-test/prowlarr/Definitions/Custom` and contains
only `1337x-byparr.yml`; no Torrentio definition is available. No custom
Torznab contract for the Riven Stremio URL was present in the inspected
configuration.

Result: **Torrentio was not added**. The closest supported path would require
an installed Prowlarr indexer definition that speaks Torrentio’s Stremio
contract, or a separately verified Torznab-compatible intermediary. Neither
is present, so creating a custom definition or translating fields would be an
unsupported assumption.

## Isolated candidate validation

The repository candidate `docs/fixtures/torrentio-riven-filter.yml` was
mounted into a disposable Prowlarr `2.5.2.5491` container with a minimal,
credential-free configuration and `--network none`. The local API schema
returned a `torrentio`/`Torrentio` definition and the runtime log had no
invalid-definition error. A subsequent read-only validation reached the
definition request and preserved the three Riven clauses, but parsing failed
because the response has no top-level `url`; it exposes `infoHash` and
`behaviorHints` instead. The fixture now maps `infohash` and omits the
incompatible `download` selector. A second disposable Prowlarr instance used
a sanitized local HTTP response; Prowlarr accepted the row and the mock
recorded this request path:
`/sort=qualitysize%7Clanguage=italian%7Cqualityfilter=720p%2C480p%2Cscr%2Ccam%2Cunknown/stream/movie/<fixture-id>.json`.
The disposable container, mock server, and temporary config were removed
after the check. The active `prowlarr` instance was not touched.

This proves that the definition is loadable, filter serialization is correct,
and `infohash` is accepted as the download identity. The episode path and a
real provider/fixture corpus remain approval-gated before installation.

## Comet assessment

Comet is a viable generic Torznab bridge for Prowlarr, but it is not an exact
replacement for the recovered Riven contract based on the inspected
configuration. Its documented integration exposes `/torznab/api` and can be
configured as Prowlarr Generic Torznab; its Torrentio settings are expressed
through Comet configuration rather than the exact Riven request filter. It
cannot be accepted as the exact-filter path without a separate readback
proving that `sort=qualitysize`, Italian language, and the complete quality
exclusion list are preserved. Keep Comet as an alternative, not as the current
implementation of the Riven-preserving proposal.

## Difference and final readback

- Prowlarr configuration before/after: identical; no write was issued.
- Existing indexers, including MIRCrew, remain unchanged.
- Torrentio: not present; the repository Cardigann candidate is loadable and
  passes the sanitized movie fixture, but installation remains blocked pending
  episode-path validation and explicit approval for provider/fixture testing.
- Backup: complete and checksummed above.
- No additional service, DNS record, Portainer stack, or container was
  touched.

Catalog and cutover remain blocked on an approved, supported Torrentio
integration path. No invented Prowlarr values were applied.
