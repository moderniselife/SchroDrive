# CineCircle fork PR assessment

Assessment of changes after the parser-mismatch assessment commit `4e8c4f0`.
This is local review material only: no PR was opened and nothing was pushed.
The classification is based on repository diffs and the measured isolated test
contracts. No media data, provider records, IDs, secrets, runtime databases,
or production configuration are included.

| Commit / files | Group | Reason | Prerequisites | Tests needed |
|---|---|---|---|---|
| `8bc3862`; `docs/cinecircle-arr-single-file-contract-2026-09-17.md`, `docs/cinecircle-parser-strategy-analysis-2026-09-17.md` | C | CineCircle requirements and local assessment material; not product code | None; keep local | Documentation review only |
| `2a40d68`; `src/services/cinecircleAlldebridIntake.ts`, `tests/e2e/cinecircle-alldebrid-intake.test.ts` | B | Direct AllDebrid intake, two Arr routes, local Review handoff and fork state model | Confirm fork configuration, Arr paths, Review integration, and compose wiring | Add/change/delete, duplicate delivery, retry, restart, SQLite persistence, subtitle tree, Radarr/Sonarr command fixtures |
| `2a40d68`; changes to `src/providers/alldebrid.ts` | A candidate | Bounded directory lookup by explicit provider IDs is reusable as an AllDebrid client capability and has no CineCircle data dependency | Reframe API as a provider-level optional capability, document rate limits, preserve current API compatibility | AllDebrid mocked status/tree responses, empty/missing IDs, rate-limit/error handling, full-vs-bounded request behavior |
| `1775698`; `tests/e2e/cinecircle-three-inputs.test.ts` | C | CineCircle-specific three-input fixture harness; synthetic Seerr/Arr boundary | None | Keep as fork acceptance coverage; no upstream PR |
| `1775698`; updates to `docs/cinecircle-three-input-e2e-plan.md`, `docs/cinecircle-three-inputs-validation-2026-09-17.md` | C | Local architecture and validation reports | None | Documentation review only |
| `06baaec`, `4aa1283`; DavDebrid assessment, pipeline architecture, requirements matrix, cutover plan, E2E plan | C | Local migration/cutover documentation and the explicit DavDebrid-removal decision | Owner review and Portainer authorization only for any future deployment | Documentation consistency and sanitized diff checks |
| `f05d2b8`; worker extension, AllDebrid capability, direct-intake tests, matrix/plan/report updates | B | Adds the fork-only reconciliation behavior, persistent event state, Arr correlation, and subtitle retention | Wire only through explicit fork configuration; no default production startup | Full isolated suite plus compose-level fake provider/Arr/Review tests |
| `c5e0473`; SQLite restart test and report update | B | Verifies the fork state store across process/DB reopen; not a generic feature by itself | Stable fork schema and migration policy | SQLite reopen, cursor, event dedupe, pending command recovery |
| `7f18b4e`; Seerr-vs-AllDebrid boundary docs | C | Clarifies local runtime semantics and avoids confusing two unrelated webhook concepts | None | Route probe plus isolated fixture suite |
| Current `src/services/providerReconciliationCapabilities.ts`, `tests/unit/services/provider-reconciliation-capabilities.test.ts` | A candidate | Pure capability assessment is provider-neutral and does not assume identical APIs; it enables full/recent polling, push-only, polling-with-push, or disabled modes explicitly | Upstream API review, provider-specific capability declarations, fallback semantics, and compatibility policy | Matrix tests for complete polling, full-only fallback, push-only, and disabled providers |
| Current `docs/cinecircle-fork-pr-material.md`, matrix/report edits | C | Review packet and sanitized local requirements evidence | None | `git diff --check` and documentation review |

## Worker generalization decision

The worker remains Group B, fork-only. It is coupled to the CineCircle direct
intake contract (`AllDebrid → SchröDrive → Movies/Shows → Radarr/Sonarr`), two
Arr routes, local Review semantics, and CineCircle persistence tables. Renaming
the class would not remove those architectural dependencies. The worker also
intentionally preserves subtitle and attachment siblings in the event tree;
that behavior is part of the CineCircle import association contract.

The credible Group A seam now includes the pure capability assessment in
`src/services/providerReconciliationCapabilities.ts` and the narrow provider
capability already isolated in `src/providers/alldebrid.ts`. The assessment
does not assume identical provider APIs: it enables only a complete full
snapshot contract, treats recent polling as optional, permits push-only where
explicitly declared, and disables the path when neither contract exists. A
future upstream worker could consume these declarations without moving the
CineCircle state schema, Arr routing, or Review policy. No existing worker
behavior is changed by this assessment.

## Not proposed upstream

The following remain explicitly Group C: test-stack compose changes (including
`RUN_WEBHOOK=true`), test ports and bind mounts, Portainer proposals and
prechecks, production image/digest references, cutover/rollback material,
runtime SQLite files, token database artifacts, and any local Review GUI report.
They may support fork validation but must not enter an upstream PR.

## Current evidence

The isolated fork harness passes 13 tests. The complete isolated repository
suite passes 105 tests with 0 failures and 234 assertions. The runtime route
probe with `RUN_WEBHOOK=true` confirms the optional Seerr inbound endpoint;
AllDebrid remains internal polling/API and has no provider webhook dependency.
