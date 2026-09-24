# Lorelum

This is the first Codex integration for Lorelum. It brings relevant engineering Practices into Codex when they can inform a task or decision, without loading every rule at once. Its progressive-disclosure flow is:

The current host integration contract is [agent-integration](../../../openspec/specs/agent-integration/spec.md); this README explains the Codex-specific distribution and operating model.

1. A compact **Installed Pack Catalog** makes the locally available Knowledge Packs discoverable.
2. The Lorelum Skill uses that catalog as a relevance hint, not as the full engineering rules or a hard filter.
3. At a material task, decision, verification, recovery, or completion moment, Codex uses one targeted natural-language semantic query before deciding retrieval is not worth attempting.
4. Before applying a Practice or claiming that work follows it, Codex reads the full Practice.

The bundled runtime integration calls `lore hook codex`, the versioned Codex Hook ABI introduced in Lorelum CLI v0.1.0-alpha.1. It runs for supported `SessionStart` sources, including `compact`, so the Catalog is regenerated before Codex continues after compaction. The CLI also uses shell-only `PreToolUse`/`PostToolUse` windows to notice successful `lore get` reads (including reads inside scripts), then shares bounded metadata hints through `SubagentStart`. Other tools are skipped; the candidate ledger is shared CLI logic, not Codex-owned state. The CLI reads the Hook payload from stdin and writes the Codex `hookSpecificOutput` envelope directly to stdout when context is available.

The integration requests Pack-level discovery data, including each current Pack root, but not Practice bodies or resource content. Subagent hints likewise contain only candidate ID, title, applicability, and Pack names, never Practice bodies. They indicate that a Practice was read, not that it was adopted or proven effective. It does not install or update Packs, or automatically run `lore query` or `lore get`; the Skill makes those task-specific decisions and opening the LocalStore still follows its normal lifecycle. If the CLI is unavailable or returns malformed data, the integration writes a diagnostic to stderr and lets the host continue without additional context. Concurrent conversations in one directory may miss or misattribute hints; main-agent compact recovery is not included.

## Integration scope

This Plugin is deliberately CLI-first: it uses the compiled `lore` executable together with the Lorelum Skill and Codex Hook. It does not bundle, configure, or call a local MCP server, and a local MCP wrapper is not a planned Plugin optimization. MCP is reserved for a separately approved future platform remote-retrieval service.

## Retrieval availability

`lore query` defaults to local semantic retrieval. A ready semantic query is the normal path; expected latency alone is not a reason to skip it, and this documentation makes no fixed-latency promise. The normal Skill path starts by issuing its targeted natural-language query; it does not preflight Backend, model, index, or status commands. A `data.state: "preparing"` response, an unavailable model, or an unavailable semantic index is a lifecycle state or actionable error, not evidence that no relevant Practice exists. Only after such a response does the caller follow the documented model or index recovery path and retry the same query. Use `--mode keyword` only for an intentional offline lookup or semantic-runtime diagnosis, and identify those results as keyword retrieval.

## Installation

This Plugin is a Codex adapter. Ordinary users need Lorelum CLI v0.1.0-alpha.3 or later for the existing Catalog, available as `lore` on `PATH`; read-Practice hints additionally need a CLI release containing the new ledger logic. An older CLI leaves the new Hooks empty without blocking work. The Plugin does not embed, build, or update the CLI. Bun is only required for maintainers running the source and test workflows. See the [Codex installation guide](https://lorelum.com/en/docs/codex) for public marketplace commands and [the development guide](../../../docs/development/plugins.md) for a checkout-backed development install.

### Windows notes

Codex runs hook commands through PowerShell on Windows. The Plugin invokes the compiled `lore` command directly and does not require Bun or Node on the user machine. Hooks are gated by review: after any change to `hooks.json`, re-trust them in the Codex plugin UI, otherwise Codex silently skips them.

## Local validation

From the repository root:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins\codex\lorelum
bun test plugins/codex/lorelum/scripts
```

The CLI and Store integration is connected end to end: the Hook runs `lore hook codex` against the LocalStore and renders the returned summaries. To smoke-check current source, install Packs into an isolated Store root, then pipe a Hook event through the source entrypoint. This source-only check requires Bun; an installed Plugin does not.

```powershell
'{"hook_event_name":"SessionStart"}' | bun packages/cli/src/main.ts hook codex --store-root D:\Temp\lore-e2e-store
```
