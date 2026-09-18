# CineCircle operational validation

Validation run: 2026-09-18. Production cutover, Portainer, DNS, and provider
destructive operations were not performed. Review disambiguation and the
second Arr/root multiversion setup were intentionally excluded.

## Torrentio and Prowlarr

The active `prowlarr` container uses port `9696` and has indexer ID `9`,
`Torrentio (Riven filters)`, enabled as Cardigann. A read-only Torznab probe
returned results for both a movie search and a TV episode search:

- Movies: 57 results, category `2000`.
- TV episode: 52 results, category `5000`.

The request paths preserved the Riven contract:

```text
sort=qualitysize|language=italian|qualityfilter=720p,480p,scr,cam,unknown
```

Existing Prowlarr indexers, including Mircrew, were not changed.

The same definition was installed in `prowlarr-test` (indexer ID `2`) after a
test-config backup. The existing Prowlarr applications already target
`radarr-test` with category `2000` and `sonarr-test` with categories beginning
at `5000`. After the `ApplicationIndexerSync` command completed, both Arr-test
instances contained `Torrentio (Riven filters) (Prowlarr)` as a Torznab
indexer. No provider content was added or removed.

## Arr profile readback and global Italian gate

Only the single existing `radarr-test` and `sonarr-test` instances were
changed; no second/root 2160p/1080p instance was created.

- Sonarr 4.0.19 and Radarr 6.3.0 expose `LanguageSpecification` in the
  Custom Format schema; Italian is value `5`. Neither service uses a legacy
  Language Profile for this rule.
- Sonarr Custom Format `Italian (Language)` is assigned to existing profiles
  `HD-1080p` and `Ultra-HD` with score `1000`, and each profile has
  `minFormatScore`, `cutoffFormatScore`, and `minUpgradeFormatScore` set to
  `1000`. The same readback is present in Radarr profiles `HD-1080p` and
  `Ultra-HD`.
- Sonarr and Radarr therefore apply the language gate after Prowlarr
  aggregation, regardless of whether the result came from Torrentio or
  LimeTorrents. This is not a Torrentio-title filter.
- Existing quality-definition size preference was read back as `95` wherever
  the installed service exposes it. No unsupported or invented size values
  were written.
- Both Arr-test instances already use the enabled `SchroDrive test`
  qBittorrent-compatible download client.

The read-only release searches used different indexers in the same aggregated
Arr results. Sonarr returned 54 fixture releases for the selected series
season: 18 with Italian and 36 without it. Italian releases from both
`LimeTorrents test (Prowlarr)` and `Torrentio (Riven filters) (Prowlarr)`
received score `1000`; a Polish/English release from Torrentio received score
`0` and was rejected with `Custom Formats have score 0 below Series profile
minimum 1000`.

Radarr returned 62 fixture releases for the selected film: 9 with Italian
and 53 without it. Italian releases from both aggregated indexers received
score `1000`; an English LimeTorrents result and an English Torrentio result
received score `0` and were rejected with the profile minimum and
`Italian is wanted, but found English`. Final acceptance can still be blocked
by seeders, quality cutoff, or an existing file; the language gate itself is
demonstrated.

The fixture searches also exposed five Sonarr and nineteen Radarr results
containing `Unknown` language. These are rejected by the same minimum-score
gate when no Italian language is parsed. A title without a reliable language
signal cannot be proven Italian by this test; no title-regex fallback was
added. The future 4K profile must replicate this same Language Custom Format
and score thresholds, but the second Arr/root instance remains intentionally
uncreated.

## Test-stack E2E and wiring

The existing isolated fork suite ran with network disabled and the repository
read-only:

```text
105 pass, 0 fail, 234 expect() calls, 19 files
```

It covers the three input fixtures, Arr scan command/status polling, AllDebrid
recent/full snapshot reconciliation, added/changed/deleted, deduplication,
retry, restart recovery, SQLite persistence, Movies/Shows routing, Review
handoff, and subtitle/attachment retention.

The running `schrodrive-test` service was reconciled with the versioned test
compose only; no other service was recreated. Readback:

- `RUN_WEBHOOK=true` for the optional Seerr inbound route;
- `RUN_POLLER=false`, so no provider polling was started;
- `/health` returned `200`;
- a sanitized Seerr fixture reached `/webhook/overseerr` and returned the
  expected `503` because no indexer was configured;
- the AllDebrid path remained internal polling/API, with no provider webhook;
- the qBittorrent-compatible bridge remained available on test port `8981`.

This is a fixture/staging-boundary PASS, not a real AllDebrid import. No
provider key or provider mutation was used.

## Cutover readiness

`docker compose -f /home/samtruman/docker/cinecircle-test/compose.yml config
--quiet` passed. The Portainer-only cutover remains documentation-only and
blocked at the existing authorization gate: exact production SchröDrive data
mount, saved Portainer rollback version, backup readiness, and final owner
approval still must be confirmed in Portainer. The active legacy containers
remain untouched.

## Backups and local artifacts

- Active Prowlarr backup:
  `/home/samtruman/backups/cinecircle-prowlarr-install-20260918/prowlarr-config-before-category-fix.tgz`
  SHA-256 `c6f4dd92b1a74413335b726b522a87f49aa43edfe3fdd2fc105fe4ec7c94828e`.
- Test Prowlarr backup:
  `/home/samtruman/backups/cinecircle-test-prowlarr-torrentio-20260918/prowlarr-test-config-before-category-fix.tgz`
  SHA-256 `9993a62367fa966eab2b7005e095cfe90b373adc60f6f3d63d4749be42909528`.
- Arr profile backups:
  `/home/samtruman/backups/cinecircle-arr-profiles-20260918/`.
- Sonarr Custom Format/profile backup:
  `/home/samtruman/backups/cinecircle-sonarr-italian-cf-20260918/sonarr-config-before-italian-custom-format.tgz`
  SHA-256 `d69b91d9a0674c159e2575507673d45ab8043096bbe429aa9571102041e28af8`.
- Radarr Custom Format/profile backup:
  `/home/samtruman/backups/cinecircle-radarr-italian-cf-20260918/radarr-config-before-italian-custom-format.tgz`
  SHA-256 `f066fe5c315351cf56dc99b4288b0fad540e6e276b2f7b70060db9a05ea63dad`.

SQLite runtime files under `data/` remain intentionally uncommitted and are
not review material.
