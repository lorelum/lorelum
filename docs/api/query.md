# Query API

当前可观察合同见 [retrieval query OpenSpec](../../openspec/specs/retrieval-query/spec.md)；本页说明 Backend HTTP adapter 的请求与响应细节。

`POST /internal/v1/query` uses the Backend's local authentication boundary. Omitting `mode` selects semantic retrieval; callers that need the offline keyword path must send `mode: "keyword"` explicitly. Normal CLI calls include either `query.cacheRoot` for Store-only semantic retrieval or `query.projectContext` for a directory ProjectContext; this selects user-owned derived state only, never source data or model/runtime settings.

请求 body：

```json
{
  "storageRoot": "/absolute/path/to/isolated-store",
  "query": {
    "text": "responsibility boundary",
    "limit": 5,
    "mode": "semantic",
    "retrievalMethod": "single-vector",
    "cacheRoot": "/absolute/path/to/user-cache",
    "maxWaitMs": 3000,
    "minCoveragePercent": 0
  }
}
```

`storageRoot` must be an absolute path. `text` must not be blank and is limited to 4,096 Unicode code points; `limit` defaults to 5 and ranges from 1 through 50. `mode` is `semantic` or `keyword`; it is optional and defaults to `semantic`. `maxWaitMs` is an integer 0–120000 and `minCoveragePercent` is an integer 0–100. `projectContext` is `{ cacheRoot, startDirectory?, projectRoot? }` with absolute paths and must include at least one of `startDirectory` or `projectRoot`; it and direct `cacheRoot` are mutually exclusive. The request body is a strict JSON object and rejects extra fields.

`query.retrievalMethod` selects `single-vector` (default when omitted) or experimental `multi-view-vector`. `simple` and `multi-view` are not aliases. This is a per-request selection, not daemon configuration: HTTP callers do not inherit the CLI's YAML setting, and the same daemon can serve both methods without restart. Keyword requests ignore this semantic-only value. An invalid semantic method is checked by the controller and returns HTTP `400` / `usage.invalid`; malformed JSON, unknown fields, or other invalid wire shapes still return `backend.invalid-request`.

The CLI-only `--mode multi-view-vector` is composed as `query.mode: "semantic"` plus `query.retrievalMethod: "multi-view-vector"`. Do not send it as an HTTP `mode` value; the API and result modes remain `semantic | keyword`.

The returned `profileId` belongs to this request's encoding plus method recipe (document, query, and scoring versions), not one fixed daemon Profile. Artifacts, progress, and shared-vector cache remain Profile-isolated; accepted operations keep their original execution when later requests choose another method. Internal composition binds these together as `VectorExecution`. Both methods score the full eligible canonical corpus before applying `limit`; their formulas and persistence boundary are described in the [CLI maintainer contract](../cli/query.md#semantic-mode) and [persistence guide](../development/persistence.md#semantic-encoding-input-schema).

成功 `200`：

```json
{
  "mode": "semantic",
  "profileId": "...",
  "coverage": "complete",
  "results": [
    {
      "practiceId": "example.api.guidance",
      "title": "API boundary guidance",
      "stage": "api",
      "techStack": ["typescript"],
      "appliesWhen": "When exposing a local API",
      "severity": "info",
      "contentDigest": "…"
    }
  ]
}
```

Semantic results include `coverage: "complete"` when the complete artifact exactly matches the current Store/ProjectContext corpus. They include `coverage: "partial"` only for verified current progress rows and include `indexedPracticeCount`, `totalPracticeCount`, and `operationId`; changed, deleted, shadowed, ignored, or incompatible Practices are excluded. If no current vector meets the requested coverage, the API returns a successful `200` indexing state instead of a fake empty semantic result:

```json
{
  "state": "indexing",
  "operationId": "<uuid>",
  "indexedPracticeCount": 50,
  "totalPracticeCount": 100
}
```

Model preparation similarly returns `200` with `{ "state": "preparing", "preparationId": "<uuid>" }`. Both states leave their accepted operation running. Keyword results retain their existing shape: `{ "mode": "keyword", "results": [...] }`.

Responses expose only public Practice summary fields, never a body, vector, SQLite handle, or internal score.

## 错误映射

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `backend.invalid-request` | JSON, fields, or request body violates the wire contract. |
| 400 | `usage.invalid` | Query text, limit, or semantic `retrievalMethod` violates the Engine/controller business contract. |
| 503 | `embedding.*` | The local model is not loaded, busy, timed out, or failed. |
| 503 | `semantic.index-not-ready` | Compatibility-only callers omitted the cache-backed automatic target route. |
| 503 | `semantic.index-incompatible` | The index does not match the Store or request-selected Profile. |
| 500 | `semantic.index-failed` | SQLite/index data or candidate verification failed. |
| 503 | `semantic.embedding-failed` | The query embedding violated the request-selected Profile contract. |
| 503 | `query.unavailable` | The explicit keyword index is unavailable. |
| 500 | `query.failed` | The explicit keyword index failed. |
| 503 | `store.busy` | A stable Store snapshot could not be obtained. |
| 503 | `store.recovery-required` | The Store requires recovery. |

认证、Origin、Host 及通用内部错误见 [API 入口](README.md)。
