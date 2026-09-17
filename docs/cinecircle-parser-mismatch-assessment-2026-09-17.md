# Sanitized parser mismatch assessment

Assessment of the existing 603-item shadow comparison. This document contains
aggregates only; it intentionally excludes titles, paths, metadata IDs,
provider data, and raw per-item records.

## Taxonomy

| Group | Count | Share of 603 | Classification result | Identity/result interpretation |
|---|---:|---:|---|---|
| True film/series classification errors | 0 | 0.00% | 603/603 agreed | No item was misclassified as film versus series |
| Acceptable normalization: season/episode parser strategy | 12 | 1.99% | All agreed | Parser reason differed, but title, year, season/episode, and derived destination shape agreed |
| Acceptable normalization: movie-year parser strategy | 1 | 0.17% | Agreed | Parser reason differed, but all compared identity fields agreed |
| Mismatch: trailing marker prevents year extraction | 30 | 4.98% | All agreed | SchröDrive returned ambiguous status, retained film classification, and lost the separate year; title also differed |

The 13 acceptable cases are therefore normalization/strategy differences, not
user-visible identity errors. Their title, year, season/episode, and derived
destination comparisons were all equal. No language or IMDb/TMDb field was
emitted at parse level, so metadata association was not part of this set.

## User-visible problematic count

There are exactly 30 user-visible problematic files in the comparison set:

- 30 mismatch records;
- 30 unique benchmark record IDs;
- 30 unique source records;
- 0 classification errors;
- 0 season/episode errors;
- 30 title differences and 30 year differences;
- 30 ambiguous SchröDrive parse results.

The destination remained film-shaped for all 30, but the identity ambiguity
means these records require a parser fix or Review before unattended import.

## Shared fix pattern and effort

All 30 problematic records share one fix pattern: remove trailing braced or
bracketed marker tokens from the basename before extracting a parenthesized
movie year, while preserving the title/year fields. No separate classification,
series, metadata-ID, or destination fix is indicated by the data.

Estimated effort: **small** — one parser normalization path plus focused
regression cases and the existing isolated suite. Validation effort is also
small; rerun the same frozen manifest and require zero records in this mismatch
class. A larger effort would only be required if the fix were expanded into a
new metadata-matching or provider-import workflow, which is outside this
assessment.

## Validation basis

The counts were derived from the local ignored phase-2 comparison artifact and
its machine-readable summary. The committed report is sanitized; the raw
manifest and JSONL remain local-only under the repository ignore rules.
