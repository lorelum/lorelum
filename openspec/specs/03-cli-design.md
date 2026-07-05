# Spec 03 — CLI Design (`lore`)

> **Status:** 🔨 Stub — content being ported.
> Defines the `lore` CLI command surface.

## Command groups

| Group | Commands |
|---|---|
| **Pack management** | `install`, `uninstall`, `update`, `list`, `subscribe` (endpoint) |
| **Query** | `query`, `get`, `decide`, `explain` |
| **Generate** | `scaffold`, `apply-template`, `check`, `audit` |
| **Learn** | `learn`, `capture`, `diff`, `propose-practice` |
| **Publish** | `validate`, `pack`, `publish`, `deprecate` |
| **Config** | `init`, `config set-endpoint`, `config show` |

## Two modes, one CLI

The CLI auto-detects whether an endpoint is configured and routes queries to local index or endpoint accordingly. Users don't think about "modes" — same commands, different data source.

## Example flows

```bash
# Local (default)
lore install react-fullstack
lore query "settings page with permission guard and tests"
lore check src/features/auth/LoginPage.tsx

# Endpoint (team)
lore config set-endpoint https://team.lorelum.com
lore subscribe acme-react-standard
lore query "..."      # now hits the endpoint
```

<!-- TODO: port full command reference, exit codes, error handling from private spec. -->
