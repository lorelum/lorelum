# Lorelum for ZCode

This is the first-party ZCode integration for Lorelum. It brings relevant engineering Practices into ZCode when they can inform a task or decision, without loading every rule at once. Its progressive-disclosure flow is:

The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the ZCode-specific distribution and operating model.

1. A compact **Installed Pack Catalog** makes the locally available Knowledge Packs discoverable.
2. The Lorelum Skill uses that catalog as a relevance hint, not as the full engineering rules or a hard filter.
3. At a material task, decision, verification, recovery, or completion moment, ZCode uses one targeted natural-language semantic query before deciding retrieval is not worth attempting.
4. Before applying a Practice or claiming that work follows it, ZCode reads the full Practice.

The `/lore` command is the explicit entry point: it accepts an optional natural-language question and routes it through the Lorelum Skill.

The runtime calls `lore hook zcode`. ZCode runs `SessionStart` at startup/resume, with a once-per-session execution marker; it does not rerun this Hook after compaction. The CLI reads stdin and returns the native `hookSpecificOutput` envelope. The Plugin uses ZCode's native `process` form (`lore` with `hook zcode` arguments), without a shell or platform wrapper.

## Supported features and limits

The Skill, Main Catalog, and successful-read association are available. Main compact recovery, subagent read hints, and a separate child Catalog are absent: ZCode has no corresponding context delivery events. A `compact` matcher does not create an event. Normal query/get remains the recovery path after context loss. See the [capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities) and [ZCode guide](https://lorelum.com/en/docs/zcode#supported-features-and-limits).

The same ABI also handles the `PreToolUse` event for the `Bash` tool. When the shell command is inside the shared injection scope (by default, its outer text contains `lore` as a standalone word; see `agent.shellSessionInjection`), the Hook returns an `updatedInput` whose command is prefixed with two Unix `export` assignments for `LORELUM_HOST_KEY=zcode` and `LORELUM_HOST_SESSION_ID=<current session ID>`. ZCode itself resolves the shell its Bash tool executes commands in — auto-detected Git Bash on Windows, a POSIX shell elsewhere — and announces the resolved shell in the session context, so the same prefix applies everywhere. A successful `lore get` inside that command — or inside a local script or pipeline it starts — can then report the read as a session candidate to an already-running Backend; association is optional and a missed report never changes the command's result.

Two ZCode boundaries are deliberate. The rewrite never returns a `permissionDecision`: in ZCode a Hook `allow` decision would approve a call that would otherwise ask the user, while `updatedInput` applies without one, so the host approval flow stays untouched. And ZCode offers no subagent-start event, so this Plugin registers no hook for subagent candidate hints and the Pack Catalog is not a read hint; ZCode currently participates in recording reads only. Updating the Plugin requires a new session before the `PreToolUse` Hook runs, and an older `lore` CLI degrades the event to a harmless `{"continue":true}` no-op.

The integration requests Pack names, descriptions, and stack scopes, not Pack roots, Practice bodies, or resource content. It does not install or update Packs or automatically run query/get; the Skill makes task-specific decisions. Input or Store failures write stderr diagnostics and return a non-blocking response.

## Integration scope

This Plugin is deliberately CLI-first: it uses the compiled `lore` executable together with the Lorelum Skill, the `/lore` command, and the ZCode SessionStart Hook. It does not bundle, configure, or call a local MCP server, and a local MCP wrapper is not a planned Plugin optimization. MCP is reserved for a separately approved future platform remote-retrieval service.

## Retrieval availability

`lore query` defaults to local semantic retrieval. A ready semantic query is the normal path; expected latency alone is not a reason to skip it, and this documentation makes no fixed-latency promise. The normal Skill path starts by issuing its targeted natural-language query; it does not preflight Backend, model, index, or status commands. A `data.state: "preparing"` response, an unavailable model, or an unavailable semantic index is a lifecycle state or actionable error, not evidence that no relevant Practice exists. Only after such a response does the caller follow the documented model or index recovery path and retry the same query. Use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis, and identify those results as keyword retrieval.

## Installation

This Plugin is a ZCode adapter. The `lore` command must be available on the `PATH` inherited by ZCode; the Plugin does not embed, build, or update the CLI. Bun is only required for maintainers running the source and test workflows.

Install from the ZCode client: open **Settings → Plugin Management → Discover**, add the Lorelum repository (`lorelum/lorelum` on GitHub, or a local checkout directory) as a marketplace with the **`+`** button, then install **Lorelum** (`lorelum`) from `lorelum-plugins`. The installed identity is `lorelum@lorelum-plugins`, matching the Codex plugin identity.

Plugin Hooks are activated by the installed Plugin; no separate `hooks.enabled` setting is required for this integration. See the [ZCode installation guide](https://lorelum.com/en/docs/zcode) for details and [the development guide](../../../docs/development/plugins.md) for a checkout-backed development install.

## Local validation

From the repository root:

```sh
bun test plugins/zcode/lorelum/scripts
```

The CLI and Store integration is connected end to end: the Hook runs `lore hook zcode` against the LocalStore and renders the returned summaries. To smoke-check current source, install Packs into an isolated Store root, then pipe a Hook event through the source entrypoint. This source-only check requires Bun; an installed Plugin does not.

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | bun packages/cli/src/main.ts hook zcode --store-root /tmp/lore-e2e-store
```
