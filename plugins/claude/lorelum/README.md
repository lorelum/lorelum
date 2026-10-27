# Lorelum for Claude Code

This is the first-party Claude Code integration for Lorelum. It brings relevant engineering Practices into Claude Code when they can inform a task or decision, without loading every rule at once. Its progressive-disclosure flow is:

The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the Claude Code-specific distribution and operating model.

1. A compact **Installed Pack Catalog** makes the locally available Knowledge Packs discoverable.
2. The Lorelum Skill uses that catalog as a relevance hint, not as the full engineering rules or a hard filter.
3. At a material task, decision, verification, recovery, or completion moment, Claude Code uses one targeted natural-language semantic query before deciding retrieval is not worth attempting.
4. Before applying a Practice or claiming that work follows it, Claude Code reads the full Practice.

The Skill is the explicit entry point: it is available as `/lorelum:lorelum` (plugin-namespaced) and is triggered from the skill list or the task context.

## Supported features

Claude Code provides the Skill, Main Catalog, successful Bash/PowerShell read association, and new-subagent candidates. The existing `SessionStart(source=compact)` restores Main's candidates after manual or automatic compaction; startup/resume do not send a second Main hint. Recovery shares a 4000-character Catalog/candidate budget, with candidate metadata capped at 1800. Empty or unavailable candidates preserve the Catalog without starting Backend. The Plugin supplies no separate child Catalog. See the [capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities) and [Claude Code guide](https://lorelum.com/en/docs/claude#supported-features).


The bundled runtime integration calls `lore hook claude`, the versioned Claude Code Hook ABI. It runs for supported `SessionStart` sources (`startup`, `resume`, `clear`, `compact`, `fork`), so the Catalog is regenerated before Claude Code continues after compaction or a fork. The CLI reads the Hook payload from stdin and writes the Claude Code `hookSpecificOutput` envelope directly to stdout. The Hook uses Claude Code's shell command form, `lore hook claude || lore.cmd hook claude`: on macOS and Linux the first term resolves the plain `lore` executable and short-circuits; the second term covers Windows, where Claude Code runs Hook commands through Git Bash and the installer's `lore.cmd` shim is only resolvable with its extension. Claude Code treats any Hook failure as non-blocking (the session continues), and the CLI additionally degrades its own failures to a single `{"continue":true}` line with exit code 0.

The integration requests Pack-level discovery data — names with optional descriptions and stack scopes — but not Practice bodies, resource content, or Pack roots (a root is resolved from `lore get` or a named `lore pack list` when it is actually needed). It does not install or update Packs, or automatically run `lore query` or `lore get`; the Skill makes those task-specific decisions and opening the LocalStore still follows its normal lifecycle. When the Hook ABI runs but cannot process its input or read the Store, it writes a diagnostic to stderr and returns a non-blocking response without additional context.

## Integration scope

This Plugin is deliberately CLI-first: it uses the compiled `lore` executable together with the Lorelum Skill and the Claude Code SessionStart Hook. It does not bundle, configure, or call a local MCP server (Claude Code Plugins support an `.mcp.json` component; this Plugin does not ship one), and a local MCP wrapper is not a planned Plugin optimization. MCP is reserved for a separately approved future platform remote-retrieval service.

## Retrieval availability

`lore query` defaults to local semantic retrieval. A ready semantic query is the normal path; expected latency alone is not a reason to skip it, and this documentation makes no fixed-latency promise. The normal Skill path starts by issuing its targeted natural-language query; it does not preflight Backend, model, index, or status commands. A `data.state: "preparing"` response, an unavailable model, or an unavailable semantic index is a lifecycle state or actionable error, not evidence that no relevant Practice exists. Only after such a response does the caller follow the documented model or index recovery path and retry the same query. Use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis, and identify those results as keyword retrieval.

## Installation

This Plugin is a Claude Code adapter. The `lore` command must be available on the `PATH` inherited by Claude Code; the Plugin does not embed, build, or update the CLI. Bun is only required for maintainers running the source and test workflows.

Install from Claude Code: add the Lorelum repository (`lorelum/lorelum` on GitHub, or a local checkout directory) as a marketplace with `claude plugin marketplace add lorelum/lorelum` from a terminal (or `/plugin marketplace add lorelum/lorelum` in a session), then install **Lorelum** (`lorelum`) from `lorelum-plugins` in the `/plugin` browser or the desktop app's plugin manager. Choose the install scope (user, project, or local) as offered; the installed identity is `lorelum@lorelum-plugins`, matching the other host plugin identities.

Plugin Hooks are activated by the installed Plugin; no separate Hook enablement setting is required. See the [Claude Code installation guide](https://lorelum.com/en/docs/claude) for details and [the development guide](../../../docs/development/plugins.md) for a checkout-backed development install.

## Local validation

From the repository root:

```sh
bun test plugins/claude/lorelum/scripts
claude plugin validate ./plugins/claude/lorelum --strict
```

The `claude` validation command requires the Claude Code CLI; when it is unavailable, the configuration tests above still run and the gap must be reported separately. The CLI and Store integration is connected end to end: the Hook runs `lore hook claude` against the LocalStore and renders the returned summaries. To smoke-check current source, install Packs into an isolated Store root, then pipe a Hook event through the source entrypoint. This source-only check requires Bun; an installed Plugin does not.

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | bun packages/cli/src/main.ts hook claude --store-root /tmp/lore-e2e-store
```
