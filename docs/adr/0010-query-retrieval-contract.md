# ADR 0010: LocalStore-backed lore query retrieval contract

- **Date:** 2026-09-03
- **Status:** Proposed (local implementation)
- **Related:** ADR 0003 (Practice format), ADR 0004 (agent-first CLI protocol), ADR 0007 (LocalStore), ADR 0008 (user-scope Pack install)

## Context

ADR 0007 makes LocalStore the runtime source for `query/get/decide/check`, and ADR 0008 installs active Packs into the user scope. The README already promises `lore query` as the primary task-and-moment retrieval entry point, but the official CLI model has no executable query command yet.

An earlier fork prototype used `lore query <pack-path> --query <text>` with an explicit Pack path and a `--full` body switch. That contract pushed Pack discovery onto the caller and created a second runtime source beside LocalStore. Its deterministic ranking evidence is reusable; its command surface is not the product boundary.

## Decision

### Command surface

```text
lore query <query> [--top-k <count>]
```

`<query>` is non-empty natural-language text describing the engineering task or the current work moment. It may mention a path, but v1 does not parse or read that path. `--top-k` defaults to 5 and accepts only integers 1..50.

The command honors the global `--store-root` option through the same invocation Store resolution as `lore install`, so retrieval reads the same selected Store instead of silently falling back to the user-level default.

### Application boundary

`@lorelum/engine` exposes:

- pure `retrievePractices()` over LocalStore `EffectivePractice[]`;
- `createQueryService()`, which cold-opens the configured LocalStore and returns the retrieval result plus `generation` and `effectiveRevision`.

The CLI adapter calls `QueryService`; it never accepts a Pack path, decodes a Pack, or performs its own filesystem discovery. A future MCP tool and `lore get` full-body retrieval will call the same LocalStore boundary.

### Result

Each result contains the Practice summary metadata only:

- `id`, `title`, `stage`, `tech_stack`, `applies_when`.

The top level reports `query`, `k`, `total`, LocalStore `generation`, `effectiveRevision`, and ranked `results`. Ranking is descending deterministic token-match score (title weight 3, `applies_when` weight 2, stage/tech_stack/body weight 1), then ascending Practice id. Query and Practice text share the engine's retrieval tokenizer (`normalizeTokens`), including overlapping CJK bigrams, so Chinese tasks match contiguous Chinese Practice text without a segmentation dependency. Token-less or unmatched queries return successful empty results; blank input remains a usage error. LocalStore busy/recovery failures remain typed errors at the adapter boundary.

### Non-goals

Full-body results, explicit-Pack debug paths, structured filters, semantic/vector retrieval, project scope, and MCP wiring are deferred. Full Practice bodies belong to a separate `lore get` contract so query output stays a cheap summary slice.

## Consequences

The first official query slice reuses installed, validated, effective Practices, preserves LocalStore provenance metadata at the top level, and keeps the command shape the README already documents. Until semantic/vector retrieval lands, recall is limited to deterministic token matching. The fork's `--full` switch is intentionally not migrated; summary-versus-full retrieval is split between `query` and a future `get`.
