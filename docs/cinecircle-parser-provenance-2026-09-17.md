# Parser provenance and contracts

Read-only architecture record, 2026-09-17. No production, provider, DNS, or
runtime state was changed.

## Historical comparator

The historical comparator is the complete Riven/MediaBridge contract, not the
raw sidecar alone:

```text
src/media_parser.py:parse(filename, category)
  → src/plex_parser_v2.py:parse(filename) fallback
  → optional cinecircle-parser merge
  → parse-level identity/classification
```

The parse-level contract includes the fields actually exposed by the legacy
parser where present: film/series type, title/show, year, season, episode, and
file/legacy regex details. Later `src/event_processor.py` performs mapping,
TMDb metadata enrichment, canonical folder assignment, and Riven DB/symlink
updates. Those update operations are outside a shadow benchmark.

The optional `cinecircle-parser` sidecar is `node /app/server.mjs` and accepts
`POST /parse` with `{name: string, isTv: boolean}`. It returns the raw parser
object and is stateless. It is a parsing layer inside the historical Riven
flow, not the complete historical comparator.

## SchröDrive contract

`src/services/mediaParser.ts:parseMediaFilename(filename, relativePath)`
returns the structured identity fields it can establish: status, kind, title,
year, season/episode, extension, source basename, confidence, and reason.
`src/core/mediaClassifier.ts:classifyTorrent(filename)` derives the
Movies/Shows/Anime class. `src/services/organizer.ts:computeTarget` projects a
destination; it is a derived classification, not a parser-emitted metadata
ID. `src/services/arrBridge.ts` provides the qBittorrent-compatible lifecycle;
Arr performs metadata matching/import.

No language or IMDb/TMDb identity was emitted by either parse-level result in
the benchmark, so those fields were not invented or compared.

## Reproducibility

The benchmark harnesses are local-only and intentionally ignored by Git. The
historical pass invokes `media_parser.py` from an ephemeral Riven test image;
the SchröDrive pass imports `parseMediaFilename`, `classifyTorrent`, and
`computeTarget` in an ephemeral Bun container. Both consume the same frozen
manifest once, with read-only source/media access and no provider or database
writes. Raw manifests and JSONL outputs remain local for audit and are not
part of the repository.
