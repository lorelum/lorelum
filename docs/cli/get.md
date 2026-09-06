# Read an installed Practice

`lore get <practice-id>` retrieves one complete canonical Practice by its exact
ID from the selected LocalStore. The contract was agreed in [issue #49](https://github.com/lorelum/lorelum/issues/49).

```sh
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store get agentic-coding.testing.classify-failure-before-changing-test
lore describe get
```

The ID must follow the existing dotted Practice ID format. Lookup is exact:
there is no title matching, prefix completion, or case normalization. The global
`--store-root` option also works after the command; relative paths resolve from
the calling process's working directory. Omitting it selects the user Store.

## Result

The existing protocol envelope contains `command: "get"`, `ok: true`, and:

```text
data: {
  practice: {
    id, title, stage, tech_stack, applies_when,
    severity, body, anti_patterns
  },
  contentDigest,
  sources: [{ packName, sourcePath }]
}
```

`practice` is the canonical runtime representation defined by ADR 0007. It
includes the complete Markdown body, LF-normalized text, and expanded defaults:
`severity: "warn"`, `body: ""`, `anti_patterns: []`, and `severity: "warn"` on
anti-patterns whose authors omitted severity. Author array order is preserved.
The reserved, undefined anti-pattern `check` field is excluded by canonicalization.

`contentDigest` is the SHA-256 digest of the canonical content, not a publisher
signature. Identical content provided under the same ID by multiple active Packs
returns one Practice with all sources, ordered by Pack name and source path.
Each `sourcePath` is relative to its Pack root. Internal canonical serialization,
duplicate source content, and machine-local absolute paths are not returned.

## Store behavior

Each invocation calls `LocalStore.open()` once and selects from that verified
snapshot. It inherits normal Store initialization, schema migration, and pending
operation-journal recovery. A healthy read does not advance generation or
effectiveRevision or change installed content. This is not a promise of zero
filesystem writes: opening a missing Store initializes it, and recovering a prior
interrupted operation can write Store state.

Store integrity is checked before reporting absence, including when the requested
ID is unknown. Missing or damaged artifacts and inconsistent SQLite state are
errors. The command does not invoke `reindex` or access a Registry/network.

The current implementation verifies and materializes the full active Store.
Separate invocations can observe different Store revisions; there is no
cross-command snapshot or version-pinning contract.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and exit `2`.
Both success and failure write exactly one JSON line to stdout.

| Code                      | Meaning                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| `usage.invalid`           | Missing/extra arguments, malformed ID, or invalid options.            |
| `practice.not-found`      | Valid ID absent from a healthy Store, including an empty Store.       |
| `store.busy`              | A stable Store snapshot could not be obtained due to concurrent work. |
| `store.recovery-required` | The selected Store could not be opened and recovered normally.        |
| `runtime.unexpected`      | An undeclared internal failure prevented completion.                  |

Invalid IDs fail before opening the Store. Visible errors do not include raw
arguments or internal failure details. Callers should branch on `code` rather
than parsing `message`.

This command does not implement semantic search, batch lookup, Pack/version
selection, runtime translations, or related-Practice expansion.
