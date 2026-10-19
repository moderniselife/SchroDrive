# Provider reconciliation

SchröDrive's provider reconciliation layer is provider-agnostic. It consumes
the existing `DebridProvider` contract and never calls provider delete, repair,
or dead-scanner operations.

The historical library import is a one-time operation performed through the
Radarr/Sonarr library import flow. This worker handles the ongoing case where
a new completed file is added directly to a provider after that library is
already configured.

```text
provider listTorrents/fetchDirectories
  -> normalized snapshot and local SQLite diff
  -> mount-backed symlink in the Arr library
  -> RescanMovie / RescanSeries
  -> Radarr, Sonarr, Plex and Jellyfin see the same provider-backed file
```

When both Radarr and Sonarr are configured with a URL and API key, the worker
starts automatically. `PROVIDER_RECONCILIATION_ENABLED=true` can still be used
to force it on, while an explicit `false` disables automatic activation.

When an Arr-visible symlink library is configured, reconciliation resolves the
existing Radarr or Sonarr entity before creating a link. Title, original title,
alternate titles, year, and Arr's own metadata lookup are used to identify the
configured entity. The symlink is then placed below the library path already
stored by Arr; SchröDrive does not invent a parallel title folder. If identity
or the Arr path is unavailable or ambiguous, the item is deferred to Review.

Provider mounts that expose category directories and an aggregate  directory are scanned through the category directories only. Every direct, non-hidden category directory is eligible, including custom categories; the aggregate  and compatibility  directories are never combined with authoritative roots. If no category root exists,  (then ) is retained as a legacy fallback. This prevents an Arr-reconciled file from being imported a second time through an aggregate alias while preserving older provider layouts. Existing aggregate aliases are removed only when the corresponding category-root link is present in the same organised folder.

Alias reconciliation compares the complete provider-relative media path, not only the final filename. This keeps two different sources with the same leaf name from being treated as the same media item.

ARR parser identity is authoritative when Arr can parse the release filename and the parsed entity is configured. Without a parser match, a title match is accepted only when its year is equal or within +/-1 year; a distant year mismatch (for example, a remake with the same title) is not linked automatically. Arr metadata lookup remains the final identity fallback. Ambiguous or unresolved items are left unlinked, never placed in a guessed folder.
## Contract coverage

Every provider registered by SchröDrive implements the common provider
contract used by the worker: stable torrent IDs, normalized torrent files, a
completed virtual directory tree, and a provider mount path. Recent polling is
an optimization; full polling plus the local snapshot diff is the source of
truth.

| Provider | Contract adapter | Live reconciliation validation |
| --- | --- | --- |
| TorBox | common adapter | pending provider-backed test |
| Real-Debrid | common adapter | pending provider-backed test |
| AllDebrid | common adapter | validated with provider-backed Sonarr E2E |
| Premiumize | common adapter | pending provider-backed test |
| Debrid-Link | common adapter | pending provider-backed test |
| Deepbrid | common adapter | pending provider-backed test |
| Offcloud | common adapter | pending provider-backed test |
| Put.io | common adapter | pending provider-backed test |
| MegaDebrid | common adapter | pending provider-backed test |
| Seedr | common adapter | pending provider-backed test |
| PikPak | common adapter | pending provider-backed test |

“Common adapter” means the provider satisfies SchröDrive's existing interface;
it does not claim that a live account has been tested. A provider is skipped
when it is not configured or cannot expose a complete read-only snapshot.

The Arr library contains symlinks only. Provider content remains on the mount;
the reconciliation layer does not download or copy media to local storage.
