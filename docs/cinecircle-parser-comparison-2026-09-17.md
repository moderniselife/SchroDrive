# Sanitized parser benchmark summary

Status: complete, read-only shadow benchmark; no migration decision.

## Measured results

| Result | Items | Percentage |
|---|---:|---:|
| Exact mapped match | 560 | 92.87% |
| Acceptable normalization | 13 | 2.16% |
| Mismatch requiring fix or Review | 30 | 4.98% |
| Total | 603 | 100.00% |

Film/series classification agreed for 603/603 items (100.00%). Season/episode
fields agreed for all applicable series items. Derived destination shape agreed
for all 603 items. Neither parse-level contract emitted language or IMDb/TMDb
identity, so those dimensions were not fabricated or compared.

## Mismatch summary

The mismatch class was movie filenames containing a parenthesized year followed
by a braced or bracketed marker. The structured result retained the movie
classification but could lose the separate year and become ambiguous. The
recommended fix is to strip trailing marker tokens before extracting a
parenthesized year. The 13 acceptable cases were punctuation/spacing
normalizations with equivalent identity.

## Harness and safety

Both parsers ran once against the same frozen 603-item manifest in isolated,
read-only/shadow tooling. The historical side used
`mediabridge-riven/src/media_parser.py` with its `plex_parser_v2` fallback;
the SchröDrive side used `src/services/mediaParser.ts`,
`src/core/mediaClassifier.ts`, and pure `computeTarget` projection. No import,
update, download, rename, sidecar, provider, Arr, Riven DB, production, or
DNS operation was invoked.

The local manifest and raw per-item outputs are deliberately ignored by Git
because they may contain personal media names, paths, IDs, or provider data.
This committed summary contains none of those values. Re-run references are
the ephemeral Riven parser harness and the isolated Bun parser harness
described in `cinecircle-parser-provenance-2026-09-17.md`.

## Review-ready summary

> On the complete 603-item read-only manifest, historical Riven/MediaBridge
> and SchröDrive agreed on film/series classification at 100%. Results were
> 92.87% exact, 2.16% acceptable normalization, and 4.98% mismatches. The
> remaining mismatch class is trailing marker handling around movie years;
> no language or metadata IDs were emitted at parse level.
