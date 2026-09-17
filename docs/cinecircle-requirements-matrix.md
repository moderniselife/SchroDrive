# CineCircle requirements matrix

Versioned 2026-09-17 on the development branch. This matrix is intentionally
sanitized: it contains no media names, real paths, metadata IDs, provider
records, secrets, or raw benchmark output.

| Requirement | Status | Evidence / test / report | Remaining blocker |
|---|---|---|---|
| A. Historical library import | Planned / shadow validated | [three-input architecture](cinecircle-pipeline-architecture-2026-09-17.md); [E2E plan](cinecircle-three-input-e2e-plan.md); [parser summary](cinecircle-parser-comparison-2026-09-17.md) | Dedicated fixture import audit and idempotency E2E still required |
| B. Seerr → Radarr/Sonarr request flow | Partial | [E2E plan](cinecircle-three-input-e2e-plan.md); `tests/e2e/arr-bridge/` | Full isolated Seerr → Arr → import → library E2E still required |
| C. Direct/manual provider intake with SchröDrive polling → Arr | Fork scope; not upstream PR material | [architecture](cinecircle-pipeline-architecture-2026-09-17.md); [E2E plan](cinecircle-three-input-e2e-plan.md) | CineCircle-specific adapter and isolated tests are not implemented |
| DavDebrid removal | Gated | [architecture](cinecircle-pipeline-architecture-2026-09-17.md); [cutover plan](cinecircle-cutover-plan.md) | A/B/C acceptance, backup verification, and explicit Portainer authorization |
| Movies/Shows classification | Validated for benchmark | [parser summary](cinecircle-parser-comparison-2026-09-17.md); `src/core/mediaClassifier.ts`; `tests/unit/services/mediaParser.test.ts` | Direct-provider adapter must use the same classification contract |
| Arr owns metadata matching and import | Design accepted; partial E2E | `src/services/arrBridge.ts`; [E2E plan](cinecircle-three-input-e2e-plan.md) | Full chain must prove SchröDrive does not duplicate Arr ownership |
| Review matched / ambiguous / unmatched states | Implemented, test-covered | `src/services/organizerReview.ts`; `tests/unit/services/organizer-review.test.ts`; `tests/e2e/arr-bridge/restart-recovery.test.ts` | Fork adapter must hand off unresolved items with override, audit, and resume semantics |
| Review override, audit trail, and resume | Implemented for organizer flow | `src/services/organizer.ts`; `src/services/organizerReview.ts`; review validation report | Direct-provider integration must persist and replay the same decision safely |
| Multiversion 1080p / 2160p preservation | Implemented / regression-covered | `src/services/organizer.ts`; `tests/unit/services/organizer-filename.test.ts`; commit history `1fb3511` | End-to-end Arr completion test must assert both versions remain distinct |
| Full Seerr → Arr → Jellyfin/Plex E2E | Not yet validated | `src/services/overseerr.ts`, `src/integrations/jellyfin.ts`, `src/integrations/plex.ts`; [E2E plan](cinecircle-three-input-e2e-plan.md) | Isolated request, import, scan, and playback/library visibility harness |
| Restart and idempotency matrix | Partial | `tests/e2e/arr-bridge/restart-recovery.test.ts`; `src/core/db.ts`; [E2E plan](cinecircle-three-input-e2e-plan.md) | Add coverage for polling deduplication, Review resume, Arr retries, and both media versions |
| Reproducible isolated test stack | Available | [E2E plan](cinecircle-three-input-e2e-plan.md); `compose.yml` in cinecircle-test | Add the missing full-chain fixtures while keeping provider operations fake |
| Portainer-only production cutover | Planned, read-only precheck complete | [Portainer precheck](cinecircle-portainer-precheck-2026-09-17.md); [stack proposal](cinecircle-portainer-stack-proposal.md); [cutover plan](cinecircle-cutover-plan.md) | Final authorization gate; no external compose deployment |
| Multipart qBittorrent request support | Implemented / test-covered | `src/services/arrBridge.ts`; `tests/e2e/arr-bridge/qbittorrent-api.test.ts` | None known; retain regression coverage |
| Current AllDebrid API contract | Implemented / unit-covered | `src/providers/alldebrid.ts`; `tests/unit/providers/alldebrid.test.ts` | Re-run against a sanitized fixture when provider contract changes |
| Nested WebDAV paths | Implemented / unit-covered | `src/services/webdavBridge.ts`; `tests/unit/services/webdav-path.test.ts` | None known; preserve path normalization regression |
| Provider-ID correlation | Implemented / unit-covered | `src/services/arrBridge.ts`; `tests/unit/services/arrBridge-correlation.test.ts` | Direct-provider adapter must carry the stable provider key through retries |
| rclone refresh | Implemented / unit-covered | `src/services/mount.ts`; `tests/unit/services/mount-refresh.test.ts` | Validate in the isolated mount harness; no production refresh |
| `MOUNT_OPTIONS` handling | Implemented / configuration-covered | `src/services/mount.ts`; `src/core/config.ts` | Add explicit compose configuration assertion in test stack |
| Nested staging | Implemented / regression-covered | `src/services/arrBridge.ts`; commit history `72ee97d` | Full chain should assert nested staging survives restart |
| Arr persistence | Implemented / regression-covered | `src/services/arrBridge.ts`; commit history `3ff9ef3`; `tests/e2e/arr-bridge/restart-recovery.test.ts` | Confirm persistence in the isolated compose stack |

## Fork boundary

The direct-provider polling adapter is CineCircle-specific fork scope, not an
upstream PR. It must implement and test provider/AllDebrid new-file polling,
stable deduplication/state, DavDebrid-replacement Movies/Shows classification,
routing to the correct Radarr/Sonarr instance, Arr metadata matching/import,
retries, restart recovery, and Review handoff for unresolved cases.

Generic SchröDrive fixes remain separate upstream candidates. The adapter,
configuration, documentation, and tests stay on the CineCircle fork branch.

## Measured parser gate

The sanitized full benchmark measured 603 items: 100.00% classification
agreement, 92.87% exact, 2.16% acceptable normalization, and 4.98%
mismatches. Raw manifests/results remain ignored and local-only.
