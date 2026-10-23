---
name: lorelum
description: Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision.
---

# Lorelum

## Find and read guidance

Use the Installed Pack Catalog injected into Codex when it is visible. Its descriptions and stack scopes help identify potentially relevant Packs, but do not rule out other Packs. If the Catalog is missing or truncated and that affects discovery for this task, run `lore pack list --details`; do not run it just because the task started.

For a material engineering decision, describe the observed situation, the decision you face, and the constraints or failure consequences that matter. For example:

```sh
lore query "Our payment API can time out after a charge commits, and clients may retry. New clients could send an idempotency key, but existing clients cannot be required to change their requests. I need to decide how keys are assigned and persisted so concurrent retries cannot create a second charge. Which design and failure cases should guide this choice?"
```

Read the full body of each candidate you intend to use with `lore get <practice-id>`; do not act on a query summary alone. Read default text directly, use `--verbose` for all result fields as text, and use `--json` when a program needs to parse the result.

## Recover a query or diagnose a failure

Run the default semantic query before checking Backend, model, or index status. If it returns a preparation state, follow [semantic query recovery](references/semantic-query-recovery.md) and retry the same query when ready. Do not silently switch to keyword; use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis.

If a failure blocks the task or the user asks for diagnosis, inspect that invocation's `diagnostics.traceId` first, then follow the recovery reference and retry when the cause is resolved:

```sh
lore logs --trace-id <traceId>
```

## Use linked Pack resources

Resolve the path after a Practice's `resource:` link against the `packRoot` of its corresponding Store source in `lore get`. If multiple sources provide the Practice, use the task's Pack context to identify the source; do not guess or mix their roots. A ProjectContext `project-layer-N` is provenance, not a filesystem path.

For explicit Pack browsing, get its current root with `lore pack list <pack-name>`. After a Pack mutation, refresh the locator with `lore get` or the named `pack list`, as appropriate. Copy Pack assets into the task workspace before editing them; run Pack scripts only when the task authorizes it and their purpose and inputs are clear.

## Keep Backend available for a long task

If a multi-step host task needs an already running Lorelum Backend to remain available between calls, acquire a lease before that work, renew it before expiry, and release it when the task completes or is cancelled. A single query does not need a lease.

```sh
lore backend lease acquire
lore backend lease renew <lease-id>
lore backend lease release <lease-id>
```
