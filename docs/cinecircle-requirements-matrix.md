# CineCircle requirements matrix

Versioned 2026-09-17 on the development branch. This matrix is intentionally
sanitized: it contains no media names, real paths, metadata IDs, provider
records, secrets, or raw benchmark output.

| Requirement | Status | Evidence / test / report | Remaining blocker |
|---|---|---|---|
| A. Historical library import | Planned / shadow validated | [three-input architecture](cinecircle-pipeline-architecture-2026-09-17.md); [E2E plan](cinecircle-three-input-e2e-plan.md); [parser summary](cinecircle-parser-comparison-2026-09-17.md) | Dedicated fixture import audit and idempotency E2E still required |
| B. Seerr → Radarr/Sonarr request flow | Partial | [E2E plan](cinecircle-three-input-e2e-plan.md); `tests/e2e/arr-bridge/` | Full isolated Seerr → Arr → import → library E2E still required |
| C. In-process AllDebrid reconciliation → SchröDrive → Arr | Conditional upstream worker candidate; CineCircle Arr/Review/SQLite/routing bindings remain fork-only | [DavDebrid assessment](cinecircle-davdebrid-integration-assessment-2026-09-17.md); [architecture](cinecircle-pipeline-architecture-2026-09-17.md); [E2E plan](cinecircle-three-input-e2e-plan.md); [validation report](cinecircle-three-inputs-validation-2026-09-17.md); `src/services/cinecircleAlldebridIntake.ts`; [provider audit](provider-capability-audit-2026-09-17.md) | Extract provider-neutral core/capability contract, add per-provider fixtures, and complete fork Review/runtime wiring |
| DavDebrid removal | Gated | [architecture](cinecircle-pipeline-architecture-2026-09-17.md); [cutover plan](cinecircle-cutover-plan.md) | A/B/C acceptance, backup verification, and explicit Portainer authorization |
| Movies/Shows classification | Validated for benchmark | [parser summary](cinecircle-parser-comparison-2026-09-17.md); `src/core/mediaClassifier.ts`; `tests/unit/services/mediaParser.test.ts` | Direct-provider adapter must use the same classification contract |
| Arr owns metadata matching and import | Design accepted; fork command boundary tested | `src/services/arrBridge.ts`; `src/services/cinecircleAlldebridIntake.ts`; [single-file contract](cinecircle-arr-single-file-contract-2026-09-17.md); [E2E plan](cinecircle-three-input-e2e-plan.md) | Full compose chain must prove Arr accepts, processes, and rejects duplicates correctly |
| Canonical Riven/search and two-Arr settings | Defined as approval matrix; catalog blocked | [Riven/Arr settings matrix](cinecircle-riven-arr-settings-matrix-2026-09-17.md); `/home/samtruman/docker/cinecircle/riven/data/settings.json`; [Arr contract](cinecircle-arr-single-file-contract-2026-09-17.md) | Owner must approve vendor/ranking policy and recover production Radarr/Sonarr roots, profiles, language/naming/monitoring settings, and bridge records without exposing secrets |
| Torrentio added to existing Prowlarr from Riven settings | Cardigann exact-filter proposal; not installed; catalog blocked | [Cardigann proposal](cinecircle-torrentio-cardigann-proposal-2026-09-18.md); [Riven/Arr settings matrix](cinecircle-riven-arr-settings-matrix-2026-09-17.md); `/home/samtruman/docker/cinecircle/riven/data/settings.json` (`scraping.torrentio`) | Validate YAML, JSON/`streams` contract, exact filter generation, categories and IMDb/season/episode mapping; preserve existing Prowlarr config and Mircrew |
| Review matched / ambiguous / unmatched states | Implemented, API/UI matrix and persistence test-covered | `src/services/organizerReview.ts`; `tests/unit/services/organizer-review.test.ts`; `docs/review-validation-report.md` | Fork adapter must connect its `onReview` handoff to the persisted Review queue |
| Review override, audit trail, and resume | Implemented for organizer flow; fork handoff covered at contract level | `src/services/organizer.ts`; `src/services/organizerReview.ts`; `tests/e2e/cinecircle-alldebrid-intake.test.ts` | Add API-level Review persistence/override E2E when the fork UI integration is wired |
| Multiversion 1080p / 2160p preservation | Implemented / regression-covered | `src/services/organizer.ts`; `tests/unit/services/organizer-filename.test.ts`; commit history `1fb3511` | End-to-end Arr completion test must assert both versions remain distinct |
| Full Seerr → Arr → Jellyfin/Plex E2E | Not yet validated | `src/services/overseerr.ts`, `src/integrations/jellyfin.ts`, `src/integrations/plex.ts`; [E2E plan](cinecircle-three-input-e2e-plan.md) | Isolated request, import, scan, and playback/library visibility harness |
| Restart and idempotency matrix | Partial; direct adapter contract covered | `tests/e2e/arr-bridge/restart-recovery.test.ts`; `tests/e2e/cinecircle-alldebrid-intake.test.ts`; `src/services/cinecircleAlldebridIntake.ts` | Add full compose restart and Arr already-imported reconciliation |
| Reproducible isolated test stack | Available; test webhook enabled | [E2E plan](cinecircle-three-input-e2e-plan.md); `/home/samtruman/docker/cinecircle-test/compose.yml`; [validation report](cinecircle-three-inputs-validation-2026-09-17.md) | Add the missing full-chain fixtures while keeping provider operations fake |
| Portainer-only production cutover | Planned, read-only precheck complete | [Portainer precheck](cinecircle-portainer-precheck-2026-09-17.md); [stack proposal](cinecircle-portainer-stack-proposal.md); [cutover plan](cinecircle-cutover-plan.md) | Final authorization gate; no external compose deployment |
| Multipart qBittorrent request support | Implemented / test-covered | `src/services/arrBridge.ts`; `tests/e2e/arr-bridge/qbittorrent-api.test.ts` | None known; retain regression coverage |
| Current AllDebrid API contract | Implemented / unit-covered | `src/providers/alldebrid.ts`; `tests/unit/providers/alldebrid.test.ts` | Re-run against a sanitized fixture when provider contract changes |
| Nested WebDAV paths | Implemented / unit-covered | `src/services/webdavBridge.ts`; `tests/unit/services/webdav-path.test.ts` | None known; preserve path normalization regression |
| Provider-ID correlation | Implemented / unit-covered | `src/services/arrBridge.ts`; `tests/unit/services/arrBridge-correlation.test.ts` | Direct-provider adapter must carry the stable provider key through retries |
| Provider reconciliation capability negotiation | Generic capability seam implemented / matrix-tested; provider source audit completed; AllDebrid is the first concrete provider | `src/services/providerReconciliationCapabilities.ts`; `tests/unit/services/provider-reconciliation-capabilities.test.ts`; [provider audit](provider-capability-audit-2026-09-17.md); [PR assessment](cinecircle-pr-assessment-2026-09-17.md) | Upstream review, provider-specific declarations/fixtures, and deletion/reliability policy for each provider |
| rclone refresh | Implemented / unit-covered | `src/services/mount.ts`; `tests/unit/services/mount-refresh.test.ts` | Validate in the isolated mount harness; no production refresh |
| `MOUNT_OPTIONS` handling | Implemented / configuration-covered | `src/services/mount.ts`; `src/core/config.ts` | Add explicit compose configuration assertion in test stack |
| Nested staging | Implemented / regression-covered | `src/services/arrBridge.ts`; commit history `72ee97d` | Full chain should assert nested staging survives restart |
| Arr persistence | Implemented / regression-covered | `src/services/arrBridge.ts`; commit history `3ff9ef3`; `tests/e2e/arr-bridge/restart-recovery.test.ts` | Confirm persistence in the isolated compose stack |

## Fork boundary

The direct-provider adapter and CineCircle bindings are AllDebrid-specific
CineCircle fork scope. The snapshot-reconciliation core is a conditional
upstream candidate, not an automatic PR. It reconciles AllDebrid’s read-only status listing
and completed file trees, emits added/changed/deleted direct-file events,
persists a cursor/item/event state, deduplicates stable keys, retries transient
failures, recovers after restart, classifies DavDebrid replacements as
Movies/Shows, routes to the correct Radarr/Sonarr instance, and hands off
unresolved cases to Review. Generic provider polling is future fallback scope.

Generic SchröDrive fixes remain separate upstream candidates. The adapter,
configuration, documentation, and tests stay on the CineCircle fork branch.

## Measured parser gate

The sanitized full benchmark measured 603 items: 100.00% classification
agreement, 92.87% exact, 2.16% acceptable normalization, and 4.98%
mismatches. Raw manifests/results remain ignored and local-only.
