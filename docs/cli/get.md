# Read an installed Practice

当前可观察合同见 [practice read OpenSpec](../../openspec/specs/practice-read/spec.md)；本页说明 CLI 参数、JSON 输出与恢复操作。

`lore get <practice-id>` retrieves one complete canonical Practice by its exact ID from the selected query context. A discovered ProjectContext returns its current local winner; `--no-project` preserves Store-only behavior. The public command contract was agreed in [issue #49](https://github.com/lorelum/lorelum/issues/49); ADR 0011 preserves historical reasoning for the point-read consistency boundary.

```sh
lore pack list
lore pack list agentic-coding
lore get agentic-coding.testing.classify-failure-before-changing-test
lore --store-root /path/to/isolated-store get agentic-coding.testing.classify-failure-before-changing-test
lore get platform.testing --project-root /path/to/project
lore get platform.testing --no-project
lore describe get
```

For discovery, use `lore pack list` first, then `lore pack list <name>` and pass one returned Practice ID to `lore get`.

The ID must follow the existing dotted Practice ID format. Lookup is exact: there is no title matching, prefix completion, or case normalization. The global `--store-root` option also works after the command; relative paths resolve from the calling process's working directory. Omitting it selects the user Store. `--project-root` selects an ordinary directory directly containing `.lorelum/`; nested layers inherit parent configuration by default. Project provenance uses safe logical roots such as `project-layer-0`, never an absolute project path.

## Result

The existing protocol envelope contains `command: "get"`, `ok: true`, and:

```text
data: {
  practice: {
    id, title, stage, tech_stack, applies_when,
    severity, body, anti_patterns
  },
  contentDigest,
  sources: [{ packName, sourcePath, packRoot }]
}
```

`practice` is the canonical runtime representation defined by ADR 0007. It includes the complete Markdown body, LF-normalized text, and expanded defaults: `severity: "warn"`, `body: ""`, `anti_patterns: []`, and `severity: "warn"` on anti-patterns whose authors omitted severity. Author array order is preserved. The reserved, undefined anti-pattern `check` field is excluded by canonicalization.

`contentDigest` is the SHA-256 digest of the canonical content, not a publisher signature. Identical content provided under the same ID by multiple active Packs returns one Practice with all sources, ordered by Pack name and source path. Each `sourcePath` is relative to its source's `packRoot`; a caller can derive the on-disk Practice location as `packRoot/sourcePath`, so the response does not repeat it as `practicePath`.

`packRoot` is the source Pack's absolute, readable `packs/p-<pack-name>/current` view, not its internal digest artifact directory. It is a public locator for a caller that needs to read a Pack-native resource linked by the Practice, such as `[compatibility matrix](resource:references/api-compatibility.md)`. Resolve the portion after `resource:` from the source's `packRoot`. A resource link is a recommendation about when to use extra material, not a file-access allowlist: a caller may also browse an explicitly selected Pack root when that is the user's task.

When `sources` has more than one item, their roots remain distinct. Do not silently select the first source or combine their `references/`, `assets/`, or `scripts/` directories. Select a source using the current task's Pack context, or preserve the ambiguity for the caller. `packRoot` is a mutable current view: after a Pack mutation the same path may resolve to newer bytes, or disappear after removal. If the current source/Practice matters after a mutation, call `lore get` again (or explicitly select a Pack with `lore pack list <name>`) instead of deriving a replacement from Store internals.

## Store behavior

Each invocation calls the Engine's `LocalStore.getEffectivePracticeWithPackRoots()` for the selected root. The storage layer performs a parameterized SQLite primary-key lookup joined with all source rows, then runs the same canonical, digest, path, and row validation used by full snapshot reads. It verifies and hashes every active artifact that supplied the returned Practice, checks its sealed projection, and confirms the Store identity again before returning the locators. It does not audit unrelated Pack artifacts. Existing operation-journal convergence and Store initialization/recovery behavior remain in force.

Therefore a tampered artifact that supplied the requested Practice is a `store.recovery-required` error, while damage to an unrelated artifact can remain undetected by `get`; full Store verification remains the responsibility of recovery/reindex and other paths that explicitly require an audit. A valid ID with no matching row returns `practice.not-found`; a malformed target row, inconsistent SQLite state, unresolved journal, or a Store that keeps changing while locators are resolved is an error. The command does not invoke `reindex` or access a Registry/network.

Separate invocations can observe different Store revisions; there is no cross-command snapshot or version-pinning contract. A single point read is consistent, but it is not a long-lived Session and does not pin a revision for a later command. In particular, a returned `packRoot` remains a current view rather than a historical artifact pin. Refresh `get` or `pack list` after a Pack mutation; do not construct artifact paths from Pack names, SQLite rows, projections, or Store layout. An old Store that has valid active artifacts but no current view is repaired automatically on this locator-returning read without changing retrieval state.

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
