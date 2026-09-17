---
name: lorelum
description: Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision.
---

# Lorelum

Lorelum is an optional local retrieval layer for engineering Practices. It stores reusable, trigger-conditioned Practices inside Knowledge Packs. It helps Codex bring relevant team knowledge into planning, implementation, verification, and recovery without becoming a task workflow or mandatory ceremony.

For normal retrieval, read the default text output directly. It is the complete visual representation of the command's public data, not a summary. Do not parse its layout as a protocol. Use `--json` only while diagnosing an unexpected result, checking protocol/envelope details, or deliberately passing a result to a machine parser.

## Use the injected Pack Catalog

Codex receives a compact **Installed Pack Catalog** from the SessionStart Hook. Treat it as lightweight routing metadata, not as complete engineering guidance or a hard filter. Each Pack entry includes its current, directly readable `packRoot` view rather than an internal artifact path, while resource files and Practice bodies remain absent. Use each Pack's description and declared stack scope as relevance hints.

Reuse that Catalog for the task; do not rerun `lore pack list --details` at the start because the Hook already supplies the same metadata. If the injected catalog is truncated or unavailable, do not assume omitted Packs are absent; run `lore pack list --details` only when refreshing discovery would help the current task or decision.

## Use semantic retrieval for material decisions

When the current scope, plan, high-risk boundary, verification, recovery, or completion moment is worth retrieving engineering guidance for, use this sequence. Describe the task goal, the decision currently being made, and the concrete boundary or constraint:

```sh
lore query "I am designing idempotent writes for a payment API. I need to decide whether the client or service generates the idempotency key, while preserving database uniqueness and safe retry behavior."
```

Then read the complete body of every candidate Practice you will use:

```sh
lore get <practice-id>
```

## Protect a host Agent's long-running Backend work

For a multi-step host task that must keep an already running Lorelum Backend available beyond one ordinary query, acquire a task lease before the long-running portion, renew it before expiry while the task continues, and release it in its completion/cancellation path. The lease is machine state, not a user decision: keep its opaque ID private and do not ask the user to operate it. Model preparation and semantic indexing publish their own Backend activity automatically; do not create a lease merely for a short one-shot query.

```sh
lore backend lease acquire
lore backend lease renew <lease-id>
lore backend lease release <lease-id>
```

## Use Pack resources when a retrieved Practice points to them

Packs may include optional `references/`, `assets/`, and `scripts/` directories. A Practice can point to one with a normal Markdown link whose target begins with `resource:`, for example:

```markdown
[API compatibility matrix](resource:references/api-compatibility.md)
```

The link is the Practice's suggested route for the current task, not an access-control allowlist. When the relevant Pack is already clear, the SessionStart Catalog provides its `packRoot` for Pack-level browsing. Resolve the part after `resource:` from the corresponding source shown by `lore get` whenever the selected Practice has a source; this preserves source choice when multiple Packs provide the same Practice. A `packRoot` is a mutable current view, so after a Pack mutation retrieve the current Practice/source again before interpreting a resource. When the user explicitly needs to browse or maintain a Pack, `lore pack list <pack-name>` obtains a fresh `packRoot`. Do not construct paths from a Pack name or use the Store's SQLite/projection layout as an interface.

- Read linked `references/` material only when the Practice needs the extra detail.
- Copy an `assets/` file to the task destination before editing it; the installed Pack is not a writable work directory.
- Run a `scripts/` file only under the current task's authorization and with the Practice's stated purpose and inputs. Lorelum never runs Pack scripts automatically during install, validation, query, list, get, indexing, or recovery.

If `lore get` shows multiple sources, preserve their separate roots and do not silently combine their resources or choose one source. A returned root names the current local artifact; if it is no longer available after a Pack update, obtain a fresh locator with `lore get` or `lore pack list`.

The default query is semantic. Do not skip a ready semantic query solely because of expected latency. Do not run backend, model, index, or status commands before this query. Only after the query itself returns a preparation state or an error, read [semantic query recovery](references/semantic-query-recovery.md), follow the relevant recovery path, then retry the same query. Do not silently substitute keyword results for a failed or empty semantic query; use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis. Do not query before every edit, command, or ordinary reply.
