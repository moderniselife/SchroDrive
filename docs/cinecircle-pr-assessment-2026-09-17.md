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
| `f05d2b8`; worker extension, AllDebrid capability, direct-intake tests, matrix/plan/report updates | A conditional / B bindings | The reconciliation core can become generic; current two-Arr routing, local Review handoff, CineCircle SQLite schema, and CineCircle event wiring remain fork-specific | Extract provider-neutral core and common capability contract; keep AllDebrid adapter separate; confirm every other provider before opt-in | Full isolated suite, provider fixtures for each opt-in, snapshot failure/deletion tests, plus fork Arr/Review/SQLite tests |
| `c5e0473`; SQLite restart test and report update | B | Verifies the fork state store across process/DB reopen; not a generic feature by itself | Stable fork schema and migration policy | SQLite reopen, cursor, event dedupe, pending command recovery |
| `7f18b4e`; Seerr-vs-AllDebrid boundary docs | C | Clarifies local runtime semantics and avoids confusing two unrelated webhook concepts | None | Route probe plus isolated fixture suite |
| Current capability layer and [provider audit](provider-capability-audit-2026-09-17.md) | A candidate with provider-specific follow-up required | Pure assessment is provider-neutral and does not assume identical APIs; source audit shows only AllDebrid has recent/bounded support and no audited provider has push code | Upstream review of per-provider declarations, stable identity/tree guarantees, deletion semantics, fallback semantics, and compatibility policy | Capability matrix plus one source/fixture contract per provider before opt-in |
| Current `docs/cinecircle-fork-pr-material.md`, matrix/report edits | C | Review packet and sanitized local requirements evidence | None | `git diff --check` and documentation review |

## Review workflow upstream assessment

| Commit / files | Group | Reusable scope or exclusion | Prerequisites / dependencies | Tests required |
|---|---|---|---|---|
| `864dd0d`; `src/services/organizerReview.ts`, `src/services/organizer.ts`, `src/core/db.ts`, `src/server.ts`, `web/src/app/(dashboard)/review/page.tsx`, `web/src/app/api/organizer/review/{route.ts,[id]/route.ts}`, `web/src/components/app-sidebar.tsx`, `tests/unit/services/organizer-review.test.ts` | A candidate | Generic persistent Review queue, parser decision states, API listing/detail/decision endpoints, and initial UI navigation; no CineCircle dependency in the implementation | Upstream schema migration policy, auth/error contract, UI design review, and compatible parser identity type | Queue persistence, deterministic dedupe, list/detail/decision API, and browser navigation tests |
| `2bd656e`; `src/services/organizerReview.ts`, `src/services/organizer.ts`, `tests/unit/services/organizer-filename.test.ts`, `tests/unit/services/organizer-review.test.ts` | A candidate | Generic accepted-override lookup and resume behavior during organization | Define override precedence and idempotent resume semantics | Accepted movie/episode overrides, restart/resume, and unchanged source-path tests |
| `b978804`; `src/services/organizerReview.ts`, `tests/unit/services/organizer-review.test.ts` | A candidate | Defensive handling of malformed persisted Review JSON without taking down the queue | Upstream malformed-data policy and safe fallback representation | Malformed parsed/override records, list/detail isolation, and audit continuity |
| `f70a7af`; `src/server.ts`, `src/services/organizerReview.ts`, `tests/unit/services/organizer-review.test.ts` | A candidate | Generic override validation, bounded pagination, and API query filtering | Stable pagination contract, validation schema, and API compatibility review | Invalid decisions/overrides, pending/resolved and parser-state filters, pagination, detail, and 404/400 behavior |
| `f8beb80`; `src/server.ts`, `src/services/organizerReview.ts`, `web/src/app/(dashboard)/review/{page.tsx,[id]/page.tsx}`, `web/src/app/api/organizer/review/{route.ts,[id]/route.ts,[id]/audit/route.ts}`, `tests/unit/services/organizer-review.test.ts` | A candidate | Generic audit endpoint, hardened decision transitions, Review detail page, and retry/resume UI | Upstream API/UI accessibility review, audit retention policy, and auth boundary | Audit ordering, retry/resume, malformed records, filters/pagination, API matrix, and browser detail/audit flows |
| `f8beb80`; `docs/review-validation-report.md` | C | Local CineCircle runtime/port/test report, not product behavior | None; keep as fork evidence | Documentation/diff check only |
| Any CineCircle `onReview` adapter wiring, local SQLite intake tables, test compose ports, Portainer files, runtime DBs, or provider-specific data | C | Local integration/data/environment, not a generic Review PR | CineCircle fork authorization only | Fork integration tests; never include in upstream PR |

### Review PR conclusion

The Review core is a strong conditional upstream candidate: persistence,
dedupe, matched/ambiguous/unmatched state, override validation, audit trail,
pagination, retry/resume, malformed-record tolerance, and the HTTP/UI routes
are generic Organizer capabilities. The upstream PR must preserve the common
parser identity contract, migration compatibility, authentication boundary,
API pagination/error semantics, and browser accessibility coverage.

The CineCircle fork should consume that core through an adapter and keep its
AllDebrid/Arr event correlation, local Review handoff policy, CineCircle
SQLite intake tables, ports, compose, and reports outside the upstream PR.

## Worker generalization decision

The worker is a **conditional Group A candidate**, not permanently fork-only.
Its provider-neutral core can own snapshot reconciliation when a provider
declares the common capability contract: status/list plus file tree, local
snapshot diff for added/changed/deleted, and optional recent polling. The
AllDebrid implementation is the first concrete adapter.

The current CineCircle bindings remain Group B: two Arr routes, local Review
handoff, the CineCircle SQLite schema, CineCircle routing/configuration, and
the direct AllDebrid event contract. The worker also intentionally preserves
subtitle and attachment siblings in the event tree; the generic core should
retain that tree while Arr-specific association stays in the fork.

The credible Group A seam now includes the pure capability assessment in
`src/services/providerReconciliationCapabilities.ts` and the narrow provider
capability already isolated in `src/providers/alldebrid.ts`. The assessment
does not assume identical provider APIs: it selects polling-hybrid for recent
plus full snapshots, polling-full-only for a full snapshot only, push-only only
when push is the sole declared option, and disabled when neither contract
exists. Native push is not required and no hybrid push mode is imposed. An
upstream PR must first extract the core, define the common capability
contract, keep the AllDebrid adapter separate, and add a source/fixture
contract for every provider opt-in. No existing worker behavior is changed by
this assessment.

The complete provider audit is in
`docs/provider-capability-audit-2026-09-17.md`. It confirms that the common
interface does not prove identical provider APIs: AllDebrid is the only client
with recent/bounded behavior and reconciliation fixtures, while the other
clients expose code-level full listing/tree methods with no recent, push, or
native change-feed evidence. They are polling-full-only candidates based on
source evidence, not live-contract proof. The complete source audit and
documentation/fixture gaps are recorded in
`docs/provider-capability-audit-2026-09-17.md`.

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
