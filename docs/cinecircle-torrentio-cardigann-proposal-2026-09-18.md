# Torrentio Cardigann proposal for Prowlarr

Read-only proposal. This file is not installed in Prowlarr and no running
container or configuration was changed.

## Objective

Preserve the active Riven Torrentio behavior while making the results
available to the existing Prowlarr instance:

```text
Torrentio Stremio endpoint -> Cardigann JSON adapter -> existing Prowlarr -> Arr
```

Riven’s source is
`/home/samtruman/docker/cinecircle/riven/data/settings.json`, section
`scraping.torrentio`:

```text
enabled=true
url=https://torrentio.strem.fun
filter=sort=qualitysize|language=italian|qualityfilter=720p,480p,scr,cam,unknown
timeout=30; ratelimit=false; proxy_url=
```

The encoded Riven value uses `%7C` for separators. The adapter must URL encode
the separators exactly once when constructing the request.

## Proposed Cardigann contract

The installed Prowlarr instance already loads custom YAML definitions from
`/home/samtruman/docker/prowlarr-test/prowlarr/Definitions/Custom`; its
existing `1337x-byparr.yml` demonstrates that custom definitions are supported.

| Contract | Proposed mapping |
| --- | --- |
| ID/name | `torrentio` / `Torrentio` |
| Base link | The Riven URL, `https://torrentio.strem.fun/` |
| Movie request | `GET <base>/<exact-filter>/stream/movie/<IMDb ID>.json` |
| Series request | `GET <base>/<exact-filter>/stream/series/<IMDb ID>:<season>:<episode>.json` |
| Search modes | keyword search; movie search with IMDb ID; TV search with IMDb ID, season, episode |
| JSON rows | selector `streams` |
| Categories | Movies and TV |
| Title | Stream `title`, with first-line normalization only for Torznab output |
| Year | Four-digit year extracted from stream title when present |
| Info hash | Stream `infoHash` |
| Size/seeders | Extract from stream title where Torrentio emits them |
| Download | Use the emitted `infoHash` as the Cardigann download identity; current Torrentio rows do not expose a top-level `url` |

The request template must always construct the filter as:

```text
sort=qualitysize|language=italian|qualityfilter=720p,480p,scr,cam,unknown
```

No optional Prowlarr setting should silently remove the Italian or
quality-exclusion clauses. If configurable fields are exposed, their defaults
must be exactly `italian` and `720p,480p,scr,cam,unknown`.

## Evidence and limitations

- Riven’s URL, filter, timeout, and rate-limit values are directly evidenced
  by the local settings file.
- Prowlarr custom YAML loading is evidenced by the existing custom
  `1337x-byparr.yml` and the running API schema.
- A public third-party Torrentio Cardigann definition demonstrates the same
  JSON endpoint shape, IMDb/movie/series paths, `streams` selector, and
  configurable language/quality-filter fields. It is reference material only,
  not an approved dependency.
- The candidate was loaded in an isolated Prowlarr 2.5.2.5491 container using
  a minimal configuration with no live credentials and no network access. The
  API schema contained the `torrentio`/`Torrentio` definition, and the runtime
  log contained no invalid-definition error. A separate read-only validation
  observed the Riven filter in the generated request, but exposed an
  output-contract gap: current Torrentio rows contain `infoHash` and
  `behaviorHints`, not a top-level `url`. The candidate therefore uses the
  supported Cardigann `infohash` field and must be revalidated with a sanitized
  fixture before installation.

## Acceptance checks before installation

1. Validate the YAML against the installed Prowlarr custom-definition schema
   (completed in the isolated runtime check above).
2. Confirm JSON with a `streams` array for one movie and one episode fixture.
3. Confirm generated requests contain all three Riven filter clauses in order.
4. Confirm Movies/TV and IMDb, season, and episode mappings survive into
   Torznab results.
5. Install only through the existing Prowlarr configuration, preserving its
   container, config volume, Mircrew, and every other indexer.
6. Read back the saved definition and compare it with this proposal and the
   Riven source before syncing to Arr.

Until those checks pass, Comet remains an optional alternative Torznab bridge,
not the exact-filter path. No catalog or cutover should depend on either
solution before approval.
