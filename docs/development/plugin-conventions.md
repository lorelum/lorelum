# Host Plugin conventions

Use this page before adding, moving, or releasing a Lorelum host Plugin. It defines the names and source layout that Lorelum controls; each host keeps its own manifest, marketplace format, lifecycle events, and permission model.

## Identity and layout

| Concept | Rule | Current examples |
| --- | --- | --- |
| Product ID | Always `lorelum`; this is the user-facing Plugin and Skill identity. | Codex, WorkBuddy, ZCode, Cursor, and Claude Code manifests all use `lorelum`. |
| Host key | Lowercase kebab-case; it identifies the host adapter, not the product. | `codex`, `workbuddy`, `zcode`, `cursor`, `claude`, `pi` |
| Source root | `plugins/<hostKey>/lorelum/` | [`plugins/codex/lorelum`](../../plugins/codex/lorelum), [`plugins/workbuddy/lorelum`](../../plugins/workbuddy/lorelum), [`plugins/zcode/lorelum`](../../plugins/zcode/lorelum), [`plugins/cursor/lorelum`](../../plugins/cursor/lorelum), [`plugins/claude/lorelum`](../../plugins/claude/lorelum), [`plugins/pi/lorelum`](../../plugins/pi/lorelum) |
| Marketplace | A host-owned registration file with its host-native schema. Pi uses its native Package mechanism instead and MUST NOT be registered in another host's marketplace. | [Codex registration](../../.agents/plugins/marketplace.json), [WorkBuddy registration](../../.codebuddy-plugin/marketplace.json), [ZCode registration](../../marketplace.json), [Cursor registration](../../.cursor-plugin/marketplace.json), [Claude Code registration](../../.claude-plugin/marketplace.json) |
| Selector | Unique inside the host marketplace. It is not a global key across hosts. | `lorelum@lorelum-plugins` |
| Release version | Each host uses its native version fields. When the marketplace participates in update detection, its entry version MUST equal the native manifest version. | Cursor `.cursor-plugin/marketplace.json`, WorkBuddy `.codebuddy-plugin/marketplace.json`, ZCode `marketplace.json`, Claude Code `.claude-plugin/marketplace.json`, and their `plugin.json` manifests |

Do not encode a host name into the public Plugin ID merely because the source directory is host-specific. `lorelum-zcode` is an implementation path, not a product identity. Conversely, do not use a marketplace name or a host cache path as a repository directory convention.

## What can be shared

`skills/lorelum/` is the portable Skill core. It owns the generic retrieval guidance for a command-capable Agent. A host Plugin may package a translated copy when it has an injected Catalog or host-specific recovery instruction; the copy does not need identical wording, but it must satisfy the scenarios in [Skill guidance fixtures](./skill-guidance-fixtures.md).

The released `lore` CLI owns Pack Catalog retrieval, semantic query behavior, Practice reads, and the shared Catalog renderer. A host Hook calls a narrow `lore hook <hostKey>` ABI rather than importing Engine or Store code.

## What must remain host-native

Keep these inside `plugins/<hostKey>/lorelum/` and maintain them independently:

- manifest location and schema;
- marketplace registration file and update metadata;
- Hook matcher, payload/envelope translation, environment variables, execution mode, and any platform wrapper the host genuinely requires;
- commands, rules, agents, UI, or runtime-plugin modules that exist only in that host;
- install, trust, update, and recovery documentation; and
- configuration and real-host smoke tests.

Do not create a generic manifest or copy a host-only field into another marketplace just because the names look compatible. Lorelum remains CLI-first: host artifacts use the released CLI plus native Skills/Hooks and do not add a local MCP surface.

### ZCode Hook declaration

ZCode automatically loads a Plugin's `hooks/hooks.json`. Do not duplicate that discovery path as `"hooks": "hooks"` in `.zcode-plugin/plugin.json`: the manifest field means an inline Hook object or an exact Hook-file path, so a directory value is diagnosed as an unreadable Hook file. Keep the Hook matcher and `process`/`command` configuration only in `hooks/hooks.json` unless a verified ZCode manifest contract requires an additional source.

### WorkBuddy Hook declaration

WorkBuddy also discovers a Plugin's `hooks/hooks.json` automatically, and its
manifest `hooks` field carries the same inline-object-or-file-path meaning, so
the same duplication trap applies to `.codebuddy-plugin/plugin.json`. WorkBuddy
Hooks use the host-native `command` form only: the schema (verified in the
WorkBuddy 5.5.6 desktop, engine `@tencent-ai/codebuddy-code` 2.137.1) has no
`commandWindows` and no `additionalContextLimit` key — unknown keys are silently
stripped — so neither field may ship. WorkBuddy executes Hook commands through
Git Bash on Windows (the desktop bundles a PortableGit and injects it into
PATH), which is why every command carries the `lore hook workbuddy ||
lore.cmd hook workbuddy` chain instead of a platform-keyed variant. The
SessionStart command degrades to `{"continue":true}`; the per-tool-call
`PreToolUse` command (matcher `^Bash$`) is wrapped fail-open so a missing or
old CLI prints `{}` instead of blocking the tool call.

WorkBuddy compiles SessionStart matchers as a regular expression
(`RegExp(matcher).test(source)`), not as a `|`-split exact-token list: keep the
plain alternation `startup|resume|clear|compact`, which covers all four session
sources, and avoid forms that would accidentally match more (an anchored
`^(startup|resume|clear|compact)$` also works, but is no longer required).
WorkBuddy dispatches a `SubagentStart` event but discards Hook stdout, so the
Plugin registers no SubagentStart Hook and `lore hook workbuddy` answers that
event with an empty no-op.

### Cursor Hook declaration

Cursor's hooks schema is its own: `{ "version": 1, "hooks": { "<event>": [...] } }`
with camelCase event names, a `command` string, and a seconds-based `timeout`
(verified in Cursor 3.21.16). Hook commands run fail-open by default
(`failClosed` is absent), and on Windows they execute through PowerShell with
the payload piped on stdin, where the `lore.cmd` shim resolves by name — so the
bare command `lore hook cursor` needs no wrapper and no platform variant. The
terminal tool is named `Shell`, so the identity rewrite hangs off a `preToolUse`
entry with matcher `^Shell$`; Cursor applies the flat `updated_input` response
field without a permission decision. Cursor's `sessionStart` accepts no
matcher, and its `subagentStart` response cannot inject context, so no
subagent Hook is registered.

### Claude Code Hook declaration

Claude Code discovers a Plugin's `skills/` and `hooks/hooks.json` from their conventional directories, and the manifest `hooks` field carries the same inline-object-or-file-path meaning as ZCode/WorkBuddy, so `.claude-plugin/plugin.json` declares no path pointers and no `hooks` field. The marketplace registration additionally requires an `owner` object that the other host schemas do not have. Do not ship a `commands/` directory: Claude Code positions commands as the legacy form of skills, and the plugin-namespaced Skill `/lorelum:lorelum` is the single explicit entry.

Claude Code Hooks use the shell `command` form. Use the chained command `lore hook claude || lore.cmd hook claude` rather than a bare `lore` invocation or the exec (`args`) form: on macOS and Linux the first term resolves the plain `lore` executable and short-circuits; the second term only covers Windows, where Claude Code runs Hook commands through Git Bash and the Windows installer's `lore.cmd` shim resolves only with its extension (a bare `lore` fails with command-not-found), while the exec form cannot spawn `.cmd`/`.bat` shims at all. No `commandWindows` or `additionalContextLimit` field exists in the Claude Code Hook schema — omit both. SessionStart matchers are exact-token lists; include `fork` (`startup|resume|clear|compact|fork`) because a forked session loses the injected Catalog. Claude Code treats every Hook failure as non-blocking (the session continues), and `lore hook claude` additionally degrades its own failures to `{"continue":true}` with exit code 0, so a wrapper fallback is not used; a missing CLI stays visible as the shell's non-zero exit.

The read-Practice hint chain adds two Hook entries. `PreToolUse` matches the exact token list `Bash|PowerShell` (Claude Code may run shell commands through its PowerShell tool — without Git Bash on Windows the Bash tool is not registered at all) and rewrites the command with session identity; unlike Codex, the rewrite syntax keys on the tool name rather than the platform — the Bash tool runs through a POSIX-style shell even on Windows, so it always gets `export` assignments, and the PowerShell tool always gets `$env:` assignments. The rewrite response carries `updatedInput` without a `permissionDecision`, so Claude Code's normal permission flow still evaluates the rewritten command; Codex's existing `"allow"` shape is unchanged. Because these two Hooks fire on every shell tool call and every subagent start, their commands use the fail-open wrapper (CLI missing or exiting non-zero prints `{}`) instead of the bare `||` chain, and the PreToolUse wrapper additionally normalizes a legacy `{"continue":true}` degrade to `{}`. `SubagentStart` declares no matcher so every subagent type can receive the bounded hint.

### Pi Package declaration

Pi is the one host whose source root is a native **Pi Package** rather than a marketplace artifact. `plugins/pi/lorelum/package.json` uses the product name `lorelum` and an explicit manifest so tests and helper modules cannot be auto-discovered as Extensions:

```json
{
  "pi": {
    "extensions": ["./extensions/lorelum.ts"],
    "skills": ["./skills/lorelum"]
  },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "*" }
}
```

The host package is a type-only `peerDependencies` entry with a `"*"` range: Pi provides it to loaded extensions and the Package must not bundle or list it in `dependencies`. The Package carries no other runtime dependency and no CLI, Store, or model runtime.

The Extension registers only lifecycle handlers in its factory and starts no process, timer, or watcher. `session_start` and a successful `session_compact` clear the previous snapshot and read a bounded Installed Pack Catalog through the `lore hook pi` ABI; the request-time `context` handler projects exactly one `customType: lorelum:pack-catalog` message and never runs the CLI, persists the message, or takes over the system prompt or tools. `session_shutdown` aborts an in-flight call and clears the snapshot; cleanup stays idempotent because cancellation, reload, session replacement, and exit can converge on it. Every failure path degrades without blocking the Pi task, and a stale Catalog is never re-injected as a fresh success.

The Pi adapter runs `lore hook pi` from `PATH` with the payload on stdin, a 5000 ms deadline, a 16 KiB stdout retention cap, and an 8 KiB stderr retention cap. On Windows it prefers a directly executable `lore` and only falls back to the installer's `lore.cmd` through a fixed `cmd.exe` invocation when that executable is missing; termination targets the whole shim process tree through the process id created by that invocation. See [`plugins/pi/lorelum/README.md`](../../plugins/pi/lorelum/README.md) for the distribution model.

## Add a host only when it has a real integration need

1. Confirm the host's official install root, manifest/marketplace contract, trust or permission flow, update mechanism, and command capability.
2. Decide whether `skills/lorelum/` alone solves the user need. Add a Plugin only for a concrete host-native capability such as a session Hook or command.
3. Create `plugins/<hostKey>/lorelum/` only after those facts are verified; do not add placeholder directories for a future host.
4. Keep the public product ID `lorelum`, register only that host's artifact in its native marketplace, and add focused configuration tests for the mapping.
5. Add matching user documentation in English and Chinese. It should explain install, first use, update, and recovery; protocol and source details belong in maintainer material.
6. Validate the portable Skill behavior, host configuration, released-CLI boundary, and a clean host install before claiming support.

The current behavioral contracts are [agent integration](../../openspec/specs/agent-integration/spec.md) and [plugin distribution](../../openspec/specs/plugin-distribution/spec.md).
