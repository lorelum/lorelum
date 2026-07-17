# ADR 0003: Practice & Pack format and validation semantics

- **Date:** 2026-07-17
- **Status:** Accepted
- **Related:** ADR 0002 (toolchain: `zod` is the schema library), internal research "React Practice 与 Vercel 对照评测" and "Practice Embedding 实施方案"

## Context

The Practice/pack format is Lorelum's public contract — once packs are authored and published against it, changes are breaking. Two upstream research docs (seed Practice content, embedding implementation) had already *assumed* the shape of a Practice (frontmatter fields, stable anti-pattern ids, canonical-text fields) without that shape ever being formally defined. The format is the common upstream of the retrieval engine (`CanonicalTextBuilder`, index `records`), the CLI (`lore query/get/decide/check`), and the seed Practice content being authored in parallel.

So the task was not "design a yaml schema from scratch" but **converge the already-assumed structure into an explicit, reasoned contract**, and decide `lore validate`'s validation semantics. Six points had no settled answer and needed product decisions, not just technical research.

## Decision

### 1. Field inventory

Three layers (full table lives in the internal "定稿：格式规范 v1" doc; summarized here):

- **pack.yaml**: `name`, `version` (semver) required; `description`, `author`, `license`, `applies_to`, `depends_on` optional. `depends_on` is reserved-but-ignored (see point 5).
- **Practice frontmatter**: `id` (dotted, e.g. `react.api.layered-design`), `title`, `stage`, `tech_stack[]`, `applies_when` required; `severity` optional.
- **Decision Node** (`decisions.yaml`): `id`, `question`, `branches[]` with `when` / `recommend[]` / `reason`. Each branch optionally carries `next` (a Decision Node id) to chain to the next decision — `recommend` strictly references Practice ids, `next` strictly references Decision ids. Cycle detection (point 3) runs over the `next` edges.
- **Anti-patterns** are first-class: `{ id, name, description, severity }`, with a reserved `check` field whose format is **not defined in v1** (see point 6).

`profile` (embedding model config) is deliberately **not** in pack.yaml — pack owns content, profile owns index config, different lifecycles.

### 2. error/warning semantics — reframed for an AI-consumption product

This is the most consequential decision in this ADR.

The conventional framing ("error = the pipeline breaks") **does not hold for Lorelum**. Lorelum's consumer is an AI agent, not a compiler. A Practice with a dangling reference still installs, still gets queried, still gets injected — the worst case is the AI receives one fewer useful hint. The agent does not crash; output quality may degrade. So "runtime reference = error because the link breaks" rests on a false premise.

**Reframed principle: error/warning govern the pack lifecycle (authoring + publishing), not the AI runtime.**

- **error** targets the **pack author** ("your pack is incoherent") — enforced by `lore validate` as the author's CI tool and by registry publish CI. Local dev can pass `--lenient` to skip.
- **warning** = pack works but has a quality risk.
- The AI runtime (`query/decide/check`) essentially never sees an error; it only ever sees "nothing retrieved" (empty), which is a recall-quality matter, not an error.

Consequence for dangling references: references consumed at runtime (Decision Node→Practice, Practice→Practice, anti-pattern→Practice) are **error** (the pack is incoherent); references used only in evaluation assets (`coverage-manifest` → external baseline id) are **warning**.

### 3 & 5. Circular dependencies + pack-to-pack dependencies (decided together, as they are coupled)

- **Decision Node ↔ Decision Node cycles = error.** Detected by DFS topological sort on the `branches[].next` edges (each `next` references another Decision id). A decision graph you can never finish walking makes `lore decide` recurse forever.
- **Pack-to-pack dependencies: not supported in v1.** `depends_on` is retained as a field but ignored; a non-empty value emits a warning ("v1 ignores pack-to-pack deps"). Rationale: YAGNI (one pack exists today), it would force a mini-npm (resolution, semver ranges, id-conflict handling, cycle detection) that inflates the storage engine's complexity, and the reuse need will be clearer at P3+ when more packs exist.

### 4. error/warning/info boundary

- **error**: missing required field, wrong type, malformed/duplicate id, dangling runtime reference, Decision Node cycle.
- **warning**: non-empty `depends_on`, dangling coverage-manifest reference, missing `severity`, `applies_when` too short (<10 chars), empty guidance body.
- **info**: two Practices with highly similar canonical text (possible duplicate), very small pack (<3 Practices).

### 6. Anti-pattern check rules: structured, but no machine DSL in v1

**Decision C** (of A/B/C): anti-patterns are structured (`id/name/description/severity`), with `check` reserved but undefined in v1.

Rejected **option B** (inline regex/AST check rules): it would force defining a check DSL (another public contract), the rules don't transfer across frameworks (a React AST rule is useless in Vue), and — most importantly — it would make Lorelum drift into a linter. The consumer is an AI that can read "don't call axios inside a component" in natural language; it does not need a machine rule.

So `lore check` (v1) is positioned as **retrieve the relevant anti-patterns and inject them for the AI to judge**, not auto-scan-and-fail. This is consistent with `lore query` — both are need-to-know injection. A real machine check engine, if ever wanted, is a separate later concern (P3+ or a plugin), not bound into the format contract.

## Consequences

**Positive:**

- The contract is minimal, explicit, and extension-safe (reserved fields instead of premature features).
- error/warning semantics match what Lorelum actually is (knowledge for AI), not a borrowed compiler metaphor — this prevents wrong validation logic from cascading into every downstream task.
- Storage engine scope is bounded: no dependency resolution, dedup by globally-unique Practice id is enough for v1.

**Negative / accepted risk:**

- **No pack-to-pack reuse in v1.** Content may be duplicated across packs. Accepted: one pack exists; duplication cost is near-zero until P3.
- **`lore check` is not an auto-linter in v1.** It surfaces relevant anti-patterns for the AI to judge. Teams expecting "run check, get a fail/pass verdict" will be surprised until the check engine lands later.
- **The error/warning reframe is non-obvious.** Contributors familiar with tsc/eslint will initially reach for the conventional semantics. This ADR (and the doc it points to) must be the place they read to correct that.
- **`check` reserved field.** If a future machine-check engine defines `check`'s shape, old packs that never set it are unaffected; packs that *did* set an experimental value would need migration — unlikely, since v1 says the format is undefined.
- **v1 gap — Practice→Practice body references are not yet validated.** §2.3 classifies "Practice→Practice body reference = error", but the *syntax* of in-body references is not yet defined (no `[[practice:<id>]]` or equivalent). v1 `lore validate` therefore checks only structural references — Decision→Practice (`recommend`), Decision→Decision (`next`), anti-pattern→Practice (structural ownership). In-body reference validation lands once the reference syntax is settled. Packs today carry no in-body references, so this is an accepted gap, not a regression.

**Follow-ups:**

- `lore validate` implementation lands with the format task (`@lorelum/format`): zod schema + reference-integrity check + cycle detection + severity-graded reporting. Tests use the seed Practices as fixtures.
- When `depends_on` is activated (P3+), add cycle detection to the pack-dependency graph and decide id-conflict policy (last-wins? error? namespace by pack?).
- The `check` engine, if pursued, becomes its own ADR — do not retrofit it into this one.

## References

- ADR 0002 (zod is the schema library; gray-matter is the frontmatter parser).
- Internal docs (Lorelum wiki, "技术规范" section): "定稿：格式规范 v1" (full field tables and validation rules) and "调研：pack.yaml / Practice 格式方案探讨" (candidate comparison and rejected options, including the error/warning reframe reasoning).
