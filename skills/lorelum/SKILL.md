---
name: lorelum
description: Discover installed Lorelum Knowledge Packs, then retrieve relevant engineering Practices before a task or decision needs them.
---

# Lorelum

Lorelum is a local retrieval layer for engineering Practices. Packs contain reusable, trigger-conditioned guidance. Use it to bring the right Practice into planning, implementation, verification, recovery, and delivery without turning it into a mandatory workflow.

For normal retrieval, read the default text output directly. It is the complete visual representation of the command's public data, not a summary. Do not parse its layout as a protocol. Use `--json` only while diagnosing an unexpected result, checking protocol/envelope details, or deliberately passing a result to a machine parser.

## Establish the Pack Catalog once

At the start of each new engineering task, first check whether the current context already includes an installed Pack Catalog for this task. If it does, reuse it. If it does not, discover the installed Packs and their routing metadata once:

```sh
lore pack list --details
```

Use each Pack's description and declared stack scope as relevance hints, not as complete guidance or a hard filter. Each Catalog entry also includes its current `packRoot`, a directly readable `current` view rather than an internal artifact path. Keep this catalog for the task; do not rerun it before every edit, command, or ordinary reply. Refresh it only when the task scope changes materially, the Store may have changed, or discovery output was incomplete.

## Use semantic retrieval for material decisions

When the current scope, plan, high-risk boundary, verification, recovery, or completion moment is worth retrieving engineering guidance for, use this sequence. Describe the task goal, the decision currently being made, and the concrete boundary or constraint:

```sh
lore query "I am designing idempotent writes for a payment API. I need to decide whether the client or service generates the idempotency key, while preserving database uniqueness and safe retry behavior."
```

Then read the complete body of every candidate Practice you will use:

```sh
lore get <practice-id>
```

## Use Pack resources when a retrieved Practice points to them

A Pack can include optional `references/`, `assets/`, and `scripts/` directories. A Practice uses a normal Markdown link whose target starts with `resource:` to explain which material helps with the current decision, for example:

```markdown
[API compatibility matrix](resource:references/api-compatibility.md)
```

Treat this as task routing, not as a file-access allowlist. The Catalog can supply a Pack's `packRoot` as soon as its Pack context is clear. For a selected Practice, resolve the path after `resource:` from the matching source shown by `lore get`; this remains necessary when the Practice has multiple Pack sources. If the user explicitly asks to browse or maintain one Pack, `lore pack list <pack-name>` supplies a fresh `packRoot`. Do not infer Store paths from Pack names or rely on SQLite/projection layout.

- Read a `references/` file only when its linked Practice calls for the additional detail.
- Copy an `assets/` file to the task's working destination before filling in or changing it; do not treat the installed Pack as a writable work directory.
- Run a `scripts/` file only when the current task authorizes it and the Practice explains why it helps. `lore` does not run Pack scripts during install, validation, query, listing, get, indexing, or recovery.

When a Practice has multiple sources, keep their `packRoot` values distinct. Do not silently mix resources from different Packs or pick one source without a reason. `packRoot` is a mutable current view: a Pack update can make the same path resolve to new bytes, and removal can make it unavailable. After a relevant mutation, run `lore get` or `lore pack list` again before treating a resource as belonging to the selected source.

The default query is semantic. Do not skip a ready semantic query solely because of expected latency. Do not run backend, model, index, or status commands before this query. Only after the query itself returns a preparation state or an error, read [semantic query recovery](references/semantic-query-recovery.md), follow the relevant recovery path, then retry the same query. Do not silently substitute keyword results for a failed or empty semantic query; use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis. Do not query before every edit, command, or ordinary reply.
