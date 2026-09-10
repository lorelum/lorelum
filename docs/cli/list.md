# Discover installed Packs with `lore list`

`lore list` discovers the active Packs in the selected LocalStore. Use
`lore list --pack <name>` to inspect the Practice summaries provided by one
installed Pack, then pass a returned Practice ID to `lore get`. The contract is
defined in [ADR 0014](../adr/0014-list-catalog-contract.md).

This page documents the CLI/engine catalog contract. It assumes the caller
already knows the Lorelum CLI entry point; it does not define automatic
discovery of Lorelum or invocation by a Skill, Plugin, Hook, or MCP adapter.

```sh
lore list
lore list --pack agentic-coding
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store list
lore describe list
```

The global `--store-root` option can appear before or after the command. Relative
paths resolve from the calling process's working directory. Omitting it selects
the user Store. The CLI rejects a missing or empty value; other non-empty path
strings are passed to LocalStore without a platform-specific path pre-check.

## Pack list

Without `--pack`, the protocol envelope contains `command: "list"`, `ok: true`,
and:

```text
data: {
  generation,
  effectiveRevision,
  packs: [
    { name, version, practiceCount }
  ]
}
```

Pack entries are sorted by `name`. `version` comes from the selected
Store's verified active manifest. `practiceCount` counts effective Practices
for which that Pack has a source claim. If multiple Packs provide the same
Practice, each Pack counts it; the values therefore are not a global
deduplicated Practice total.

A fresh Store is a successful response with `packs: []`.

## Pack catalog

With `--pack`, the response contains:

```text
data: {
  generation,
  effectiveRevision,
  pack: { name, version },
  practices: [
    { id, title, applies_when }
  ]
}
```

Practice entries are limited to the summaries needed for discovery and are
sorted by exact `id`. The returned `id` can be passed directly to `lore get`.
Full Practice bodies, anti-patterns, and source details remain part of `get`.
An installed Pack with zero Practices is successful and returns an empty
`practices` array.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and
exit `2`. Both success and failure write exactly one JSON line to stdout.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing/extra arguments, malformed Pack name, or invalid options. |
| `list.pack-not-found` | The requested Pack is not active in the selected Store. |
| `store.busy` | A stable Store snapshot could not be obtained due to concurrent work. |
| `store.recovery-required` | The selected Store could not be opened and recovered normally. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |

Pack names are validated against the existing Pack format before the Store is
opened. The `list.pack-not-found` message does not echo the supplied Pack name.
Callers should branch on `error.code` rather than parsing `message`.

`list` does not search remote Registries, perform semantic ranking, paginate,
filter, or return complete Practice bodies. Use `lore query` for task-oriented
retrieval and `lore get` for one complete Practice.
