# Parser strategy analysis

Analysis only, 2026-09-17. No parser replacement or parser code change is
proposed by this document.

## Decision

Extend SchröDrive’s internal parsing/normalization with the narrow historical
Riven behavior that the benchmark exposed; do not replace it wholesale with
Riven logic.

## Evidence

- The complete shadow comparison covered 603 items.
- Film/series classification agreed for 603/603 (100.00%).
- 560 were exact (92.87%), 13 were acceptable parser-strategy normalization
  differences (2.16%), and 30 were mismatches (4.98%).
- All 30 mismatches retained film classification and destination shape, but
  returned ambiguous identity with title/year differences.
- All 30 share one failure pattern: trailing braced or bracketed marker tokens
  after a parenthesized movie year.
- No parse-level language or IMDb/TMDb identity was emitted by either side.

## Why extension is the lower-risk contract

Riven’s `media_parser.py` is more than a filename parser: it applies the
`plex_parser_v2` fallback, optional sidecar merge, category handling, and later
feeds Riven metadata matching/import. SchröDrive’s internal parser is already
aligned on classification and season/episode behavior, while its organizer,
Review workflow, and Arr bridge have different ownership boundaries.

Replacing SchröDrive with the whole Riven parser would import unnecessary
Riven-specific category, metadata, and import assumptions into a service whose
target contract leaves metadata matching/import to Arr. It would also blur the
fork-only AllDebrid → SchröDrive → Arr boundary.

The measured fix is instead a focused normalization extension: remove trailing
marker tokens before extracting a parenthesized movie year, retain the existing
classification and season/episode logic, and preserve the Review path for
ambiguous results. The benchmark indicates no need to replace destination
projection or to duplicate Riven/TMDb metadata matching.

## Follow-up acceptance test

Add sanitized regression fixtures for the marker/year shape, rerun the same
frozen manifest, and require the 30-item mismatch class to reach zero without
reducing the 100% classification agreement or changing the 603-item derived
destination-shape result. Keep the historical parser contract as a comparator,
not as a runtime dependency.

This conclusion does not authorize a production rollout or a parser change.
