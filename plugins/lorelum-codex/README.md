# Lorelum Codex Plugin

This is the first Codex integration for Lorelum. It uses a progressive-disclosure flow:

1. `SessionStart` and `PostCompact` inject a small Pack Index.
2. The Lorelum Skill tells Codex to decide whether a Pack is relevant.
3. Codex calls the Lorelum query command only for a matching task and work moment.
4. Codex retrieves a full Practice only when the compact query result makes it necessary.

Codex discovers the default `hooks/hooks.json` bundled in the Plugin. The hook calls `lore list packs`, the rich Pack metadata command defined by the list catalog contract (ADR 0014). The command invocation is isolated in `scripts/inject-pack-index.ts`; set `LORELUM_CLI_COMMAND` and `LORELUM_CLI_ARGS` (a JSON array of strings) to test with a custom executable, and pass a custom source in unit tests.

Hooks are metadata-only. They do not run `lore query`, access the network, modify the Store, or read full Practice bodies. If the CLI is unavailable or returns malformed data, the hook writes a diagnostic to stderr and lets the host continue without additional context.

### Windows notes

Codex runs hook commands through PowerShell on Windows, so `commandWindows` uses PowerShell syntax (`$env:PLUGIN_ROOT`), and `bun` must resolve to a real executable on `PATH` — the shim script that `npm install -g bun` creates will not run. Hooks are gated by review: after any change to `hooks.json`, re-trust them in the Codex plugin UI, otherwise Codex silently skips them. Current Codex versions cannot emit `additionalContext` for `PostCompact`, so compaction-time re-injection is a no-op until the host supports it; the hook entry is kept for forward compatibility.

## Local validation

From the repository root:

```powershell
python "$env:USERPROFILE\.codex\skills\.system\plugin-creator\scripts\validate_plugin.py" plugins\lorelum-codex
bun test plugins/lorelum-codex/scripts
```

The CLI and Store integration is connected end to end: the hook spawns `lore list packs` against the LocalStore and renders the returned summaries. To smoke-check it, install Packs into an isolated Store root, then run the command and pipe a hook event through the script:

```powershell
bun packages/cli/src/main.ts list packs --store-root D:\Temp\lore-e2e-store
$env:LORELUM_CLI_COMMAND = "bun"
$env:LORELUM_CLI_ARGS = '["packages/cli/src/main.ts","list","packs","--store-root","D:/Temp/lore-e2e-store"]'
'{"hook_event_name":"SessionStart"}' | bun plugins/lorelum-codex/scripts/inject-pack-index.ts
```
