# Provider reconciliation capability audit

Read-only source audit of `src/providers` on 2026-09-17. No provider network
request, credential, mutation, download, or production access was used. The
status below means “implemented in this repository”, not “verified against the
live provider API”. Only AllDebrid has the relevant provider fixture coverage.
The audited provider set is every concrete client registered by
`src/providers/index.ts`: the eleven rows below; no additional concrete client
was found in that registry.

Legend: **yes/code** means the method and endpoint are present in source;
**yes/fixture** means source behavior also has local mocked fixture coverage;
**derived** means a generic worker could compute it from repeated snapshots;
**no/code** means no such capability was found in the audited provider file;
**unverified** means the source does not establish the external contract.

| Provider / source | Status/list method and effective endpoint | File-tree method and effective endpoint | Recent snapshot | Full snapshot | Change detection | Push/webhook | Code read | Documentation in repo | Fixture evidence | Unverifiable |
|---|---|---|---|---|---|---|---|---|---|---|
| AllDebrid (`alldebrid.ts`) | `listTorrents()` → `POST /v4.1/magnet/status` | `fetchDirectories()` → status then `POST /v4/magnet/files`; bounded IDs use the same file endpoint | yes/code: fork source sorts `addedAt` and bounds IDs | yes/code + fixture | derived in fork worker from status/tree fingerprint | no/code; no provider webhook client | `listTorrents`, `fetchDirectories`, explicit-ID tree method read | Source comments describe current status/files lifecycle | Unit fixtures plus fork E2E cover status/tree and bounded/full calls | Live API guarantees, deletion semantics, and provider push are not verified |
| RealDebrid (`realdebrid.ts`) | `listTorrents()` → `GET /torrents?limit=&page=` | list same endpoint; `fetchTorrentFiles(id)` → `GET /torrents/info/{id}` | no/code: only paged full listing | yes/code | derived possible from stable ID/status/file tree; no provider diff | no/code | List/tree methods and endpoints read | Inline source comments only; no separate provider doc found | No dedicated reconciliation fixture | Stable timestamps, deletion visibility, and external contract unverified |
| Premiumize (`premiumize.ts`) | `listTorrents()` → `GET /transfer/list` | list plus `GET /folder/list?id=` | no/code | yes/code | derived possible from repeated transfer/folder snapshots | no/code | Transfer/folder methods read | Inline source comments only | No provider fixture | Folder completeness and deletion semantics unverified |
| TorBox (`torbox.ts`) | `listTorrents()` → provider torrent-list API | `fetchDirectories()` → `GET /v1/api/torrents/mylist`; maps returned file data | no/code | yes/code; exact file shape unverified | derived only if returned data is stable | no/code | List/tree implementation read | Inline comments; no separate provider doc found | No TorBox fixture | Exact list endpoint wrapper and deletion guarantees unverified |
| Debrid-Link (`debridlink.ts`) | `listTorrents()` → `GET /seedbox/list` | `fetchDirectories()` → same endpoint; returned `files[]` | no/code | yes/code | derived possible from repeated snapshots | no/code | List/tree methods and status filtering read | Inline source comments only | No provider fixture | Stable IDs/timestamps and deletion visibility unverified |
| Offcloud (`offcloud.ts`) | `listTorrents()` → `GET /cloud/history` | `fetchDirectories()` → same endpoint; `files[]` or synthetic file | no/code | yes/code | derived from history, but deletion semantics undeclared | no/code | History/status and tree mapping read | Inline source comments only | No provider fixture | External history retention/deletion contract unverified |
| Put.io (`putio.ts`) | `listTorrents()` → `GET /transfers/list` | list then `GET /files/list` for folder ID | no/code | yes/code | derived possible from transfer/file snapshots | no/code | Transfer/folder methods read | Inline source comments only | No provider fixture | Stable identity and deletion guarantees unverified |
| Seedr (`seedr.ts`) | `listTorrents()` → `GET /torrents` | list then `GET /folder/{folderId}` | no/code | yes/code | derived possible from repeated snapshots | no/code | Torrent/folder methods read | Inline source comments only | No provider fixture | Folder completeness and deletion semantics unverified |
| PikPak (`pikpak.ts`) | `listTorrents()` → `GET /drive/v1/tasks` with offline parameters | tasks then `GET /drive/v1/files` | no/code | yes/code | derived possible from task/file snapshots | no/code | Task/file methods and auth flow read | Inline source comments only | No provider fixture | Task retention, stable identity, and deletion visibility unverified |
| MegaDebrid (`megadebrid.ts`) | `listTorrents()` → root `action=getTorrents` | list then root `action=torrent-status&id=ID` | no/code | yes/code | derived possible from repeated snapshots | no/code | Action parameters and file method read | Inline source comments only | No provider fixture | External action schema and deletion semantics unverified |
| Deepbrid (`deepbrid.ts`) | `listTorrents()` → `GET /torrents/list` | list then `GET /torrents/files?id=ID` | no/code | yes/code | derived possible from repeated snapshots | no/code | List/files methods and status filtering read | Inline source comments only | No provider fixture | Stable IDs, deletion visibility, and push capability unverified |

## Conclusions

The common `DebridProvider` interface guarantees `listTorrents()` and
`fetchDirectories()`, but it does not guarantee recent listing, bounded file
lookup, stable timestamps, complete file trees, deletion visibility, or push
events. A generic worker must negotiate capabilities instead of assuming
provider APIs are identical. Native push is not required: polling is the
authoritative design.

The pure assessment in `src/services/providerReconciliationCapabilities.ts`
is a possible upstream seam: it selects `polling-hybrid` when recent and full
snapshots are declared, `polling-full-only` when only full snapshots are
declared, `push-only` only when push is the sole declared option, and
`disabled` otherwise. It does not require native push, start polling, or alter
any provider.

Based on the code evidence above, AllDebrid is `polling-hybrid`. RealDebrid,
Premiumize, TorBox, Debrid-Link, Offcloud, Put.io, Seedr, PikPak, MegaDebrid,
and Deepbrid are `polling-full-only` candidates. No provider is `push-only` in
the audited source. A provider becomes `disabled` when a future declaration
cannot establish both status/list and file-tree reads; no provider is enabled
on inference alone.

AllDebrid remains the first and only concrete CineCircle implementation. Its
fork worker uses the existing status/file-tree client, recent/full polling,
snapshot diff, persistent state, subtitle retention, Arr routing, and Review
handoff. Other providers remain disabled for this worker until they have
provider-specific declarations and fixtures.

No audited provider file contains an outbound provider webhook, push
subscription, or native added/changed/deleted feed. “Derived” change
detection is a worker-side snapshot/diff contract, not proof of reliable
provider-side deletion visibility. A recent check, when available, is a
frequent optimization; periodic full scans remain necessary for deletion
reconciliation.
