# Query installed Practices

`lore query <text>` searches the installed Practices in the selected LocalStore and returns a small summary for each match. It defaults to local semantic retrieval; `--mode keyword` retains the offline FTS5 path.

```sh
# Semantic is the default. Start the Backend, load the model, and build this Store's index first.
lore query "React 登录页接入现有认证接口"
lore query "database migration rollback" --top-k 10

# Explicit zero-configuration, offline keyword retrieval.
lore query "database migration rollback" --mode keyword

lore --store-root /path/to/isolated-store query "request validation"
lore describe query
```

The positional text is trimmed before validation. It must contain at least one non-whitespace character and may contain at most 4,096 Unicode code points after trimming. `--top-k` is optional, defaults to `5`, and accepts a decimal positive integer from `1` through `50`. `--mode` accepts `semantic` (the default) or `keyword`. The global `--store-root` option follows the same resolution rules as `get`.

## Semantic mode

Semantic mode uses the fixed local Profile and the selected Store's previously built semantic index. It does not start the Backend, download or load the model, or build an index. Prepare those resources explicitly:

```sh
lore backend start
lore model load
lore --store-root /path/to/store index build
lore --store-root /path/to/store query "how should I verify this release?"
```

The successful result includes the Profile identity and how completely the active index covers the Store snapshot:

```json
{
  "mode": "semantic",
  "profileId": "...",
  "coverage": "complete",
  "results": []
}
```

`coverage: "complete"` means the index and Store snapshot are identical. `coverage: "partial"` means the Store changed after the index was built, but Lorelum could use a continuous change history to exclude every affected Practice and safely return results from the remaining vectors. If that safety proof is unavailable, the command fails and asks for an explicit `index build`; it never silently switches to keyword retrieval.

## Keyword mode

`--mode keyword` runs directly in Engine, does not need a Backend or model, and does not access the network. It maintains its own derived FTS5 index at `indexes/keyword/v<index-version>/active.sqlite`. The index is separate from `store.sqlite`; canonical Practice rows remain the source of returned summaries. A missing, corrupt, incompatible, or history-gap keyword index is rebuilt from a consistent Store snapshot.

## Shared result behavior

Both modes return one JSON protocol envelope on stdout. `results` may be empty and contains at most `top-k` entries. Results are Practice summaries, not source files. They omit the full body and internal scores; use `lore get <practice-id>` to retrieve the complete canonical Practice. Results are deterministic for the same Store snapshot and query implementation. A query does not pin a revision for a later `get` invocation.

## Errors and exit codes

Success exits `0`. Failures use `ok: false` with `error: { code, message }` and exit `2`. Both paths write exactly one JSON line to stdout. Callers should branch on `code`, not parse the message.

| Code | Meaning |
| --- | --- |
| `usage.invalid` | Missing or invalid text, `--top-k`, or `--mode`. Validation happens before a semantic query connects to the Backend. |
| `backend.*` | The local Backend is absent, incompatible, busy, or exceeded its request deadline. Start or inspect it with `lore backend ...`. |
| `embedding.*` | The local model is not loaded, is busy, timed out, or failed. Check `lore model status` and explicitly load it when needed. |
| `semantic.index-not-ready` | No usable index exists, or Store history cannot safely bridge its age. Run `lore index build`. |
| `semantic.index-incompatible` | The index does not match the fixed Profile or selected Store. Run `lore index rebuild`. |
| `semantic.index-failed` / `semantic.embedding-failed` | The stored index or query embedding violates its contract. Rebuild the index; inspect model status for embedding failures. |
| `query.unavailable` / `query.failed` | The explicit keyword index could not be searched. |
| `store.busy` / `store.recovery-required` | The selected Store kept changing, is mutating, or needs recovery. |
| `runtime.unexpected` | An undeclared internal failure prevented completion. |
