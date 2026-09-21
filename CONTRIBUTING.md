# Contributing to SchröDrive

Thank you for considering contributing to **SchröDrive** — the ultimate media automation orchestrator for debrid services. This guide explains how to get started, what we expect from contributors, and how to make your pull request as smooth as possible.

> **TL;DR:** Fork → branch → `bun install && bun run typecheck && bun test` → PR. Keep it small, tested, and documented.

---

## 1. Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating you agree to uphold it. Be respectful, constructive, and inclusive. Harassment, discrimination, or repeated unconstructive criticism will not be tolerated. Report issues to the maintainers via GitHub.

---

## 2. Ground Rules

These are the non-negotiables for every contribution:

1.  **TypeScript + Bun.** The codebase is `commonjs` + `typescript@^5.9` run on `bun >=1.2`. Do not introduce Node-only APIs without a Bun-compatible fallback.
2.  **One concern per PR.** A PR should do one thing well (fix, feature, docs). Large refactors should be split into stacked PRs.
3.  **Tests are required.** New behaviour needs `bun:test` coverage. Bug fixes need a regression test in `tests/regressions/<issue-slug>/`. See §6.
4.  **Type safety.** `bun run typecheck` (`tsc --noEmit`) must pass. Avoid `any` where a precise type exists; prefer `unknown` + narrowing.
5.  **No secrets in commits.** Never commit `.env`, tokens, or `data/*.db`. `data/` is ignored by design. Use `process.env` via `src/core/config.ts`.
6.  **Shared utilities, not copy-paste.** Common helpers belong in `src/core/utils.ts` (e.g. `sanitiseName`, `splitCsv`, `asBool`, `base32ToHex`). Do not re-implement inline.
7.  **Provider isolation.** A provider implementation must only touch `src/providers/<name>.ts` and register via `registry.register()`. No cross-provider imports.
8.  **Backward compatibility.** Configuration is env-var driven. New env vars need a sensible default in `config.ts` and a row in `README.md` → Configuration.
9.  **Documentation.** User-facing changes need a `README.md` and/or `CHANGELOG.md` entry.

---

## 3. Getting Started

### Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [Bun](https://bun.sh) | `>=1.2.0` (`bun --version`) | Runtime, package manager, test runner |
| [rclone](https://rclone.org) | any | Only needed if you test FUSE mounts (`RUN_MOUNT=true`) |
| [Docker](https://www.docker.com) | optional | For `docker-compose up` integration tests |

### Clone & install

```bash
git clone https://github.com/moderniselife/SchroDrive.git
cd SchroDrive
bun install          # installs deps + sets git hook path (core.hooksPath → .githooks/)
bun run build        # tsc → dist/
```

### Project layout

```
SchroDrive/
├── src/
│   ├── core/               # config, db (bun:sqlite WAL), utils, blacklist, logger
│   ├── providers/          # 11 debrid providers + registry.ts (strategy: all/failover/single)
│   ├── services/           # arrBridge, webdavBridge, organizer, mount, deadScanner, ...
│   │   └── cloudLinks/     # Mega / GDrive / Dropbox / HTTP public-folder adapters
│   ├── indexers/           # Prowlarr, Jackett + stremio scrapers (torrentio/comet/zilean/mediafusion)
│   ├── integrations/       # Plex / Jellyfin / Emby / Trakt / Mdblist / Listrr
│   ├── index.ts            # CLI (commander)
│   └── server.ts           # Express API + SSE
├── tests/
│   ├── unit/               # bun:test, no I/O
│   ├── e2e/                # boots real Express apps on scratch ports
│   └── regressions/        # one folder per fixed bug (e.g. 57-arr-bridge-wildcard-route)
├── assets/                 # logo
├── data/                   # schrodrive.db, tokens.db (gitignored)
├── dist/                   # compiled JS (checked in for Docker COPY)
└── docker-compose.yml
```

---

## 4. Development Workflow

### 4.1 Branch & commit

```bash
git checkout -b feat/<short-name>        # or fix/<issue-num>-<slug>
# ... hack ...
bun run typecheck && bun test             # must be green before pushing
git add -A
git commit -m "feat(plex): add watchlist pagination"
git push -u origin feat/<short-name>
```

* **Branch naming:** `feat/`, `fix/`, `docs/`, `chore/`, `refactor/` followed by kebab-case. Include the issue number when applicable (`fix/57-arr-bridge-wildcard`).
* **Commit style:** Conventional Commits encouraged (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`). Scope in parentheses is optional but helpful (`feat(providers):`).
* **Hooks:** `.githooks/pre-commit` runs `typecheck + test` automatically after `bun install`. Bypass only with `git commit --no-verify` and justify in the PR.

### 4.2 Pull requests

1.  **Open against `develop`**, not `main`. `main` is release-only.
2.  Fill in the PR template: *what/why, how tested, screenshots if GUI, breaking changes*.
3.  Keep the diff < 400 lines when possible. Larger changes should include a migration note.
4.  CI must be green: `typecheck` + `bun test tests/unit tests/e2e tests/regressions`.
5.  At least one maintainer review is required. Address review comments with fix-up commits; the maintainer will squash-merge.

### 4.3 Reporting bugs & requesting features

* **Bug report:** Use the *Bug report* issue template. Include `bun --version`, `docker logs`, reproduction steps, and the failing `curl` or test case.
* **Feature request:** Use the *Feature request* template. Describe the use-case, not just the solution.
* **Security:** Do **not** open a public issue for sensitive vulnerabilities. Email `joe@deiterate.com` or use GitHub's *Report a vulnerability* flow.

---

## 5. Running the App Locally

```bash
# Minimal env – starts the HTTP server + WebDAV bridges, no mounts:
PROVIDERS=torbox,realdebrid \
TORBOX_API_KEY=tb_xxx \
RD_ACCESS_TOKEN=rd_xxx \
PROWLARR_URL=http://localhost:9696 PROWLARR_API_KEY=px_xxx \
bun --watch src/index.ts serve

# Health check:
curl -s http://localhost:8978/health | jq
curl -s http://localhost:8282/health       # *arr bridge (if ARR_BRIDGE_ENABLED=true)
```

* `MOUNT_BASE` on macOS defaults to `/Volumes/SchroDrive`; on Linux to `/mnt/schrodrive`.
* Logs are in-memory and streamed via `GET /api/logs/stream`.

---

## 6. Tests

```bash
bun test                          # all suites
bun test tests/unit               # fast, no I/O
bun test tests/e2e                # boots real Express servers
bun test tests/regressions        # one folder per bug

bun run test:unit
bun run test:e2e
bun run test:regressions

# Single file (useful while iterating):
bun test tests/e2e/arr-bridge/qbittorrent-api.test.ts --timeout 10000
```

**Test rules:**

* **Unit tests** (`tests/unit/**/*.test.ts`) — pure functions, no network or `bun:sqlite`. Mock providers with `vi`/`mock`.
* **E2E tests** (`tests/e2e/**/*.test.ts`) — may start an Express server on a scratch port (`18283+`). Always:
    ```ts
    // Isolate SQLite – each suite needs its own file, not data/schrodrive.db:
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'my-test-'));
    config.mountBase = tmp;
    config.dbPath = path.join(tmp, 'test.db');
    try { (await import('../../src/core/db')).closeDb(); } catch {}
    await startArrBridge();
    // ... and in afterAll:
    await stopArrBridge();
    try { (await import('../../src/core/db')).closeDb(); } catch {}
    ```
    The bridge now supports concurrent ports via `servers: Map<number, http.Server>` – do not introduce new singletons.
* **Regression tests** (`tests/regressions/<issue>-<slug>/*.test.ts`) — one folder per fixed issue (e.g. `57-arr-bridge-wildcard-route`). The folder name must reference the issue number. Add a header comment linking to the GitHub issue.
* **Flaky tests are bugs.** If `bun test` passes in isolation but fails when run with `bun test tests/unit tests/e2e tests/regressions`, the test shares mutable global state (`config`, `tracked`, `db`). Fix the isolation instead of increasing the timeout.
* **Coverage is aspirational.** Aim to cover the *critical path* (auth, search, add, dedup, mount). 100% coverage is not required, but uncovered critical paths should be justified in the PR.

---

## 7. Code Style & Quality

* **Formatting:** Follow the existing style (2-space indent, `camelCase` for vars, `PascalCase` for types). No formatter is enforced yet – keep diffs minimal.
* **Types:** `tsconfig.json` is `strict`. Prefer explicit return types on exported functions.
* **Logging:** Use the shared logger (`src/core/logger.ts`) or a timestamped prefix (`[provider-id]`). Do not `console.log` raw tokens.
* **Error handling:** User input and third-party responses are untrusted. Validate, escape (see `escapeDriveQueryValue`), and fail open with a logged warning rather than crashing the process.
* **Shared helpers:** Before adding a new helper, check `src/core/utils.ts`. The helpers `sanitiseName`, `splitCsv`, `asBool`, `asNumber`, `sleep`, and `base32ToHex` are already there – import them.
* **Express 5:** The project uses `express@^5.1` (`path-to-regexp@8`). Bare `*` wildcards are not supported – use the named form `/{*splat}` (see `src/services/webdavBridge.ts` and `src/services/arrBridge.ts`).

---

## 8. Adding a New Debrid Provider

Provider support is intentionally **one file + one registration call**. Full walkthrough in `src/providers/README.md`.

**Checklist:**

1.  Create `src/providers/<myprovider>.ts` implementing `DebridProvider` from `src/providers/index.ts`.
2.  Implement at minimum: `isConfigured`, `isRateLimited`, `listTorrents`, `addMagnet`, `fetchDirectories`, `resolveDownloadUrl`, `hasDirectWebDAV`, `getWebDAVConfig`, `getBridgePort`.
3.  Add config keys to `src/core/config.ts` (API key, base URL, WebDAV URL, `*_DOWNLOAD_TOKENS`).
4.  Register at the bottom of `src/providers/index.ts`:
    ```ts
    import './myprovider';
    ```
5.  Add the provider to the `PROVIDERS` examples in `.env.example` and `README.md`.
6.  Add unit tests that mock the provider API (see `tests/unit/providers/alldebrid.test.ts`).
7.  Open a draft PR labelled `provider` so maintainers can test against a live account.

---

## 9. Adding a New Indexer / Scraper

* Indexers (Prowlarr/Jackett) live in `src/indexers/`. Scrapers (Torrentio, Comet, Zilean, Mediafusion) use `src/indexers/stremioScraper.ts` as a shared fetcher.
* Normalise results to the common shape (`title`, `hash`, `seeders`, `size`, `indexerId`). Use `src/indexers/shared.ts` helpers (`buildMagnetFromHash`, `stripTmdbQuery`).

---

## 10. Licensing

By contributing you agree that your contributions are licensed under the same **MIT License** that covers the project (`LICENSE`). You retain copyright to your work, but you grant the project the right to distribute it under MIT.

---

## 11. Getting Help

* **Questions:** Open a *Discussion* on GitHub.
* **Chat:** Mention a maintainer (`@moderniselife`) in an issue/PR.
* **Maintainer:** Joseph Shenton — [joe@deiterate.com](mailto:joe@deiterate.com) — [@moderniselife](https://github.com/moderniselife)

Thank you for making SchröDrive better!
