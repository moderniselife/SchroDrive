# Contributors to SchröDrive

> **SchröDrive exists everywhere and nowhere — thanks to the people who observe it.**
>
> This file lists every human who has contributed code, docs, testing, or feedback to the project. Bot activity is listed separately. If we missed you, please open a PR!

---

## Core Team

| Name | GitHub | Role | Contact |
|------|--------|------|---------|
| **Joseph Shenton** | [@moderniselife](https://github.com/moderniselife) | Creator & Maintainer — architecture, providers, automation engine, WebDAV bridges, indexer integrations, SQLite persistence, release engineering | [joe@deiterate.com](mailto:joe@deiterate.com) / [joe@shenton.email](mailto:joe@shenton.email) |

Joseph is the original author of SchröDrive and reviews every pull request. All major subsystems — the provider abstraction, the 3-phase dead-torrent repair, the fake qBittorrent *arr bridge, the WebDAV bridge and organiser — were introduced by Joseph.

---

## Contributors

People who have authored commits merged to `main`/`develop`:

| Name | GitHub | Contributions | Highlights |
|------|--------|---------------|------------|
| **Sam Truman** | [@samtruman](https://github.com/samtruman) | 3 commits | `fix(webdav): preserve nested multi-file paths` — kept `__all__` hierarchy intact for multi-file torrents; `fix(alldebrid): use current magnet files API` — migrated AllDebrid to the current `magnet/files` lifecycle; `fix(arr-bridge): support multipart qBittorrent add requests` — Radarr/Sonarr send multipart when magnets exceed 1 KiB |

> **How we count:** `git log --format="%an <%ae>" | sort -u`. Commit counts above are from `git log` at 2026-09-21. GitHub's *Contributors* graph may show lower numbers because it only counts commits to the default branch.

---

## Bots & Automation

These are not human contributors, but they keep the repo healthy and are thanked separately:

| Bot | Purpose |
|-----|---------|
| [@dependabot[bot]](https://github.com/apps/dependabot) | Dependency updates (3 PRs merged) |
| [@github-actions[bot]](https://github.com/apps/github-actions) | CI / Docker release workflows (14 commits) |

---

## Acknowledgements

* **Plex, Jellyfin, Emby** — media servers whose watchlist and library-refresh APIs make automation possible.
* **Prowlarr & Jackett** — indexer proxies that normalise torrent search.
* **RealDebrid, TorBox, AllDebrid, Premiumize, Debrid-Link, Deepbrid, Offcloud, Put.io, MegaDebrid, Seedr, PikPak** — the 11 debrid providers SchröDrive orchestrates.
* **Stremio addon authors (Torrentio, Comet, Zilean, Mediafusion)** — whose public scrapers are optionally merged into search.
* **Zurg (debridmediamanager)** — inspiration for the WebDAV bridge and `download_tokens` rotation idea.
* **Every tester who files an issue** — especially those testing the 8 providers marked *Untested* in the README. If you have a Premiumize / Debrid-Link / Deepbrid / Offcloud / Put.io / MegaDebrid / Seedr / PikPak account, please try SchröDrive and share logs (redacted).

---

## How to be added

1.  Fork the repo, create a branch, and submit a PR (see `CONTRIBUTING.md`).
2.  Once your PR is merged, you will be added to this file automatically — or you can add yourself in the same PR by editing the table above.
3.  Significant contributions (new provider, major feature) may be highlighted in the *Highlights* column and in `CHANGELOG.md`.

The project is MIT-licensed (see `LICENSE`, copyright © 2025 moderniselife). All contributors retain copyright to their work and license it under MIT.

*Last updated: 2026-09-21 — generated from `git log --format="%an <%ae>" | sort -u` and `gh api repos/moderniselife/SchroDrive/contributors`.*

---

<p align="center">
  <em>Want to see your name here? Check <a href="CONTRIBUTING.md">CONTRIBUTING.md</a> for where to start.</em>
</p>
