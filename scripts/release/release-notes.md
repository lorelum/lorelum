## Lorelum __RELEASE_TAG__

## New capabilities

### Check and apply CLI updates explicitly

`lore update` checks published releases for the current channel and platform, shows the available version and release notes, and leaves the installation unchanged. Prerelease builds select the prerelease channel by default. For a CLI installed by the official installer at its default location, `lore update --apply` rechecks the release, downloads and verifies the selected archive, switches the command entry, and verifies the new version. Archive downloads now show received bytes and speed, plus the total and percentage when available; finishing a download is not reported as a completed install. Other installation methods can check but are not overwritten by `--apply`. `lore --version` and ordinary Agent Hooks do not check for updates in the background. [#256](https://github.com/lorelum/lorelum/pull/256)

### Choose a Pack source

`lore registry add`, `list`, `set-default`, and `remove` manage named Registry sources, including other HTTPS/SSH Git hosts and local Git worktrees. Pack install and update use the selected source, with the official Registry as the default when no other default is saved. A `--registry` argument overrides it for one command. `lore pack install --path <directory>` and `lore pack update --path <directory>` also accept one local Pack directory without registering it or requiring Git. Lorelum does not silently try another Registry if the selected one fails. [#240](https://github.com/lorelum/lorelum/pull/240)

### Claude Code Plugin

Claude Code joins the official Plugin hosts. Its native Plugin provides the Lorelum Skill and a session-start Pack Catalog; install it from the Lorelum marketplace and start a new session. [#252](https://github.com/lorelum/lorelum/pull/252)

### Session read hints

The Codex, Claude Code, ZCode, WorkBuddy, and Cursor Plugins can associate successful `lore get` reads with a session when a Backend and usable session identity are available. Codex and Claude Code can show bounded read-candidate metadata to new subagents; Cursor, WorkBuddy, and ZCode cannot deliver those hints through their host Hook contracts. The shared `agent.shellSessionInjection` setting controls eligible shell commands. Hints are possibly relevant and incomplete, not a record of everything the session read. See the [host capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities). [#250](https://github.com/lorelum/lorelum/pull/250) [#257](https://github.com/lorelum/lorelum/pull/257) [#260](https://github.com/lorelum/lorelum/pull/260)

## Performance

On Linux and Windows x64, native document embedding now uses the optimized x64 build instead of the previous scalar path. In the same-machine, same-model 97-Practice comparison recorded in [#244](https://github.com/lorelum/lorelum/pull/244), throughput rose from **0.43 to 3.6–3.9 Practices/s**, and a complete index build fell from about **225 seconds to 25 seconds**. These are measurements for that workload, not a cross-machine performance guarantee; macOS was not changed by this optimization.

## Agent-facing output

Default text for `lore pack list`, `lore query`, and `lore get` now emphasizes the fields an Agent needs to decide what to read. Use `--verbose` for full text or `--json` for the complete machine envelope. The machine-readable result remains available to integrations. [#258](https://github.com/lorelum/lorelum/pull/258)

## Agent guidance

The generic Lorelum Skill and the host-native copies now focus on when to query, how to recover from a failed semantic query, and how to locate linked Pack resources after `get`. Their retrieval example describes a concrete task decision rather than a generic keyword prompt. [#258](https://github.com/lorelum/lorelum/pull/258)

## Bug fixes

- Invalid CLI arguments and configuration now produce a more specific, actionable error message, including valid choices or a repair target when known. Error codes, exit codes, and the JSON error shape remain unchanged; programs should continue to use those fields rather than parse message prose. [#237](https://github.com/lorelum/lorelum/pull/237)
- A user-owned `~/.lorelum` directory with ordinary permissions no longer silently prevents diagnostic logs from being recorded. Lorelum repairs safe managed log paths; if logging still cannot persist, it reports the failure on stderr without changing the command's business result or exit code. It does not change permissions on the user's home directory. [#255](https://github.com/lorelum/lorelum/pull/255)
- A missing, mismatched, or damaged native runtime is now checked before model download and reported as `embedding.native-resource-invalid`, with the failed resource check and an instruction to reinstall the complete release directory. Model-file failures retain `embedding.resource-invalid` and point to the model cache or configured `embedding.modelPath`. `model status`, `model load`, and semantic query preserve this distinction; a startup integrity failure is no longer presented as a timeout. [#266](https://github.com/lorelum/lorelum/pull/266) (refs [#261](https://github.com/lorelum/lorelum/issues/261))

## Contributor workflow

CI now runs lifecycle tests in parallel and checks the workspace with native TypeScript 7; the site build remains part of verification. [#220](https://github.com/lorelum/lorelum/pull/220) [#222](https://github.com/lorelum/lorelum/pull/222)

For local development, `bun run build:cli` now builds a runnable CLI with its matching native runtime in `dist/release/<target>/`. `bun run build:cli-only` produces only `dist/lore` for uses such as benchmarks. The release-archive path is unchanged. [#266](https://github.com/lorelum/lorelum/pull/266)

Issue and PR guidance now asks for evidence a contributor or reviewer can use without the original conversation. [#239](https://github.com/lorelum/lorelum/pull/239) [#248](https://github.com/lorelum/lorelum/pull/248)

## Documentation

The [Agent integration guide](https://lorelum.com/en/docs/agent-setup#host-capabilities) compares the five hosts' Catalog, read-recording, and subagent-hint support. The [maintainer release runbook](https://github.com/lorelum/lorelum/blob/main/docs/development/release.md) documents CI-owned draft creation and recovery. [#219](https://github.com/lorelum/lorelum/pull/219)

## Upgrade notes

### Upgrade the CLI

The alpha.4 CLI has no `lore update` command: use the exact-version installer below, or the method that manages your current installation, to reach alpha.5. From a default-location official installer-managed alpha.5 installation, later releases can be checked with `lore update` and applied explicitly with `lore update --apply`; other installation methods remain read-only.

### Update host Plugins

Install the Claude Code Plugin from its marketplace. Update the other host Plugins through their respective host flows, then start a new session to load the Hooks. Pack versions remain independent of the CLI and Plugins.

### If you consume CLI text output

The default human-readable output of `pack list`, `query`, and `get`, and the fields shown in the session-start Pack Catalog, are intentionally shorter. If you relied on the previous full text, use `--verbose`; scripts should consume `--json`, whose envelope and data fields are unchanged. `get` still exposes the source roots needed to open linked Pack resources. [#258](https://github.com/lorelum/lorelum/pull/258)

### Development builds

Scripts that expect `bun run build:cli` to leave a single `dist/lore` executable should switch to `build:cli-only`. The regular `build:cli` output is now the complete `dist/release/<target>/` directory; keep its native files with the CLI when copying it. [#266](https://github.com/lorelum/lorelum/pull/266)

### Resource-error consumers

The CLI/Backend error protocol adds `embedding.native-resource-invalid` and an optional `resource` detail. Consumers that match resource errors should handle the new code; the existing model-file error code is unchanged. This change does not migrate Store, Pack, or model-cache data. [#266](https://github.com/lorelum/lorelum/pull/266)

### Existing semantic vectors

The x64 embedding optimization keeps the encoding identity, so that change alone does not require rebuilding existing semantic vectors.

### Pack and Store data

Pack formats, LocalStore data, indexes, and retrieval behavior remain alpha-stage contracts; an automatic migration is not promised. Keep a backup or use an isolated `--store-root` when evaluating this release against a shared Store.

## Known limitations

- The x64 speedup does not change the deadline shared by all inputs in an embedding batch. A timeout can still fail the model and make subsequent semantic queries unavailable until `lore model load` recovers it. That timeout behavior is tracked separately in [#243](https://github.com/lorelum/lorelum/issues/243).
- Read candidates are associated with a session, not proven to have come only from the main Agent. A subagent's own successful `lore get` may appear in that session's list. [#215](https://github.com/lorelum/lorelum/issues/215)
- Cursor, WorkBuddy, and ZCode record eligible reads but cannot pass candidate hints to new subagents. See the [host comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities).

## Install __RELEASE_TAG__

### macOS on Apple Silicon and Linux x64

    curl -fsSL https://raw.githubusercontent.com/lorelum/lorelum/main/install.sh | sh -s -- --version __RELEASE_VERSION__

### Windows x64

    & ([scriptblock]::Create((irm https://raw.githubusercontent.com/lorelum/lorelum/main/install.ps1))) -Version __RELEASE_VERSION__

The installers download the matching archive and `SHA256SUMS`, verify the archive checksum, and install the complete release directory. On Windows, run the PowerShell command from an already-open session so any installer error remains visible.

## Downloads

Use the installers above for normal installation. These assets are available for manual or offline use:

- lore-__RELEASE_VERSION__-darwin-arm64.tar.gz — macOS on Apple Silicon
- lore-__RELEASE_VERSION__-linux-x64.tar.gz — Linux x64
- lore-__RELEASE_VERSION__-win32-x64.zip — Windows x64
- lore-__RELEASE_VERSION__-darwin-arm64.metadata.json
- lore-__RELEASE_VERSION__-linux-x64.metadata.json
- lore-__RELEASE_VERSION__-win32-x64.metadata.json
- SHA256SUMS — SHA-256 checksums for every archive and metadata file

macOS on Apple Silicon is Lorelum's priority platform and the most thoroughly validated release target. Linux x64 and Windows x64 are best-effort targets; compatibility and performance across every operating-system build, hardware configuration, and local security policy are not guaranteed.

## Full changelog

[Compare v0.1.0-alpha.4 to __RELEASE_TAG__](https://github.com/lorelum/lorelum/compare/v0.1.0-alpha.4...__RELEASE_TAG__)

## Verification

The release workflow builds on macOS, Linux, and Windows; verifies every checksum; unpacks each archive; checks the CLI and native-runtime version commands; and exercises the packaged Backend start and status lifecycle on the matching runner.
