# Arr single-file intake contract assessment

Read-only assessment, 2026-09-17, against the isolated CineCircle test Arr
services. No AllDebrid call, file import, provider write, production change,
DNS change, or code change was performed.

## Verified control-plane routes

Both test services expose the Arr v3 API on their configured internal service
ports. Read-only probes returned `200` for:

| Purpose | Radarr | Sonarr |
|---|---|---|
| Service/status | `GET /api/v3/system/status` | `GET /api/v3/system/status` |
| Existing records | `GET /api/v3/movie` | `GET /api/v3/series` |
| Root folders | `GET /api/v3/rootfolder` | `GET /api/v3/rootfolder` |
| Quality profiles | `GET /api/v3/qualityprofile` | `GET /api/v3/qualityprofile` |
| Command history/status | `GET /api/v3/command` | `GET /api/v3/command` |
| Existing-file candidate scan | `GET /api/v3/manualimport` | `GET /api/v3/manualimport` |

The test instances also expose `/api-docs` as the interactive documentation
UI. The probed `/api/v3/openapi.json` and Swagger JSON URLs returned 404, and
no checked-in Arr OpenAPI/source repository was present in the local test
stack. Exact version-specific request schemas therefore require capturing the
installed Arr API metadata or a fixture request before implementing the fork
adapter.

## Authentication

The verified test request header is:

```text
X-Api-Key: <Arr API key>
```

Keys are configuration secrets and are not recorded here. The adapter must
store them only in the ignored test/production secret configuration and must
never log them. A bearer-header alternative must not be assumed without a
version-specific Arr check.

## Two different operations

### Existing movie or episode file: scan/import

The minimum intended handoff is a readable file or directory path visible to
the target Arr container, plus the Movies/Shows route selected by SchröDrive.
The preferred command path is:

```text
POST /api/v3/command
{
  "name": "DownloadedMoviesScan" | "DownloadedEpisodesScan",
  "path": "<Arr-visible file or staging directory>",
  "importMode": "Move" | "Copy",
  "downloadClientId": "<stable optional correlation key>"
}
```

For an episode scan, a series identifier may be included when the installed
Sonarr version requires it; for a movie scan, a movie identifier may be
included when the installed Radarr version requires it. The scan command is
the Arr-owned metadata matching/import boundary: SchröDrive supplies the
path and classification, while Arr parses the filename, resolves the record,
and imports it.

The command response is expected to contain an Arr command `id`. Poll:

```text
GET /api/v3/command/<id>
```

until the returned status/state is terminal (`completed`/successful or
`failed`), with bounded retries and persisted correlation state. The exact
enum spelling and response fields must be captured from the installed API
before coding; the current live read-only listing showed command records with
`name`, `commandName`, `status`, `result`, `queued`, `started`, `ended`, and
`id` fields.

For a single already-present file, `/api/v3/manualimport` is the discovery
and candidate-selection route. It is a `GET`, not an add-record operation;
the adapter must pass the Arr-visible folder/path query required by the
installed version, select the returned candidate, then use the exact
version-specific manual-import POST resource only after schema capture. No
manual-import POST was run in this assessment.

### Adding a new movie or series record

This is a different operation and is not required for an already-present file.
It uses:

```text
POST /api/v3/movie   # Radarr
POST /api/v3/series  # Sonarr
```

Record creation requires an Arr lookup/record payload, not merely a path. The
payload normally includes the resolved title plus year, root folder path,
quality profile ID, monitored state, and Arr-specific add options. Metadata
IDs (TMDb for Radarr; TVDB and/or TMDb for Sonarr, with IMDb where available)
are identity aids, not substitutes for the required Arr record shape. The
adapter must not create records by default when the target record already
exists. It should first read the record collection and route an existing
record to scan/import.

Root folder and quality profile are record-creation configuration. They are
not minimum fields for a scan of an existing file, provided the file path is
inside an already configured Arr record/root. Monitored state likewise belongs
to record/season selection; it is not a substitute for a file path.

## Idempotency and duplicate behavior

- Stable deduplication key: target Arr kind + Arr-visible canonical path, with
  provider correlation and the parsed identity as secondary evidence.
- Persist `discovered`, `classified`, `submitted`, command ID, terminal result,
  and Review state in SchröDrive SQLite before/after each boundary so restart
  cannot submit the same path repeatedly.
- A repeated read-only scan must not create a new Arr movie/series record.
  Existing-record lookup must be performed before any create request.
- Repeated scan commands may be queued by Arr, so SchröDrive must suppress a
  duplicate command while one for the same stable key is pending and safely
  reconcile an already-completed command after restart.
- Arr’s existing-file/manual-import candidate response is authoritative for
  duplicate/existing-file rejection. Ambiguous or unmatched candidates go to
  Review; an override records actor/time/reason, resumes the same state
  machine, and does not re-read or rename the source file.

## Minimum-field conclusion

| Flow | Minimum SchröDrive handoff | Not required from SchröDrive |
|---|---|---|
| Existing movie file | Movies classification + Arr-visible path; optional stable correlation | TMDb/IMDb lookup, root folder, quality profile, monitored state |
| Existing episode file | Shows classification + Arr-visible path; optional series/episode hints and correlation | TVDB/TMDb/IMDb lookup, root folder, quality profile, monitored state |
| New movie record | Title/year or Arr identity lookup, root folder, quality profile, monitored/add options | File path import is a separate subsequent operation |
| New series record | Title/year or Arr identity lookup, root folder, quality profile, monitored/season options | File path import is a separate subsequent operation |

## Blockers before adapter implementation

1. Capture the installed Radarr and Sonarr `/api-docs` request schemas or a
   sanitized fixture for `POST /api/v3/command` and the manual-import POST
   resource; the local OpenAPI JSON endpoint is unavailable.
2. Confirm whether the fork uses scan commands or selected manual-import POST
   for a single file, including exact `importMode`, path, series/movie hint,
   and download-correlation fields.
3. Confirm terminal command enum/status behavior and duplicate command response
   without issuing production or real-media operations.
4. Confirm the Arr-visible path mapping in cinecircle-test using fixture paths;
   never infer a production data path.
