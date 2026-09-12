# Query API

`POST /internal/v1/query` uses the Backend's local authentication boundary. It neither starts the model nor accesses the model downloader. Omitting `mode` selects semantic retrieval; callers that need the offline keyword path must send `mode: "keyword"` explicitly.

请求 body：

```json
{
  "storageRoot": "/absolute/path/to/isolated-store",
  "query": {
    "text": "responsibility boundary",
    "limit": 5,
    "mode": "semantic"
  }
}
```

`storageRoot` must be an absolute path. `text` must not be blank and is limited to 4,096 Unicode code points; `limit` defaults to 5 and ranges from 1 through 50. `mode` is `semantic` or `keyword`; it is optional and defaults to `semantic`. The request body is a strict JSON object and rejects extra fields.

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

Semantic results include `coverage: "complete"` when the active index exactly matches the Store snapshot. They include `coverage: "partial"` only when retained Store history allows the Engine to exclude every changed Practice before searching stale vectors. A history gap fails instead of returning an unsafe result. Keyword results retain their existing shape: `{ "mode": "keyword", "results": [...] }`.

Responses expose only public Practice summary fields, never a body, vector, SQLite handle, or internal score.

## 错误映射

| HTTP | code | Meaning |
| ---- | ---- | ------- |
| 400 | `backend.invalid-request` | JSON, fields, or request body violates the wire contract. |
| 400 | `usage.invalid` | Query text or limit violates the Engine query contract. |
| 503 | `embedding.*` | The local model is not loaded, busy, timed out, or failed. |
| 503 | `semantic.index-not-ready` | No safe semantic index is available; build it explicitly. |
| 503 | `semantic.index-incompatible` | The index does not match the Store or fixed Profile. |
| 500 | `semantic.index-failed` | SQLite/index data or candidate verification failed. |
| 503 | `semantic.embedding-failed` | The query embedding violated the fixed Profile contract. |
| 503 | `query.unavailable` | The explicit keyword index is unavailable. |
| 500 | `query.failed` | The explicit keyword index failed. |
| 503 | `store.busy` | A stable Store snapshot could not be obtained. |
| 503 | `store.recovery-required` | The Store requires recovery. |

认证、Origin、Host 及通用内部错误见 [API 入口](README.md)。
