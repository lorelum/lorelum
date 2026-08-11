# ADR 0008: Decide evaluation contract

- **Date:** 2026-08-10
- **Status:** Proposed
- **Related:** ADR 0003 (`decisions.yaml` Decision Node schema), ADR 0004 (agent-first CLI protocol), ADR 0007 (engine LocalStore). Reference implementation: fork PR `SmallParamecium/lorelum#18` (MERGED) and its F1 boundary fix `SmallParamecium/lorelum#20` (carried into this change).

## Context

ADR 0003 freezes the `decisions.yaml` schema and Decision Node fields, and the P5 roadmap calls for a "decision graph evaluator," but the official `main` has no runtime command that executes a decision tree. The official CLI (ADR 0004, PR #21) is an agent-first protocol framework with no domain commands yet, so agents cannot map a structured project context to a deterministic decision path or obtain an auditable recommendation trace.

The fork (`SmallParamecium/lorelum`) implemented `lore decide` on a Commander-based CLI that diverged from the official framework after common ancestor `03761a3`: its handler protocol is `async (output, invocation)` and its runtime owns a pack loader, so its CLI layer cannot be reused directly. The engine/decide evaluator and `parseDecisionDocument` are pure logic that port cleanly. A stack-overflow defect (F1) in the when-condition parser — a flat binary-operator chain within the 256KiB input budget recursed through evaluation — was fixed in fork PR #20 with a regression test and must land with the port.

Scope decisions made before this ADR:

- **D0:** This issue is the structured decision-graph evaluator (P5 "decision graph evaluator" local v1), not the README natural-language `lore decide` (P0–P2 retrieval/LLM). They are complementary; the natural-language form is out of scope.
- **D1:** `decide <pack-path>` reads `<pack-path>/decisions.yaml` with a 256KiB cap. The full v1 directory-layout loader and its threat model (not accepted upstream) are a separate future task.
- **D2:** `--human` is not ported; the official protocol is a single JSON envelope (ADR 0004). Human rendering is deferred as a protocol extension.
- **D4:** ADR number 0008 — 0005–0006 are reserved for in-flight planning, 0007 is engine-local-store.

## Decision

### 1. Command surface and layering

`lore decide <pack-path> --decision <id> --context <json>` is registered on the official ADR 0004 framework:

- `@lorelum/engine` exposes a pure `evaluateDecisions` function (no filesystem or process I/O) plus the when-condition parser; the CLI and future MCP adapters share the same semantics.
- `@lorelum/format` adds `parseDecisionDocument` + `DecisionDocumentError`, reusing the existing `DecisionNodeSchema` unchanged.
- The CLI package owns argument parsing and the lightweight pack read (`readDecisionsDocument`), because the official `CliRuntime` deliberately exposes only a logger and the framework has no loader.

### 2. When-condition language (frozen)

Supported: dotted field paths (`state.client`) whose segments match `[A-Za-z_][A-Za-z0-9_]*` (hyphens are not valid in when paths, unlike Decision Node ids), string/boolean/number literals, `==`, `!=`, `&&`, `||`, `!`, parentheses. Explicitly not supported: JS execution, function calls, regular expressions, collection quantifiers. Bounds: parentheses + unary nesting ≤ 128; logical binary operators (`&&` / `||`) per condition ≤ 1024; deeper or longer conditions are rejected as `decide.invalid_condition` (exit 2). This is the F1 fix: a flat `&&` chain under the input budget previously overflowed the stack during evaluation.

### 3. Null safety and no-match

Missing context fields and type-incompatible comparisons evaluate to `false` — never an error. When no branch in the entry node (or after a `next` chain) matches, the command returns `status: "no_match"` with `noMatchReason` and exit 0. An empty decisions document is an empty decision list → `no_match` ("pack has no decisions"); the entry id is not validated when the list is empty.

### 4. Determinism and cycles

- Branches are evaluated in declaration order; the first matching branch wins.
- A matched branch may chain via `next` to another Decision Node id.
- Recommendations deduplicate by practice id on first occurrence; reasons from each matched branch append in match order.
- A runtime cycle along a `next` path is rejected as `decide.cycle` (exit 2). Duplicate decision ids are rejected up front as `decide.duplicate_decision`.

### 5. Audit trace

Every evaluation returns a full trace of visited nodes: `decisionId`, `question`, `matchedWhen` (the matched branch's when expression, or null), `nextDecision` (next node id, or null).

### 6. Result contract

Success envelope data:

```text
{ status: "matched" | "no_match",
  entryDecision: <id>,
  recommendations: [{ practiceId, reasons: string[] }],
  trace: [{ decisionId, question, matchedWhen, nextDecision }] }
```

`no_match` adds `noMatchReason`. Exit codes: `matched`/`no_match` = 0; every error = 2. Error codes enter the ADR 0004 allowlist mechanism and are surfaced verbatim: `pack.path_invalid`, `pack.unreadable`, `pack.parse_error`, `decide.unknown_decision`, `decide.invalid_condition`, `decide.duplicate_decision`, `decide.cycle`. This differs from `validate`'s exit-1-on-issues convention because decide reports runtime evaluation errors (usage/input/evaluation), not validation issues.

### 7. Pack input limits

`decide <pack-path>` requires `<pack-path>` to be a readable directory (`pack.path_invalid` otherwise), reads `<pack-path>/decisions.yaml` (`pack.unreadable` when missing or unreadable), enforces a 256KiB byte cap matching the fork's `v1PackInputLimits.maxDecisionBytes` (`pack.unreadable` when exceeded), and parses through `@lorelum/format`'s guarded `parseYaml` (`pack.parse_error`). A parsed non-list document is `pack.parse_error` ("The decisions document is not a list of decision nodes.").

### 8. Out of scope

Not part of this change: `--human` rendering, the `config` command, the full v1 directory-layout loader (ADR 0006 counterpart, not accepted upstream), when-syntax checks in `lore validate` (ADR 0003/0007 follow-up), natural-language decide, `lore query/get/check`, MCP tool wiring, and any change to pack.yaml / Decision Node / Practice public fields.

## Consequences

**Positive:**

- Deterministic, auditable, offline decision evaluation with a stable machine contract for agents.
- The pure engine evaluator is reusable by future MCP adapters without duplicating semantics.
- No new dependencies and no public schema changes; the F1 stack-overflow defect is fixed in-repo with regression coverage.

**Negative / accepted risk:**

- Human-readable rendering is deferred, so human users see only the JSON envelope until a future protocol extension.
- The loader only understands `decisions.yaml`; packs relying on the full v1 directory layout or `pack.yaml` metadata are not validated here — a missing `decisions.yaml` is `pack.unreadable`, not a "no decisions" pack. This matches D1 and is revisited when the official loader task lands.
- The when language is intentionally small; conditions needing functions, regex, or richer types require a superseding ADR.
- ADR numbering leaves 0005–0006 unused (reserved for in-flight planning); 0008 follows 0007 per the repo convention.

**Follow-ups:**

- Official loader task: replace `readDecisionsDocument` with the full v1 directory-layout loader and its threat model.
- `--human` / protocol presentation extension discussion (D2).
- `lore validate` when-syntax checking as part of ADR 0003/0007 follow-ups.
- Natural-language `lore decide` (P0–P2 retrieval/LLM) as a separate issue.

## References

- ADR 0003 — `decisions.yaml` schema and Decision Node fields consumed by this command.
- ADR 0004 — agent-first JSON-envelope CLI protocol this command is registered on.
- ADR 0007 — engine LocalStore; its validation follow-ups include when-syntax checks.
- Fork reference implementation: `SmallParamecium/lorelum#18` (MERGED; source for engine/decide and format `parseDecisionDocument`).
- F1 fix: `SmallParamecium/lorelum#20` (binary-operator bound + regression tests).
- Issue: lorelum/lorelum#24 — this change.
