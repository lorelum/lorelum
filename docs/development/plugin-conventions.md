# Host Plugin conventions

Use this page before adding, moving, or releasing a Lorelum host Plugin. It
defines the names and source layout that Lorelum controls; each host keeps its
own manifest, marketplace format, lifecycle events, and permission model.

## Identity and layout

| Concept | Rule | Current examples |
| --- | --- | --- |
| Product ID | Always `lorelum`; this is the user-facing Plugin and Skill identity. | Codex, WorkBuddy, ZCode, and Cursor manifests all use `lorelum`. |
| Host key | Lowercase kebab-case; it identifies the host adapter, not the product. | `codex`, `workbuddy`, `zcode`, `cursor` |
| Source root | `plugins/<hostKey>/lorelum/` | [`plugins/codex/lorelum`](../../plugins/codex/lorelum), [`plugins/workbuddy/lorelum`](../../plugins/workbuddy/lorelum), [`plugins/zcode/lorelum`](../../plugins/zcode/lorelum), [`plugins/cursor/lorelum`](../../plugins/cursor/lorelum) |
| Marketplace | A host-owned registration file with its host-native schema. | [Codex registration](../../.agents/plugins/marketplace.json), [WorkBuddy registration](../../.codebuddy-plugin/marketplace.json), [ZCode registration](../../marketplace.json), [Cursor registration](../../.cursor-plugin/marketplace.json) |
| Selector | Unique inside the host marketplace. It is not a global key across hosts. | `lorelum@lorelum-plugins` |
| Release version | Each host uses its native version fields. When the marketplace participates in update detection, its entry version MUST equal the native manifest version. | Cursor `.cursor-plugin/marketplace.json`, WorkBuddy `.codebuddy-plugin/marketplace.json`, ZCode `marketplace.json`, and their `plugin.json` manifests |

Do not encode a host name into the public Plugin ID merely because the source
directory is host-specific. `lorelum-zcode` is an implementation path, not a
product identity. Conversely, do not use a marketplace name or a host cache
path as a repository directory convention.

## What can be shared

`skills/lorelum/` is the portable Skill core. It owns the generic retrieval
guidance for a command-capable Agent. A host Plugin may package a translated
copy when it has an injected Catalog or host-specific recovery instruction;
the copy does not need identical wording, but it must satisfy the scenarios in
[Skill guidance fixtures](./skill-guidance-fixtures.md).

The released `lore` CLI owns Pack Catalog retrieval, semantic query behavior,
Practice reads, and the shared Catalog renderer. A host Hook calls a narrow
`lore hook <hostKey>` ABI rather than importing Engine or Store code.

## What must remain host-native

Keep these inside `plugins/<hostKey>/lorelum/` and maintain them independently:

- manifest location and schema;
- marketplace registration file and update metadata;
- Hook matcher, payload/envelope translation, environment variables, execution
  mode, and any platform wrapper the host genuinely requires;
- commands, rules, agents, UI, or runtime-plugin modules that exist only in
  that host;
- install, trust, update, and recovery documentation; and
- configuration and real-host smoke tests.

Do not create a generic manifest or copy a host-only field into another
marketplace just because the names look compatible. Lorelum remains CLI-first:
host artifacts use the released CLI plus native Skills/Hooks and do not add a
local MCP surface.

### ZCode Hook declaration

ZCode automatically loads a Plugin's `hooks/hooks.json`. Do not duplicate that
discovery path as `"hooks": "hooks"` in `.zcode-plugin/plugin.json`: the
manifest field means an inline Hook object or an exact Hook-file path, so a
directory value is diagnosed as an unreadable Hook file. Keep the Hook matcher
and `process`/`command` configuration only in `hooks/hooks.json` unless a
verified ZCode manifest contract requires an additional source.

### WorkBuddy Hook declaration

WorkBuddy also discovers a Plugin's `hooks/hooks.json` automatically, and its
manifest `hooks` field carries the same inline-object-or-file-path meaning, so
the same duplication trap applies to `.codebuddy-plugin/plugin.json`. WorkBuddy
Hooks use the host-native `command` form — a shell command that forwards to
`lore hook workbuddy` and degrades to `{"continue":true}` when the CLI is
unavailable — with a `commandWindows` PowerShell variant for Windows sessions,
mirroring the Codex Hook shape. Keep the matcher and command configuration only
in `hooks/hooks.json`.

WorkBuddy resolves SessionStart matchers by splitting the matcher on `|` and
exact-matching each token against the session source. Anchored regex forms such
as `^(startup|resume|clear|compact)$` therefore never match on the live host;
declare the unanchored list `startup|resume|clear|compact` (verified against
WorkBuddy 5.5.6).

## Add a host only when it has a real integration need

1. Confirm the host's official install root, manifest/marketplace contract,
   trust or permission flow, update mechanism, and command capability.
2. Decide whether `skills/lorelum/` alone solves the user need. Add a Plugin
   only for a concrete host-native capability such as a session Hook or command.
3. Create `plugins/<hostKey>/lorelum/` only after those facts are verified; do
   not add placeholder directories for a future host.
4. Keep the public product ID `lorelum`, register only that host's artifact in
   its native marketplace, and add focused configuration tests for the mapping.
5. Add matching user documentation in English and Chinese. It should explain
   install, first use, update, and recovery; protocol and source details belong
   in maintainer material.
6. Validate the portable Skill behavior, host configuration, released-CLI
   boundary, and a clean host install before claiming support.

The current behavioral contracts are [agent integration](../../openspec/specs/agent-integration/spec.md)
and [plugin distribution](../../openspec/specs/plugin-distribution/spec.md).
