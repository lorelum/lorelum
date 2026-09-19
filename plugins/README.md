# Lorelum host Plugins

Each supported host artifact lives at `plugins/<hostKey>/lorelum/`. The
directory identifies the host adapter; `lorelum` remains the product ID that
users install in that host's marketplace.

| Host | Source root | Native registration |
| --- | --- | --- |
| Codex | [`codex/lorelum`](./codex/lorelum) | [`.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json) |
| WorkBuddy | [`workbuddy/lorelum`](./workbuddy/lorelum) | [`.codebuddy-plugin/marketplace.json`](../.codebuddy-plugin/marketplace.json) |
| ZCode | [`zcode/lorelum`](./zcode/lorelum) | [`marketplace.json`](../marketplace.json) |
| Cursor | [`cursor/lorelum`](./cursor/lorelum) | [`.cursor-plugin/marketplace.json`](../.cursor-plugin/marketplace.json) |

Read [Host Plugin conventions](../docs/development/plugin-conventions.md)
before changing an artifact, registration, public ID, or version. All
artifacts call the released `lore` CLI for Pack metadata. They must not import
Engine packages, read LocalStore files directly, or reproduce retrieval and
ranking behavior.

## Current integration boundary

Lorelum is CLI-first. Host Plugins use the compiled `lore` CLI plus host-native Skills and Hooks; they do not start, bundle, configure, or call a local MCP server. Do not add a local MCP convenience layer, stdio server, MCP tools, or MCP-backed UI while developing a Plugin. MCP is reserved for a separately approved future platform remote-retrieval service, not a local performance or integration optimization. See [the active scope decision](../openspec/specs/agent-integration/spec.md).

Do not add placeholder directories for future agents. When another host needs
a real integration, define its independent install and trust model first; only
then add its artifact using the conventions above. A future `learn` capability
remains inside the relevant host Plugin unless it later requires independent
installation, permissions, trust, audience, or release cadence.
