## Lorelum __RELEASE_TAG__

> Alpha.5 adds an explicit CLI update path, named and local Pack sources, a Claude Code Plugin, and session read hints across supported Agent hosts.

## Highlights

### Check and apply CLI updates explicitly

`lore update` checks published releases for the current channel and platform, shows the available version and release notes, and leaves the installation unchanged. Prerelease builds select the prerelease channel by default. For a CLI installed by the official installer at its default location, `lore update --apply` rechecks the release, downloads and verifies the selected archive, switches the command entry, and verifies the new version. Other installation methods can check but are not overwritten by `--apply`. `lore --version` and ordinary Agent Hooks do not check for updates in the background.

### Choose a Pack source

`lore registry add`, `list`, `set-default`, and `remove` manage named Registry sources. Pack install and update use the selected source, with the official Registry as the default when no other default is saved. A `--registry` argument overrides it for one command. `lore pack install --path <directory>` and `lore pack update --path <directory>` also accept one local Pack directory without registering it or requiring Git. Lorelum does not silently try another Registry if the selected one fails.

### Claude Code and session read hints

Claude Code joins Codex, ZCode, Cursor, and WorkBuddy as a first-party Plugin host. Its native Plugin provides the Lorelum Skill and session-start Pack Catalog. All five Plugins can associate successful `lore get` reads with a session when a Backend and usable session identity are available. Codex and Claude Code can show bounded read-candidate metadata to new subagents; Cursor, WorkBuddy, and ZCode cannot deliver those hints through their host Hook contracts. The shared `agent.shellSessionInjection` setting controls eligible shell commands. Hints are possibly relevant and incomplete, not a record of everything the session read. See the [host capability comparison](https://lorelum.com/en/docs/agent-setup#host-capabilities) for the differences.

### Smaller Agent output and more useful recovery

Default text for `lore pack list`, `lore query`, and `lore get` emphasizes decision-relevant fields; use `--verbose` for full text or `--json` for the complete machine envelope. CLI failures now give a consistent next action. Managed diagnostic logs repair a damaged logging subtree without treating unrelated ancestor content as Lorelum-owned.

## Upgrade notes

### Update CLI and Plugins separately

The alpha.4 CLI has no `lore update` command: use the exact-version installer below, or the method that manages your current installation, to reach alpha.5. From a default-location official installer-managed alpha.5 installation, later releases can be checked with `lore update` and applied explicitly with `lore update --apply`; other installation methods remain read-only. Install or update the Claude Code Plugin from its marketplace, and update other host Plugins through their respective host flows. Start a new host session after a Plugin update. Pack versions remain independent of the CLI and Plugins.

### Preserve alpha-stage data

Pack formats, LocalStore data, indexes, and retrieval behavior remain alpha-stage contracts; an automatic migration is not promised. Keep a backup or use an isolated `--store-root` when evaluating this release against a shared Store.

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

## Alpha compatibility

CLI behavior, Pack formats, local Store data, indexes, and retrieval results may change before the first stable release. Automatic migration is not guaranteed.

## Full changelog

[Compare v0.1.0-alpha.4 to __RELEASE_TAG__](https://github.com/lorelum/lorelum/compare/v0.1.0-alpha.4...__RELEASE_TAG__)

## Verification

The release workflow builds on macOS, Linux, and Windows; verifies every checksum; unpacks each archive; checks the CLI and native-runtime version commands; and exercises the packaged Backend start and status lifecycle on the matching runner.
