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
- `createGetService()`, which cold-opens the configured LocalStore, resolves the
  id against the effective Practices, and throws `UnknownPracticeError` when no
  Practice matches. It returns the result plus `generation` and
  `effectiveRevision`.

The `sources` projection type `PracticeSourceResult` lives in the engine's shared retrieval layer (the same neutral home as `tokenize`/`top-k`). The `null` → `UnknownPracticeError` conversion happens only inside `createGetService()`; the CLI never inspects `null` and never constructs that error itself.

The CLI adapter calls `GetService`; it never accepts a Pack path, decodes a Pack, or performs its own filesystem discovery. A future MCP tool will call the same service.

For the CLI's single invocation, the service cold-opens the configured
LocalStore once per call; this preserves the ADR 0007 integrity checks without
holding a long-lived process open. A future long-lived MCP adapter must not
copy that per-call policy unchanged: it should reuse one open store and
re-open only when `generation` changes, then carry that policy in its own MCP
contract.

### Result

A successful result contains:

- the complete effective Practice as produced by LocalStore canonicalization, including `severity`, `body`, and `anti_patterns` — these are always present and normalized (`severity` defaults to `warn`, `body` to `""`, `anti_patterns` to `[]`, and each anti-pattern `severity` defaults to `warn`). The `PracticeSnapshot` model type is tightened to reflect this canonicalization invariant: the three fields are required, not optional, so consumers need no `undefined` defense. ADR 0007 §2 freezes the canonical object and author-visible array order; this ADR makes the nested `anti_patterns[].severity` default explicit as an extension of the same canonicalization rule.
- every active LocalStore source claim via the shared `PracticeSourceResult` projection, not a re-declared copy. `PracticeSourceResult` lives in the engine's shared retrieval layer and is available to future retrieval features.

The top level reports LocalStore `generation`, `effectiveRevision`, `practice`, and `sources`. The Practice `id` is the single source of truth for the resolved key; no redundant top-level `practiceId` is emitted.

An unknown id raises `UnknownPracticeError` from the engine, which the CLI adapter maps to the `get.unknown_practice` error code with exit code 2. `get.unknown_practice` must be listed in the command's `errorCodes` allowlist alongside `store.busy` and `store.recovery-required` (ADR 0004 requires every visible error be declared). It uses exit 2 because an unknown id is an exact-address error, not a successful domain finding; this matches the current `sync` command's `localization.practice-not-found` precedent. Exit 1 remains reserved for ADR 0004 blocking domain findings, and the removed `decide.unknown_decision` command is not used as a precedent. LocalStore busy/recovery failures remain typed errors at the adapter boundary.

An id that is not a valid dotted Practice id (ADR 0003 `ID_REGEX`) is rejected
by the CLI before store dispatch as `usage.invalid`. This keeps invalid
addresses distinct from valid but unknown Practice ids (`get.unknown_practice`).
Engine callers still see valid-format unknown ids as `UnknownPracticeError`;
the CLI owns the user-facing syntax boundary.

### Non-goals

Batch retrieval by multiple ids, explicit-Pack debug paths, `--full` switches, structured filters, semantic/vector retrieval, project scope, and MCP wiring are deferred. Batch or filtered retrieval requires its own contract and must not be implied by this command.

## Consequences

The first official get slice reuses installed, validated, effective Practices, returns the complete canonical Practice the caller asked for by id, and preserves source provenance. It replaces the fork's Pack-path get without reintroducing a second runtime source. Unknown-id remains a hard error rather than a silent empty result, matching the precise-by-id nature of `get` and the current `sync` command's exact-address error pattern. Batch access remains a future extension.

**Follow-ups:**

- Cross-call read consistency is not defined here. A single invocation reads one consistent LocalStore snapshot, but orchestrating query-then-get across separate invocations can cross a store revision or observe a Practice removed between calls. A future batch/sequence contract must define the snapshot semantics before adding such an orchestration surface.
