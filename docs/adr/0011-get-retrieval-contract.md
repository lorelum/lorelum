# ADR 0011: LocalStore-backed lore get retrieval contract

- **Date:** 2026-09-04
- **Status:** Proposed (local implementation)
- **Related:** ADR 0003 (Practice format), ADR 0004 (agent-first CLI protocol), ADR 0007 (LocalStore), ADR 0008 (user-scope Pack install), ADR 0010 (query retrieval)

## Context

ADR 0010 splits retrieval output in two: `lore query` returns a cheap summary slice (Practice `id`, `title`, `stage`, `tech_stack`, `applies_when`) without the body, and explicitly deferred full Practice bodies to a separate `lore get` contract. ADR 0007 makes LocalStore the runtime source for `query/get/decide/check`, and ADR 0008 installs active Packs into the user scope.

An earlier fork prototype used `lore get <pack-path> <practice-id>` with an explicit Pack path. That contract pushed Pack discovery onto the caller and created a second runtime source beside LocalStore. Its error semantics are reusable evidence; its command surface is not the product boundary.

## Decision

### Command surface

```text
lore get <practice-id> [--store-root <path>]
```

`<practice-id>` is the dotted Practice key declared by PracticeSchema. `get` retrieves exactly one Practice by id; it is not a search command and takes no `--top-k`. The command honors the global `--store-root` option through the same invocation Store resolution as `lore install` and `query`, so retrieval reads the same selected Store instead of silently falling back to the user-level default.

### Application boundary

`@lorelum/engine` exposes:

- pure `retrievePractice()` over LocalStore `EffectivePractice[]` returning a get-specific projection (`practice` plus projected `sources`) or `null`;
- `createGetService()`, which cold-opens the configured LocalStore, resolves the id against the effective Practices, and throws `UnknownPracticeError` when no Practice matches. It returns the result plus `generation` and `effectiveRevision`.

The `sources` projection type `PracticeSourceResult` lives in the engine's shared retrieval layer (the same neutral home as `tokenize`/`top-k`). The `null` → `UnknownPracticeError` conversion happens only inside `createGetService()`; the CLI never inspects `null` and never constructs that error itself.

The CLI adapter calls `GetService`; it never accepts a Pack path, decodes a Pack, or performs its own filesystem discovery. A future MCP tool will call the same service.

### Result

A successful result contains:

- the complete effective Practice as produced by LocalStore canonicalization, including `severity`, `body`, and `anti_patterns` — these are always present and normalized (`severity` defaults to `warn`, `body` to `""`, `anti_patterns` to `[]`). The `PracticeSnapshot` model type is tightened to reflect this canonicalization invariant: the three fields are required, not optional, so consumers need no `undefined` defense;
- every active LocalStore source claim via the shared `PracticeSourceResult` projection, not a re-declared copy. `PracticeSourceResult` lives in the engine's shared retrieval layer and is available to future retrieval features.

The top level reports LocalStore `generation`, `effectiveRevision`, `practice`, and `sources`. The Practice `id` is the single source of truth for the resolved key; no redundant top-level `practiceId` is emitted.

An unknown id raises `UnknownPracticeError` from the engine, which the CLI adapter maps to the `get.unknown_practice` error code with exit code 2. `get.unknown_practice` must be listed in the command's `errorCodes` allowlist alongside `store.busy` and `store.recovery-required` (ADR 0004 requires every visible error be declared). It uses exit 2 rather than ADR 0004's exit 1 for domain findings to stay consistent with `decide.unknown_decision` and the fork's `get.unknown_practice`. LocalStore busy/recovery failures remain typed errors at the adapter boundary.

### Non-goals

Batch retrieval by multiple ids, explicit-Pack debug paths, `--full` switches, structured filters, semantic/vector retrieval, project scope, and MCP wiring are deferred. Batch or filtered retrieval requires its own contract and must not be implied by this command.

## Consequences

The first official get slice reuses installed, validated, effective Practices, returns the complete canonical Practice the caller asked for by id, and preserves source provenance. It replaces the fork's Pack-path get without reintroducing a second runtime source. Unknown-id remains a hard error rather than a silent empty result, matching the precise-by-id nature of `get` and the existing `decide.unknown_decision` pattern. Batch access remains a future extension.
