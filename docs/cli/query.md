# Query installed Practices

`lore query <text>` searches the installed Practices in the selected LocalStore and returns a small summary for each match. The current command is offline keyword search; it does not call an Embedding provider and does not claim semantic understanding. The Engine contract and implementation boundary are defined in [ADR 0011](../adr/0011-local-store-point-read-and-query-boundary.md) and implemented under [Issue #60](https://github.com/lorelum/lorelum/issues/60).

```sh
lore query "React 登录页接入现有认证接口"
lore query "database migration rollback" --top-k 10
lore --store-root /path/to/isolated-store query "request validation"
lore describe query
```

The positional text is trimmed before validation. It must contain at least one non-whitespace character and may contain at most 4,096 Unicode code points after trimming. `--top-k` is optional, defaults to `5`, and accepts a decimal positive integer from `1` through `50`. A value such as `5.0`, `-1`, or `51` is invalid. The global `--store-root` option follows the same resolution rules as `get`.

## Result

The command writes one JSON protocol envelope to stdout. A successful result has `command: "query"`, `ok: true`, and this data shape:

```json
{
  "mode": "keyword",
  "results": [
    {
      "practiceId": "react.api.layered-design",
      "title": "分层 API 设计",
      "stage": "api-layer",
      "techStack": ["react", "typescript"],
      "appliesWhen": "在 React SPA 中构建 API 层",
      "severity": "warn",
      "contentDigest": "..."
    }
  ]
}
```

`results` may be empty and contains at most `top-k` entries. Results are Practices, not individual source files. The response intentionally omits the full body and internal BM25 score; use `lore get <practice-id>` to retrieve the complete canonical Practice. Ordering is deterministic for the same Store snapshot and query implementation: higher internal relevance first, then Practice ID for ties. A query does not pin a revision for a later `get` invocation.

## Store and index behavior

The first query builds a derived SQLite FTS5 index under the selected Store root at `indexes/keyword/v<index-version>/active.sqlite`; it is separate from `store.sqlite`, whose canonical Practice rows remain the source of truth. Later queries reuse an index whose root binding and effective revision match the Store. An implementation-version directory isolates indexes when the FTS schema, projection, tokenizer, or ranking behavior changes. Queries search FTS5, then materialize and digest-check only the matched canonical Practice rows before assembling summaries.

Install, upgrade, uninstall, and reindex do not wait for index work. LocalStore records an internal effective-revision delta with each changed corpus. A later query applies a contiguous delta to the FTS table in one SQLite transaction; it deletes affected IDs, inserts the final changed rows, and advances the index checkpoint. A missing, corrupt, incompatible, or history-gap index is rebuilt from one complete consistent snapshot. The index is never treated as a source for summaries or as a fallback for an inconsistent Store.

The indexed fields are Practice ID, title, applies-when text, tech-stack values, stage, anti-pattern text, and body. The current internal weights are `id: 8`, `title: 5`, `appliesWhen: 3`, `techStack: 2`, `stage: 1`, `antiPatterns: 1`, and `body: 1`. These are implementation parameters, not CLI options. Query text and indexed text use the same tokenizer, including normalization for technical identifiers and CJK text; raw user text is encoded as FTS literal terms rather than passed through as FTS operators.

The query path does not run the full artifact audit performed by `open()`, and it does not converge pending operation journals. It uses the same lock-free manifest/SQLite snapshot protocol as the existing full-read path. A Store that is busy or inconsistent therefore fails instead of returning a mixed or stale corpus. The query does not access the Registry or network. A query checks index metadata and its returned candidate digests; it is not a whole-index audit.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and exit `2`. Both paths write exactly one JSON line to stdout. Callers should branch on `code`, not parse the message.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing text, invalid text length, malformed `--top-k`, duplicate option, or another command-line syntax error. |
| `query.unavailable` | Bun SQLite FTS5 is unavailable in the current runtime. |
| `query.failed` | The keyword index could not be built or searched. |
| `store.busy` | A stable LocalStore corpus could not be obtained because it kept changing or a mutation is in progress. |
| `store.recovery-required` | The selected LocalStore is inconsistent or cannot be read normally. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |

The Engine API reports `InvalidQueryRequestError`, `KeywordIndexUnavailableError`, and `KeywordIndexError` for the corresponding domain failures. CLI translation keeps those implementation types out of the protocol. Semantic, hybrid, structured-filter, and result-count options are not part of this command.
