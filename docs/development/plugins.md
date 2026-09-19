# Host Plugin checkout development

Read [Host Plugin conventions](./plugin-conventions.md) first. This guide is
for working on the current Codex, WorkBuddy, and ZCode artifacts from a
checkout; it does not define their public identities or marketplace schemas.

| Host | Source root | Plugin validation |
| --- | --- | --- |
| Codex | [`plugins/codex/lorelum`](../../plugins/codex/lorelum) | Codex validator and configuration tests |
| WorkBuddy | [`plugins/workbuddy/lorelum`](../../plugins/workbuddy/lorelum) | Configuration tests and a real-host install |
| ZCode | [`plugins/zcode/lorelum`](../../plugins/zcode/lorelum) | Configuration tests and a real-host install |

All artifacts use the released `lore` executable. The CLI owns the Hook ABI
and Catalog rendering; the Plugin owns host lifecycle matching and Skill
guidance. Do not import Engine packages, read LocalStore files, duplicate
retrieval/ranking logic, or add a local MCP wrapper.

## Verify source changes

From the repository root:

```sh
bun test plugins/scripts plugins/codex/lorelum/scripts plugins/workbuddy/lorelum/scripts plugins/zcode/lorelum/scripts
bun test packages/cli/src/hook
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py" \
  plugins/codex/lorelum
```

The validator is Codex-specific and may require PyYAML. If it is unavailable,
report that separately; passing configuration tests are not a successful
validator run.

Smoke-test the source Hook with an isolated Store root:

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook codex --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook workbuddy --store-root /absolute/path/to/isolated-store

printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | bun packages/cli/src/main.ts hook zcode --store-root /absolute/path/to/isolated-store
```

## Codex checkout install

The repository's Codex marketplace is `.agents/plugins/marketplace.json`. Do
not enable a checkout-backed marketplace together with the remote
`lorelum-plugins` marketplace: both offer `lorelum@lorelum-plugins` to Codex.

```sh
codex plugin marketplace list
codex plugin remove lorelum@lorelum-plugins
codex plugin marketplace remove lorelum-plugins
codex plugin marketplace add "$PWD"
codex plugin add lorelum@lorelum-plugins
```

For a local iteration, update the development-only cachebuster, reinstall the
Plugin, then start a new task. Re-trust Hooks after changing `hooks/hooks.json`.

```sh
python3 "$HOME/.codex/skills/.system/plugin-creator/scripts/update_plugin_cachebuster.py" \
  plugins/codex/lorelum
codex plugin add lorelum@lorelum-plugins
```

Do not commit the cachebuster version. To return to the remote source, remove
the checkout marketplace, add `lorelum/lorelum`, and reinstall the same
selector.

## WorkBuddy checkout install

WorkBuddy discovers the checkout through the root
`.codebuddy-plugin/marketplace.json`. Add the repository root as a third-party
marketplace in the WorkBuddy plugin/marketplace UI, or from a terminal with the
CodeBuddy CLI that WorkBuddy embeds. The CLI form has two requirements: bare
invocations write the standalone registry `~/.codebuddy`, which the desktop
client never reads, so redirect both config variables to the desktop registry;
and fully quit and restart WorkBuddy after installing, because the resident CLI
host reloads the registry only on startup. `marketplace add` expects the
repository root (it discovers the metadata directory inside); passing
`.codebuddy-plugin` itself or the manifest file path is rejected.

```sh
export WORKBUDDY_CONFIG_DIR=~/.workbuddy CODEBUDDY_CONFIG_DIR=~/.workbuddy
codebuddy plugin marketplace add "$PWD"
codebuddy plugin install lorelum@lorelum-plugins
```

The marketplace entry version and
`plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json` version must change
together. Plugin Hooks are enabled automatically when the Plugin contributes
one. Start a new task and verify that a SessionStart boundary provides the Pack
Catalog; `/lore` should appear wherever the host surfaces plugin commands. For
each local iteration, uninstall and reinstall from the marketplace so WorkBuddy
reads the updated artifact. During automated checks keep to `--plugin-dir` or
the checkout marketplace; do not write the user-level `~/.workbuddy` or
`~/.codebuddy` registries.

## ZCode checkout install

ZCode discovers the checkout through the root `marketplace.json`. Add the
repository root in **Settings → Plugin Management → Discover → +**, then
install **Lorelum** from `lorelum-plugins`. The marketplace entry version and
`plugins/zcode/lorelum/.zcode-plugin/plugin.json` version must change together.

Plugin Hooks are enabled automatically when the Plugin contributes one. Start
a new session and verify that `/lore` is present and a SessionStart boundary
provides the Pack Catalog. For each local iteration, uninstall and reinstall
from Discover so ZCode reads the updated artifact.
