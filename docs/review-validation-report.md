# Organizer Review validation

Validated 2026-09-17 in the isolated `cinecircle-test` stack only.

- Docker image: `schrodrive:cinecircle-review-blocker`
- Test container: `schrodrive-test`, image digest `sha256:033645236d0d1d8af99b8573751ad7721965743c65922bf61cfd8d5fa45783f8`
- Build: serialized BuildKit build (`BUILDKIT_MAX_PARALLELISM=1`); backend TypeScript and Next production build passed.
- Unit/regression/E2E repository suite: **88 pass, 0 fail**, 16 files.
- Existing E2E suite: **13 pass, 0 fail**, 3 files.
- GUI queue: Chromium headless verified filters, result count, pagination, Accept, Dismiss, Retry / Resume, Details, and refresh controls.
- GUI detail: Chromium headless verified Review queue navigation, Review detail, Audit trail, and Retry / Resume.
- API matrix: verified pending/resolved decision filters, matched/ambiguous/unmatched parser filters, pagination, detail, audit, retry, invalid decision (400), and unknown detail (404).
- Runtime health: `http://127.0.0.1:8979/health` healthy; GUI served on `http://127.0.0.1:8980/review`.
- Test port sequence validated: API `8979`, GUI `8980`, host bridge `8981`; internal Arr bridge remains `schrodrive-test:8282` and legacy host ports `8282`/`8283` are closed.

No production services, DNS, or unrelated services were rebuilt or restarted.
