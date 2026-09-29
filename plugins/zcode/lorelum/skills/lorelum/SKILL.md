---
name: lorelum
description: Use Lorelum's injected Pack Catalog to discover and retrieve relevant engineering Practices for the current task or decision, including through the /lore command.
---

# Lorelum

Lorelum is an optional local retrieval layer for engineering Practices. It stores reusable, trigger-conditioned Practices inside Knowledge Packs. It helps ZCode bring relevant team knowledge into planning, implementation, verification, and recovery without becoming a task workflow or mandatory ceremony.

For normal retrieval, read the default text output directly. For `list`, `query`, and `get`, it is a concise decision view rather than a full data dump, and its layout is not a protocol. Use `--verbose` to see the complete result data as text, or `--json` when you need the full machine-readable data and envelope for protocol inspection or parsing.

## Use the injected Pack Catalog

ZCode receives a compact **Installed Pack Catalog** from the SessionStart Hook. Treat it as lightweight routing metadata, not as complete engineering guidance or a hard filter. Entries provide the Pack name and, when available, its description and non-empty declared stack scope; the Hook does not include Pack versions or filesystem roots. Resource files and Practice bodies remain absent. Use the description and declared stack scope as relevance hints.

Reuse that Catalog for the task; do not rerun `lore pack list --details` at the start merely to rediscover its routing hints. If the injected catalog is truncated or unavailable, do not assume omitted Packs are absent; run `lore pack list --details` only when refreshing discovery would help the current task or decision.

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

## Diagnose current-trace failures and offer local feedback without interrupting the main task

A normal `lore` text failure displays `diagnostics.traceId`; the `--json` envelope carries the same local correlation ID. It identifies one invocation chain, not a credential, user identity, or public sharing ID.

If a clear Lorelum bug, retrieval/guidance gap, or requested capability does not block the task and the user did not ask for diagnosis, retain only a candidate—no extra logs, draft, upload, or Issue—and finish the task. Make at most one non-blocking feedback offer at the final summary or a visible milestone.

If the failure blocks the task, or the user explicitly asks for diagnosis, inspect only its original trace:

```sh
lore logs --trace-id <traceId>
```

Do not scan another trace or arbitrary location, and do not preflight Backend, model, index, or status before this read. Then read [diagnostic recovery](references/semantic-query-recovery.md). It owns evidence limits, controlled debug reproduction, consented local feedback, and semantic-query lifecycle recovery including progressive index operations.

## Use Pack resources when a retrieved Practice points to them

Packs may include optional `references/`, `assets/`, and `scripts/` directories. A Practice can point to one with a normal Markdown link whose target begins with `resource:`, for example:

```markdown
[API compatibility matrix](resource:references/api-compatibility.md)
```

The link is the Practice's suggested route for the current task, not an access-control allowlist. Resolve the part after `resource:` from the `packRoot` of the corresponding Store source returned by `lore get`. If `lore get` returns multiple sources, match each source's `packName` and `sourcePath` to the relevant Pack context and use that source's root. Keep roots separate; if the context does not identify the intended source, preserve the ambiguity rather than silently choosing one. A ProjectContext source's `project-layer-N` is logical provenance, not a filesystem path or resource root. A Store `packRoot` is a mutable current view, so after a Pack mutation retrieve the current Practice/source again before interpreting a resource. When the user explicitly needs to browse or maintain a Pack, run `lore pack list <pack-name>` to obtain its current `packRoot`. Do not construct paths from a Pack name or use the Store's SQLite/projection layout as an interface.

- Read linked `references/` material only when the Practice needs the extra detail.
- Copy an `assets/` file to the task destination before editing it; the installed Pack is not a writable work directory.
- Run a `scripts/` file only under the current task's authorization and with the Practice's stated purpose and inputs. Lorelum never runs Pack scripts automatically during install, validation, query, list, get, indexing, or recovery.

If `lore get` shows multiple sources, preserve each root and use the relevant Pack context to match a resource to its source. Do not combine roots, and do not choose a source when the context does not resolve the match. A returned Store root names the current local artifact; if it is no longer available after a Pack update, obtain a fresh locator with `lore get` or, for explicit Pack browsing, `lore pack list <pack-name>`.

The default query is semantic. Do not skip a ready semantic query solely because of expected latency. Do not run backend, model, index, or status commands before this query. Only after the query itself returns a preparation state or an error, read [semantic query recovery](references/semantic-query-recovery.md), follow the relevant recovery path, then retry the same query. Do not silently substitute keyword results for a failed or empty semantic query; use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis. Do not query before every edit, command, or ordinary reply.
