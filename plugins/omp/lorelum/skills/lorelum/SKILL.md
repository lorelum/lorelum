---
name: lorelum
description: Find and apply Practices for design, code, tests and acceptance; never reset plans. Inspect existing phases, tasks, and statuses before updating them.
---
<!-- Generated from scripts/skill-guidance/content/skill.md.tmpl and profiles.ts. Run bun run skills:generate to regenerate. -->

# Lorelum

## Find and read guidance

Use a Pack Catalog already available in the task context. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. Main receives the Catalog; task/eval children do not by default (`agent.subagentPackCatalog: false`). Do not run `lore pack list --details` merely because a child has no Catalog or bootstrap a Catalog automatically. If Main has no usable Catalog and needs new guidance discovery, run `lore pack list --details` once and reuse it. Independent Pack discovery is allowed when a material decision in a child's assigned task actually requires it; then list once and reuse the result. If you only need to read a known exact Practice ID, do not establish a Catalog solely for that read.

If the user or current session has an existing task plan, inspect that plan with the host's task tool before changing it. Preserve its phases, tasks, and current statuses; advance a step only when its work is actually complete. Never initialize a replacement plan merely to continue the task or carry guidance. In omp, use `todo` with `op: "view"` to inspect the existing plan: `op: "init"` replaces every phase and resets statuses, even when given the same task text. If the plan cannot be inspected or safely updated, leave it unchanged and carry the guidance in working context.

For a material engineering decision, describe the observed situation, the decision you face, and the constraints or failure consequences that matter. For example:

```sh
lore query "Our payment API can time out after a charge commits, and clients may retry. New clients could send an idempotency key, but existing clients cannot be required to change their requests. I need to decide how keys are assigned and persisted so concurrent retries cannot create a second charge. Which design and failure cases should guide this choice?"
```

Read the full body of each candidate you intend to use with `lore get <practice-id>`; do not act on a query summary alone. Read default text directly, use `--verbose` for all result fields as text, and use `--json` when a program needs to parse the result.

At each relevant material decision, identify the concrete guidance the current work needs before proceeding:

- During design and planning, consider the design choice and its failure consequences.
- After planning, before the first implementation change, consider the target project, language, module, and change.
- Before designing or writing tests, consider the behavior, failure cases, and test boundaries. Before first choosing how to run them, consider the execution environment and isolation.
- Before diagnosing a failure or reworking the change, consider the observed failure. Before acceptance, consider the evidence and remaining risks.

For each decision, check whether applicable guidance is already available. A general instruction, Catalog entry, or query for a different decision does not by itself resolve the current question. If the decision needs guidance that is still unknown, run a targeted semantic query for that specific situation; if you know the exact relevant Practice ID but have not read it in full, `lore get` it directly. If other guidance still needs discovery, query that gap as well. Read each Practice you intend to use in full, then apply its relevant, authorized guidance to the current decision and work before moving on. Reuse already-read guidance while it remains applicable. This applies even without a plan or task tool; reassess at decision points rather than querying mechanically for every edit or repeated test.

When using a task or plan tool, carry guidance from a fully read Practice into the current or future work it materially affects. If you already know the guidance when creating a step, include the Practice ID and the concrete action or check in that step. If a plan already exists, record the relevant guidance as soon as it is read, before doing the affected work or finishing its step, even when that step is already in progress. Annotate the step when the tool supports it; otherwise add one concise check item tied to the step, for example: "After implementing retries, check <practice-id>: an uncertain write must use idempotency or be reconciled before retrying." In omp, after `todo` `view`, append the check with `op: "append"`, the exact existing `phase` name, and an `items` array; do not use `init`. Add only checks needed for the actual task, not a duplicate implementation task or a generic "apply Practices" item. Preserve existing tasks and statuses. At the relevant step, use the guidance and check the work when it remains applicable and authorized; do not force it when it conflicts with user authorization or higher-priority instructions.

If you cannot inspect existing tasks or safely preserve them and their statuses, do not replace the plan to add a reminder; carry the guidance in your working context instead. If a prerequisite check can only be appended after its target step, state its actual timing and carry it out before that step, not merely when its displayed list position is reached. A check intended to verify completed work belongs after that work.

When a foreseeable material decision still needs guidance, record its specific question and timing in the relevant future step, or add a concise associated check if you cannot safely annotate it. For example, before implementing a project's change, query the applicable language and project constraints; before deciding verification, query the change's test boundaries and failure cases. At the step, reconsider the current task and guidance already obtained; if the question still needs research, run a targeted semantic query, read the full Practice before adopting it, and apply applicable guidance. If you already know a relevant Practice ID but have not read it in full, record a get at the appropriate step. Do not repeat a completed query merely because of a stale reminder or force guidance that no longer applies. Do not mechanically query before every edit or test. A summary or historical candidate is not the full Practice. Do not create a plan solely for Lorelum; without a plan or tool, carry applicable guidance in your working context.

Read-Practice hints in an omp child come from successful gets by the originating Main session, including in nested task/eval children. They are possibly relevant metadata, not the full guidance or proof of adoption. Read a candidate in full before using it; your own reads belong to your session and are not automatically added to Main's candidates. Enabling `agent.subagentPackCatalog: true` adds only Pack routing metadata, never complete Pack or Practice bodies.

## Recover a query or diagnose a failure

Run the default semantic query before checking Backend, model, or index status. If it returns a preparation state, follow [semantic query recovery](references/semantic-query-recovery.md) and retry the same query when ready. Do not silently switch to keyword; use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis.

If a Lorelum invocation fails and blocks the task or the user asks to diagnose that invocation, inspect its original `diagnostics.traceId` first when available, then follow the recovery reference. If a non-query failure has no trace, state that limit and follow its visible error instead; do not manufacture a trace. Retry the same Lorelum command when its cause is resolved:

```sh
lore logs --trace-id <traceId>
```

For a project test or other non-Lorelum failure, diagnose that failure in its own task context and assess the relevant guidance gap; do not assume it has a Lorelum trace.

## Use linked Pack resources

Resolve the path after a Practice's `resource:` link against the `packRoot` of its corresponding Store source in `lore get`. If multiple sources provide the Practice, use the task's Pack context to identify the source; do not guess or mix their roots. A ProjectContext `project-layer-N` is provenance, not a filesystem path.

For explicit Pack browsing, get its current root with `lore pack list <pack-name>`. After a Pack mutation, refresh the locator with `lore get` or the named `pack list`, as appropriate. Copy Pack assets into the task workspace before editing them; run Pack scripts only when the task authorizes it and their purpose and inputs are clear.

## Keep Backend available for a long task

If a multi-step task needs an already-running Lorelum Backend to remain available between calls, acquire a lease before that work, renew it before expiry, and release it when the task completes or is cancelled. A single query does not need a lease:

```sh
lore backend lease acquire
lore backend lease renew <lease-id>
lore backend lease release <lease-id>
```
