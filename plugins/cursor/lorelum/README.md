# Lorelum for Cursor

This is the first-party Cursor integration for Lorelum. It brings relevant engineering Practices into Cursor when they can inform a task or decision, without loading every rule at once. Its progressive-disclosure flow is:

The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the Cursor-specific distribution and operating model.

1. A compact **Installed Pack Catalog** makes the locally available Knowledge Packs discoverable.
2. The Lorelum Skill uses that catalog as a relevance hint, not as the full engineering rules or a hard filter.
3. At a material task, decision, verification, recovery, or completion moment, Cursor uses one targeted natural-language semantic query before deciding retrieval is not worth attempting.
4. Before applying a Practice or claiming that work follows it, Cursor reads the full Practice.

The `/lore` command is the explicit entry point: it accepts an optional natural-language question and routes it through the Lorelum Skill.

## Supported features and limits

Cursor provides the Skill, successful-read association, and an asynchronous Main Catalog that can arrive after the first turn. The Skill lists Packs once if no Catalog is visible. Main compact recovery is absent: compaction does not rerun `sessionStart`, and `preCompact` only returns a user message, not model context. Retaining the initial injected context does not refresh later read candidates. Subagent candidates and a separate child Catalog are also absent. See the [capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities) and [Cursor guide](https://lorelum.com/en/docs/cursor#supported-features-and-limits).


The bundled runtime integration calls `lore hook cursor`, the versioned Cursor Hook ABI. Cursor fires the `sessionStart` Hook when a new conversation starts. The CLI reads the Hook payload from stdin and writes the Cursor envelope — a top-level `additional_context` string — directly to stdout; it does not use the `hookSpecificOutput` wrapper of the Codex and ZCode hosts.

`sessionStart` is fire-and-forget in Cursor: the agent loop does not wait for the Hook, and the Hook cannot block session creation. The injected Catalog is therefore best-effort context. The Lorelum Skill treats it conditionally: when the Catalog is visible in the current task context the Skill reuses it, and when it is not visible the Skill runs `lore pack list --details` once for the task instead. Either way the Skill never reruns discovery before ordinary edits, commands, or replies.

The integration requests Pack names, descriptions, and stack scopes, not Pack roots, Practice bodies, or resource content. It does not install or update Packs or automatically run query/get; the Skill makes task-specific decisions. Input or Store failures write stderr diagnostics and return a non-blocking response.

## Integration scope

This Plugin is deliberately CLI-first: it uses the compiled `lore` executable together with the Lorelum Skill, the `/lore` command, and the Cursor `sessionStart` Hook. It does not bundle, configure, or call a local MCP server, and a local MCP wrapper is not a planned Plugin optimization — the Plugin declares no `mcpServers` even though Cursor supports them. MCP is reserved for a separately approved future platform remote-retrieval service.

The Hook command is a bare `lore` invocation resolved from the `PATH` inherited by Cursor; the Plugin ships no hook scripts and does not use `${CURSOR_PLUGIN_ROOT}`.

A `preToolUse` Hook (matcher `^Shell$`, Cursor's name for its terminal tool) prepends two POSIX `export` lines with the host and session identity to Shell commands that qualify under the shared `agent.shellSessionInjection` setting, so a successful `lore get` is associated with the conversation and recorded as a read candidate by a running Backend. The response uses Cursor's flat `updated_input` field without a `permission` decision, so the rewritten command keeps its normal approval flow; the session id is read from `session_id` with a `conversation_id` fallback. Cursor runs Hook commands fail-open, so the bare command needs no output-filtering wrapper, and `lore.cmd` resolves by name under Cursor's Windows PowerShell executor. Cursor's `subagentStart` response cannot carry injected context, so no subagent Hook is registered.

## Retrieval availability

`lore query` defaults to local semantic retrieval. A ready semantic query is the normal path; expected latency alone is not a reason to skip it, and this documentation makes no fixed-latency promise. The normal Skill path starts by issuing its targeted natural-language query; it does not preflight Backend, model, index, or status commands. A `data.state: "preparing"` response, an unavailable model, or an unavailable semantic index is a lifecycle state or actionable error, not evidence that no relevant Practice exists. Only after such a response does the caller follow the documented model or index recovery path and retry the same query. Use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis, and identify those results as keyword retrieval.

## Installation

This Plugin is a Cursor adapter. The `lore` command must be available on the `PATH` inherited by Cursor; the Plugin does not embed, build, or update the CLI. Bun is only required for maintainers running the source and test workflows.

On Windows, install the CLI with the official installer so the `lore.cmd` shim lands in your **user** `Path`. Real-machine verification (2026-09-18, Cursor 3.21.9) observed that the session Hook subprocess resolves commands against the user-level `Path` only — a machine-level installation is not visible to the session Hook.

Distribution is dual-track: the Plugin is prepared for submission to the public Cursor Marketplace, and the same artifact installs from the Lorelum repository or a local checkout as a marketplace. Add the repository (`lorelum/lorelum` on GitHub, or a local checkout directory) as a marketplace, then install **Lorelum** (`lorelum`) from `lorelum-plugins`. The installed identity is `lorelum@lorelum-plugins`, matching the Codex and ZCode plugin identities. For a local copy without a marketplace, place this directory under `~/.cursor/plugins/local/lorelum`; note that Cursor only loads symlinks whose target resolves inside that folder, so use a real copy rather than a link to a checkout. See the [Cursor installation guide](https://lorelum.com/en/docs/cursor) for details and [the development guide](../../../docs/development/plugins.md) for a checkout-backed development install.

## Local validation

From the repository root:

```sh
bun test plugins/cursor/lorelum/scripts
```

The CLI and Store integration is connected end to end: the Hook runs `lore hook cursor` against the LocalStore and renders the returned summaries. To smoke-check current source, install Packs into an isolated Store root, then pipe a Hook event through the source entrypoint. This source-only check requires Bun; an installed Plugin does not.

```sh
printf '%s\n' '{"hook_event_name":"sessionStart"}' | bun packages/cli/src/main.ts hook cursor --store-root /tmp/lore-e2e-store
```
