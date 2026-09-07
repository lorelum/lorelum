# Read an installed Practice

`lore get <practice-id>` retrieves one complete canonical Practice by its exact ID from the selected LocalStore. The public command contract was agreed in [issue #49](https://github.com/lorelum/lorelum/issues/49); the Engine point-read path and its consistency boundary are described in [ADR 0011](../adr/0011-local-store-point-read-and-query-boundary.md).

```sh
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store get agentic-coding.testing.classify-failure-before-changing-test
lore describe get
```

The ID must follow the existing dotted Practice ID format. Lookup is exact: there is no title matching, prefix completion, or case normalization. The global `--store-root` option also works after the command; relative paths resolve from the calling process's working directory. Omitting it selects the user Store.

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

`practice` is the canonical runtime representation defined by ADR 0007. It includes the complete Markdown body, LF-normalized text, and expanded defaults: `severity: "warn"`, `body: ""`, `anti_patterns: []`, and `severity: "warn"` on anti-patterns whose authors omitted severity. Author array order is preserved. The reserved, undefined anti-pattern `check` field is excluded by canonicalization.

`contentDigest` is the SHA-256 digest of the canonical content, not a publisher signature. Identical content provided under the same ID by multiple active Packs returns one Practice with all sources, ordered by Pack name and source path. Each `sourcePath` is relative to its Pack root. Internal canonical serialization, duplicate source content, and machine-local absolute paths are not returned.

## Store behavior

Each invocation calls the Engine's `LocalStore.getEffectivePractice()` once for the selected root. The storage layer performs a parameterized SQLite primary-key lookup joined with all source rows, then runs the same canonical, digest, path, and row validation used by full snapshot reads. The read is accepted only when manifest A, the SQLite `(generation, effectiveRevision)` tuple, and manifest B describe the same committed state. Existing operation-journal convergence and Store initialization/recovery behavior remain in force.

The point-read contract does not scan or hash any Pack artifact, including the artifact containing the requested Practice. Therefore a tampered artifact, or a canonical row unrelated to the requested Practice, can remain undetected by a normal `get`; full Store verification remains the responsibility of recovery/reindex and other paths that explicitly require an audit. A valid ID with no matching row returns `practice.not-found`; a malformed target row, inconsistent SQLite state, unresolved journal, or concurrent mutation is an error. The command does not invoke `reindex` or access a Registry/network.

Separate invocations can observe different Store revisions; there is no cross-command snapshot or version-pinning contract. A single point read is consistent, but it is not a long-lived Session and does not pin a revision for a later command.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and exit `2`. Both success and failure write exactly one JSON line to stdout.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing/extra arguments, malformed ID, or invalid options. |
| `practice.not-found` | Valid ID absent from a healthy Store, including an empty Store. |
| `store.busy` | A stable Store snapshot could not be obtained due to concurrent work. |
| `store.recovery-required` | The selected Store could not be opened and recovered normally. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |

Invalid IDs fail before opening the Store. The Engine API reports `InvalidPracticeIdError`; the CLI translates it to `usage.invalid`. Visible errors do not include raw arguments or internal failure details. Callers should branch on `code` rather than parsing `message`.

This command does not implement semantic search, batch lookup, Pack/version selection, runtime translations, or related-Practice expansion.
