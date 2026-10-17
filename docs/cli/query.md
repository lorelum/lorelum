# Query installed Practices

当前可观察合同见 [retrieval query OpenSpec](../../openspec/specs/retrieval-query/spec.md)；本页说明 CLI 参数、精简默认 text、完整 text、JSON machine output 与恢复操作。

`lore query <text>` 在当前 query context 中检索 Practice 并返回小型 summary。默认使用本地 semantic retrieval；`--mode keyword` 保留离线 FTS5 路径。有效项目目录或其父目录中的 `.lorelum/` 会按父到子合并为 ProjectContext；选中的 LocalStore 根目录不是项目 layer。没有有效项目 layer（包括整条路径没有 `.lorelum/`）或传入 `--no-project` 时，query 使用纯 LocalStore。

```sh
# Semantic is the default. A normal query starts the Backend and automatically prepares the fixed local model when needed.
lore query "React 登录页接入现有认证接口"
lore query "database migration rollback" --top-k 10
lore query "database migration rollback" --mode single-vector
lore query "database migration rollback" --mode multi-view-vector

# Explicit zero-configuration, offline keyword retrieval.
lore query "database migration rollback" --mode keyword

lore --store-root /path/to/isolated-store query "request validation"
lore query "request validation" --project-root /path/to/project
lore query "request validation" --no-project
lore query "request validation" --cache-root /path/to/user-cache
lore describe query
```

The positional text is trimmed before validation. It must contain at least one non-whitespace character and may contain at most 4,096 Unicode code points after trimming. `--top-k` is optional, defaults to `5`, and accepts a decimal positive integer from `1` through `50`. `--mode` accepts `semantic` (the default, following `query.retrievalMethod`), `keyword`, `single-vector`, or `multi-view-vector` (the last two are invocation-scoped vector method overrides). `--verbose` selects the complete existing data in text; `--json` returns the complete JSON envelope and data regardless of `--verbose`. `--project-root` selects an ordinary directory directly containing a project `.lorelum/`; it does not require Git and cannot select the chosen Store root. `--no-project` disables layer discovery. `--cache-root` selects only user-owned derived artifacts, never source Pack files or LocalStore.

Parent and child `.lorelum/` layers inherit by default. A child config adds or overrides declared fields and same-ID Practices, while unaffected parent/Store Practices stay in the candidate set. A malformed local Practice is ignored without hiding valid neighbors or a lower-priority fallback; query returns the remaining current winners and `lore context status` exposes the degraded context.

## Semantic mode

Semantic mode uses the request-selected Profile and current query context. Ordinary semantic invocations reread `query.retrievalMethod`: `single-vector` is the default; `multi-view-vector` is experimental. `--mode single-vector` and `--mode multi-view-vector` select that method only for this request (for example, comparing against the default while the configuration selects `multi-view-vector`), skip validation of the overridden method setting, and leave the file, subsequent queries, index commands, and install synchronization unchanged. CLI composition sends `mode: semantic` plus `retrievalMethod: <id>`; Backend and public results do not gain another mode. Semantic result data, including pending `preparing`/`indexing` results, carries `retrievalMethod` naming the method that served the request; keyword results do not. Wait/coverage and input validation retain their existing precedence. There is no separate method flag or environment variable. Configuration ownership belongs in the [maintainer configuration contract](../configuration/README.md#query-方法与前台预算); user configuration belongs in the [site guide](https://lorelum.com/docs/configuration).

The first query with a method not yet built for the corpus starts that method's own background full index build (separate artifact and progress, sharing the single local model queue), so it may return `preparing` or `indexing`; rerun or follow `lore index operation <operationId>`. `lore index status` reports only the configured method. Method artifacts stay in the user cache and appear in `lore cache status`; `lore cache prune` removes every derived state not currently in use, including the default method's, which is rebuilt on next use.

`single-vector` encodes one complete Practice document and one complete query, then ranks by cosine similarity. `multi-view-vector` retains the experimental task-card/body/clause recipe, its 384 estimated-token budget, and existing aggregation formula; selecting it does not establish better ranking quality or resolve [Issue #236](https://github.com/lorelum/lorelum/issues/236). Both methods rank the full eligible canonical corpus before applying `top-k`; method-specific Profile, artifact, progress, and reusable embeddings remain isolated.

When no complete artifact is available, `query` accepts or joins a content-addressed background index operation itself; callers do not need to run `lore index build` first. The foreground observation budget is `query.maxWaitMs` (default integer `3000` milliseconds, overridable with `--max-wait-ms`) after Backend accepts the query; it governs model preparation and index-progress observation, and never cancels the accepted operation. It is not a local Backend connection or RPC deadline: `--max-wait-ms 0` still submits or joins the operation, then returns a ready result or a recoverable `preparing`/`indexing` state.

When the Backend is stopped, a query starts it. When the model is absent or unloaded, Backend records the same operation as `preparing`, starts or joins fixed-model preparation, then continues the build. `--min-coverage-percent` requires a current progress coverage from `0` through `100`; `--require-complete` is the strict `100` percent shortcut and cannot be combined with it.

For a new machine, install a Pack normally. If model preparation is still running, query returns a machine-readable preparing result rather than waiting for the whole transfer:

```sh
lore --store-root /path/to/store pack install agentic-coding
lore --store-root /path/to/store query "how should I verify this release?"
```

`lore index build` and `lore index rebuild` remain useful to observe or force work explicitly. After automatic model/index preparation has started, ordinary semantic queries need neither `backend start` nor a preliminary index command. If the first query returns preparing, inspect `lore model status` and retry after it becomes ready. Explicit `lore model load` remains useful when a prior download failed and the user wants to wait for its retry.

The complete successful result data includes the Profile identity and how completely the active index covers the Store snapshot. This full data is available with `--verbose` or `--json`; the default text omits non-decision metadata such as `profileId` and `contentDigest`:

```json
{
  "mode": "semantic",
  "profileId": "...",
  "coverage": "complete",
  "results": []
}
```

`coverage: "complete"` means the complete artifact exactly matches the current context. `coverage: "partial"` means only the displayed `indexedPracticeCount / totalPracticeCount` current Practice rows are queryable so far. A changed, removed, shadowed, ignored, or incompatible Practice is never substituted from an old artifact. If no current row satisfies the requested coverage policy, the command returns `state: "indexing"` instead of pretending that an empty result or keyword result is semantic retrieval.

## Keyword mode

`--mode keyword` runs directly in Engine, does not need a Backend or model, and does not access the network. It does not consume or validate `query.retrievalMethod`, so an invalid semantic method cannot disable offline keyword retrieval. A ProjectContext maintains a content-addressed FTS5 artifact under the user cache, never under `.lorelum/`; Store-only keyword retrieval retains its Store-derived FTS5 path. In both cases canonical Practice rows/files remain the source of returned summaries. A missing or corrupt artifact is rebuilt from a consistent current snapshot.

## Shared result behavior

Default successful text is a decision view, not a field-for-field rendering of `data`. A ready result shows each hit's `practiceId`, title, stage, non-empty tech stack, and applicability; it includes severity only when non-default, shows `mode` for keyword retrieval, and shows `retrievalMethod` only when it is not `single-vector`. Partial coverage remains explicit with its progress counts, and degraded ProjectContext retains its warning. The default text omits digests, Profile IDs, complete-coverage metadata, and operation IDs on ready results. For `preparing` or `indexing`, it still shows the non-ready state and recovery message; indexing also retains its operation ID and progress counts.

`--verbose` renders the complete existing result data as text. `--json` returns the complete envelope and data and is unaffected by `--verbose`; use it for machine callers rather than parsing text. `results` may be empty and contains at most `top-k` entries. Results are Practice summaries, not source files. They omit the full body and internal scores; use `lore get <practice-id>` to retrieve the complete canonical Practice. Results are deterministic for the same Store snapshot and query implementation. A query does not pin a revision for a later `get` invocation.

When automatic preparation has been accepted but is not ready within the observation interval, semantic query returns `ok: true`, exit code `1`, and no results:

```json
{
  "state": "preparing",
  "preparationId": "<uuid>",
  "message": "The local model is preparing in the background. Check lore model status, then retry this query."
}
```

When there are no eligible current vectors, or the caller requires more coverage than progress has reached, it similarly returns exit code `1` with the operation and exact coverage:

```json
{
  "state": "indexing",
  "operationId": "<uuid>",
  "indexedPracticeCount": 50,
  "totalPracticeCount": 100,
  "message": "The semantic index is building in the background. Retry this query shortly."
}
```

`preparing` and `indexing` only describe an operation that is still non-terminal. If the accepted model preparation or index operation has already failed, query returns its typed error envelope with exit code `2`; it does not keep returning `indexing`. For an `embedding.*` error, fix the reported model condition, run `lore model load` explicitly to retry preparation, then repeat the query.

## Errors and exit codes

Ready query results exit `0`. A successful preparing result exits `1`. Failures exit `2`. Default text success remains on stdout; default errors show complete `error.code` and message, plus diagnostics and resource information when present, on stderr. `--json` writes the complete envelope on stdout. Text and JSON use the same complete message. Machine callers branch on `data.state` and `error.code`, not text or message; failures do not contain a compatibility recovery policy.

Follow the complete error message: run `lore backend stop --if-idle`; only after `state: "stopped"`, run `lore backend start`, then retry the original command with the same arguments. If stop returns `deferred`, leave the instance and task running, report the safe refusal, and do not retry in the background or use ordinary stop without explicit user consent. `query` itself never runs stop or falls back to keyword retrieval.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing or invalid text, `--top-k`, or `--mode` (including an unknown mode). Validation happens before a semantic query connects to the Backend. |
| `query.config-invalid` | Invalid consumed `query` configuration, including an unknown semantic retrieval method. `simple` and `multi-view` are not accepted aliases; keyword does not validate the semantic method. |
| `backend.build-mismatch` / `backend.protocol-mismatch` | A verified Backend belongs to another build or protocol. Follow the message: `lore backend stop --if-idle`, only after stopped run `lore backend start`, then retry the original query. On deferred, leave the task running; no background retry or ordinary stop without explicit user consent. |
| other `backend.*` | The automatic Backend start could not safely complete because of a port conflict, busy state, or deadline. Inspect the reported condition. |
| `embedding.*` | Automatic preparation was disabled, failed, or cannot safely continue. A failed accepted operation returns this code rather than `indexing`; check `lore model status`, fix configuration/resources, then use `lore model load` to retry and wait. |
| `semantic.index-not-ready` | Compatibility-only Backend callers omitted the derived cache route. Normal CLI semantic query starts or joins its operation automatically. |
| `semantic.index-incompatible` | A legacy Store index does not match the request-selected Profile or selected Store. Normal cache-backed query safely rebuilds its current target. |
| `semantic.index-failed` / `semantic.embedding-failed` | The stored index or query embedding violates its contract. Rebuild the index; inspect model status for embedding failures. |
| `query.unavailable` / `query.failed` | The explicit keyword index could not be searched. |
| `store.busy` / `store.recovery-required` | The selected Store kept changing, is mutating, or needs recovery. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |
