# Host Plugin checkout development

Read [Host Plugin conventions](./plugin-conventions.md) first. This guide is for working on the current host Plugin artifacts (Claude Code, Codex, Cursor, Pi, WorkBuddy, and ZCode) from a checkout; it does not define their public identities or marketplace schemas.

| Host | Source root | Plugin validation |
| --- | --- | --- |
| Codex | [`plugins/codex/lorelum`](../../plugins/codex/lorelum) | Codex validator and configuration tests |
| Cursor | [`plugins/cursor/lorelum`](../../plugins/cursor/lorelum) | Configuration tests |
| Pi | [`plugins/pi/lorelum`](../../plugins/pi/lorelum) | Native Pi Package; configuration and process-adapter tests |
| WorkBuddy | [`plugins/workbuddy/lorelum`](../../plugins/workbuddy/lorelum) | Configuration tests and a real-host install |
| ZCode | [`plugins/zcode/lorelum`](../../plugins/zcode/lorelum) | Configuration tests and a real-host install |
| Claude Code | [`plugins/claude/lorelum`](../../plugins/claude/lorelum) | `claude plugin validate --strict`, configuration tests, and a real-host install |

All artifacts use the released `lore` executable. The CLI owns the Hook ABI and Catalog rendering; the Plugin owns host lifecycle matching and Skill guidance. Do not import Engine packages, read LocalStore files, duplicate retrieval/ranking logic, or add a local MCP wrapper.

## Verify source changes

From the repository root:

```sh
bun test plugins/scripts plugins/claude/lorelum/scripts plugins/codex/lorelum/scripts plugins/cursor/lorelum/scripts plugins/workbuddy/lorelum/scripts plugins/zcode/lorelum/scripts
bun test plugins/pi/lorelum
bun test packages/cli/src/hook
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" \
  plugins/codex/lorelum
claude plugin validate plugins/claude/lorelum --strict
```

The Python validator is Codex-specific and may require PyYAML. If it is unavailable, report that separately; passing configuration tests are not a successful validator run. `claude plugin validate` requires the Claude Code CLI; when it is unavailable, treat the gap the same way and cover the artifact with the configuration tests until a real run is possible.

Smoke-test the source Hook with an isolated Store root:

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook codex --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"sessionStart"}' \
  | bun packages/cli/src/main.ts hook cursor --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook workbuddy --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook zcode --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook claude --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"session_start"}' \
  | bun packages/cli/src/main.ts hook pi --store-root /absolute/path/to/isolated-store
```

The WorkBuddy and Cursor identity rewrites can be smoke-checked the same way —
pipe their tool events through the source entrypoint and confirm the rewritten
command prefix:

```sh
printf '%s
' '{"hook_event_name":"PreToolUse","tool_name":"Bash","session_id":"probe","tool_input":{"command":"lore get sample.read"}}'   | bun packages/cli/src/main.ts hook workbuddy --store-root /absolute/path/to/isolated-store

printf '%s
' '{"hook_event_name":"preToolUse","tool_name":"Shell","conversation_id":"probe","tool_input":{"command":"lore get sample.read"}}'   | bun packages/cli/src/main.ts hook cursor --store-root /absolute/path/to/isolated-store
```

With a source-matched Backend running, executing the returned command records a
candidate under `~/.lorelum/sessions/<hostKey>/<session id>/practice-reads.jsonl`;
stopping the Backend keeps the `get` result unchanged and adds no record.


## Codex checkout install

The repository's Codex marketplace is `.agents/plugins/marketplace.json`. Do not enable a checkout-backed marketplace together with the remote `lorelum-plugins` marketplace: both offer `lorelum@lorelum-plugins` to Codex.

```sh
codex plugin marketplace list
codex plugin remove lorelum@lorelum-plugins
codex plugin marketplace remove lorelum-plugins
codex plugin marketplace add "$PWD"
codex plugin add lorelum@lorelum-plugins
```

## Pi checkout install

Pi installs the repository checkout as a native local Package; it has no marketplace registration. From a Pi session or the terminal:

```sh
pi install "$PWD/plugins/pi/lorelum"
pi list
```

A local Package is loaded from the resolved path without copying, so a checkout edit takes effect after `/reload`. Pi never modifies the checkout, and the Package declares no runtime dependency: it calls the released `lore` on `PATH`. Verify discovery by starting a session and confirming the injected Catalog reaches the first model request; the Pi site page documents the user-facing install, trust, update, and removal path. See [`plugins/pi/lorelum/README.md`](../../plugins/pi/lorelum/README.md) for the lifecycle, process-adapter, and failure boundaries.

## Codex local iteration

For a local iteration, update the development-only cachebuster, reinstall the Plugin, then start a new task. Re-trust Hooks after changing `hooks/hooks.json`.

```sh
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" \
  plugins/codex/lorelum
codex plugin add lorelum@lorelum-plugins
```

Do not commit the cachebuster version. To return to the remote source, remove the checkout marketplace, add `lorelum/lorelum`, and reinstall the same selector.

## WorkBuddy checkout install

Headless engine runs (`node <install>/resources/app.asar.unpacked/cli/dist/codebuddy.js -p "…"`) do not load installed plugin Hooks by default; pass `--plugin-dir <path-to-plugins/workbuddy/lorelum>` to exercise the Hook chain in that mode. Verified with engine 2.137.1.

WorkBuddy discovers the checkout through the root `.codebuddy-plugin/marketplace.json`. The public install path and its desktop-registry caveats are documented in [the WorkBuddy guide](https://lorelum.com/en/docs/workbuddy); for local iteration, add the repository root as a marketplace with the embedded CodeBuddy CLI:

```sh
export WORKBUDDY_CONFIG_DIR=~/.workbuddy CODEBUDDY_CONFIG_DIR=~/.workbuddy
codebuddy plugin marketplace add "$PWD"
codebuddy plugin install lorelum@lorelum-plugins
```

`marketplace add` expects the repository root (it discovers the metadata directory inside); passing `.codebuddy-plugin` itself or the manifest file path is rejected. Fully quit and restart WorkBuddy after installing so the resident CLI host reloads the registry.

The marketplace entry version and `plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json` version must change together. Plugin Hooks are enabled automatically when the Plugin contributes one. Start a new task and verify that a SessionStart boundary provides the Pack Catalog; `/lore` should appear wherever the host surfaces plugin commands. For each local iteration, uninstall and reinstall from the marketplace so WorkBuddy reads the updated artifact. During automated checks keep to `--plugin-dir` or the checkout marketplace; do not write the user-level `~/.workbuddy` or `~/.codebuddy` registries.

## ZCode checkout install

ZCode discovers the checkout through the root `marketplace.json`. Add the repository root in **Settings → Plugin Management → Discover → +**, then install **Lorelum** from `lorelum-plugins`. The marketplace entry version and `plugins/zcode/lorelum/.zcode-plugin/plugin.json` version must change together.

Plugin Hooks are enabled automatically when the Plugin contributes one. Start a new session and verify that `/lore` is present and a SessionStart boundary provides the Pack Catalog. For each local iteration, uninstall and reinstall from Discover so ZCode reads the updated artifact.

## Claude Code checkout install

Claude Code discovers the checkout through the root `.claude-plugin/marketplace.json`. From a terminal:

```sh
claude plugin marketplace add "$PWD"
claude plugin install lorelum@lorelum-plugins
```

Both steps are also available in a session through `/plugin` and in the desktop app's plugin manager (`+ → Plugins`); the default install scope is the user account, with `--scope project` or `--scope local` as alternatives. The marketplace entry version and `plugins/claude/lorelum/.claude-plugin/plugin.json` version must change together, and Claude Code pins an installed Plugin until the manifest version changes — bump both for each iteration and run `claude plugin update lorelum@lorelum-plugins` (or Update now in `/plugin`).

Plugin Hooks are enabled automatically when the Plugin is installed. Plugins are unavailable in cloud and WSL sessions; verify in a local session that a SessionStart boundary provides the Pack Catalog and that `/lorelum:lorelum` appears in the skill list. The read-Practice hint chain adds two more verifications: a successful `lore get` in a shell tool call records a candidate under `~/.lorelum/sessions/claude/<session-id>/practice-reads.jsonl` (requires a running Backend), and a subagent started afterwards receives the bounded candidate hint. On macOS and Linux the Hook resolves the plain `lore` executable directly; on Windows, Hook commands run through Git Bash and the `|| lore.cmd` fallback in `hooks/hooks.json` is what makes the CLI shim resolvable; see [Host Plugin conventions](./plugin-conventions.md#claude-code-hook-declaration). When no `claude` CLI is available, iterate by uninstalling and reinstalling from the plugin manager.
