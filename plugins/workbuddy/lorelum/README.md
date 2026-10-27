# Lorelum for WorkBuddy

This is the first-party WorkBuddy integration for Lorelum. It brings relevant engineering Practices into WorkBuddy when they can inform a task or decision, without loading every rule at once. Its progressive-disclosure flow is:

The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the WorkBuddy-specific distribution and operating model.

1. A compact **Installed Pack Catalog** makes the locally available Knowledge Packs discoverable.
2. The Lorelum Skill uses that catalog as a relevance hint, not as the full engineering rules or a hard filter.
3. At a material task, decision, verification, recovery, or completion moment, WorkBuddy uses one targeted natural-language semantic query before deciding retrieval is not worth attempting.
4. Before applying a Practice or claiming that work follows it, WorkBuddy reads the full Practice.

The `/lore` command is the explicit entry point: it accepts an optional natural-language question and routes it through the Lorelum Skill.

## Supported features

WorkBuddy provides the Skill, Main Catalog, successful-read association, and Main compact recovery through the existing `SessionStart(source=compact)`. Startup/resume do not also send candidates. The shared 4000-character recovery budget includes up to 1800 characters of historical candidate metadata; unavailable candidates leave the Catalog usable. Subagent candidate hints and a separate child Catalog are absent because the host discards subagent Hook stdout. See the [capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities) and [WorkBuddy guide](https://lorelum.com/en/docs/workbuddy#supported-features).


The bundled runtime integration calls `lore hook workbuddy`, the versioned WorkBuddy Hook ABI. It runs for supported `SessionStart` sources (`startup`, `resume`, `clear`, `compact`), so the Catalog is regenerated before WorkBuddy continues after compaction. The CLI reads the Hook payload from stdin and writes the WorkBuddy `hookSpecificOutput` envelope directly to stdout. The Hook uses the host-native `command` form — a shell command that forwards to `lore hook workbuddy` (with an `|| lore.cmd` fallback, because WorkBuddy executes Hook commands through Git Bash on Windows) and degrades to a non-blocking `{"continue":true}` response when the CLI is unavailable. WorkBuddy's hook schema has no `commandWindows` or `additionalContextLimit` key; unknown keys are stripped by the host.

A `PreToolUse` Hook (matcher `^Bash$`) prepends two POSIX `export` lines with the host and session identity to Bash commands that qualify under the shared `agent.shellSessionInjection` setting, so a successful `lore get` is associated with the conversation and recorded as a read candidate by a running Backend. The rewrite carries no `permissionDecision` — WorkBuddy's `allow` would bypass its permission system — and the wrapped command fails open to `{}` when the CLI is missing or old. WorkBuddy dispatches a `SubagentStart` event but discards Hook stdout, so no subagent Hook is registered and that path stays a no-op.

The integration requests Pack names, descriptions, and stack scopes, not Pack roots, Practice bodies, or resource content. It does not install or update Packs or automatically run query/get; the Skill makes task-specific decisions. Input or Store failures write stderr diagnostics and return a non-blocking response.

## Integration scope

This Plugin is deliberately CLI-first: it uses the compiled `lore` executable together with the Lorelum Skill, the `/lore` command, and the WorkBuddy SessionStart Hook. It does not bundle, configure, or call a local MCP server, and a local MCP wrapper is not a planned Plugin optimization, even though the host supports Plugin-provided MCP servers. MCP is reserved for a separately approved future platform remote-retrieval service.

## Retrieval availability

`lore query` defaults to local semantic retrieval. A ready semantic query is the normal path; expected latency alone is not a reason to skip it, and this documentation makes no fixed-latency promise. The normal Skill path starts by issuing its targeted natural-language query; it does not preflight Backend, model, index, or status commands. A `data.state: "preparing"` response, an unavailable model, or an unavailable semantic index is a lifecycle state or actionable error, not evidence that no relevant Practice exists. Only after such a response does the caller follow the documented model or index recovery path and retry the same query. Use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis, and identify those results as keyword retrieval.

## Installation

This Plugin is a WorkBuddy adapter. The `lore` command must be available on the `PATH` inherited by WorkBuddy; the Plugin does not embed, build, or update the CLI. Bun is only required for maintainers running the source and test workflows.

Install from the WorkBuddy client: add the Lorelum repository (`lorelum/lorelum` on GitHub) as a third-party plugin marketplace, then install **Lorelum** (`lorelum`) from `lorelum-plugins`. The repository root `.codebuddy-plugin/marketplace.json` is the marketplace registration; the installed identity is `lorelum@lorelum-plugins`, matching the Codex and ZCode plugin identities. From a terminal, the CodeBuddy CLI that WorkBuddy embeds installs straight from GitHub. Bare invocations write the standalone CLI registry (`~/.codebuddy`), which the desktop client does not read — redirect both config variables to the desktop registry, and fully quit and restart WorkBuddy afterwards so the resident CLI host reloads the registry:

```sh
export WORKBUDDY_CONFIG_DIR=~/.workbuddy CODEBUDDY_CONFIG_DIR=~/.workbuddy
codebuddy plugin marketplace add https://github.com/lorelum/lorelum
codebuddy plugin install lorelum@lorelum-plugins
```

A local checkout directory can replace the repository URL for developer preview: pass the repository root (it must contain `.codebuddy-plugin/marketplace.json`; the metadata directory or the manifest file path is rejected).

See the [WorkBuddy installation guide](https://lorelum.com/en/docs/workbuddy) for details and [the development guide](../../../docs/development/plugins.md) for a checkout-backed development install.

## Local validation

From the repository root:

```sh
bun test plugins/workbuddy/lorelum/scripts
```

The CLI and Store integration is connected end to end: the Hook runs `lore hook workbuddy` against the LocalStore and renders the returned summaries. To smoke-check current source, install Packs into an isolated Store root, then pipe a Hook event through the source entrypoint. This source-only check requires Bun; an installed Plugin does not.

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | bun packages/cli/src/main.ts hook workbuddy --store-root /tmp/lore-e2e-store
```
