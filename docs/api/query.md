# Keyword Query API

`POST /internal/v1/query` 使用 backend 的本地认证边界，不启动模型，也不访问 embedding 下载器。它查询选定 LocalStore 的 keyword index；semantic query/index 仍是后续阶段。

请求 body：

```json
{
  "storageRoot": "/absolute/path/to/isolated-store",
  "query": {
    "text": "responsibility boundary",
    "limit": 5
  }
}
```

`storageRoot` 必须是绝对路径。`text` 由 QueryService 做领域校验，不能为空，最多 4,096 个 Unicode code points；`limit` 可省略，默认 5，范围为 1–50。请求体必须是严格 JSON 对象，不接受额外字段。

成功 `200`：

```json
{
  "mode": "keyword",
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

响应只包含可公开的 Practice 摘要字段，不返回完整 body、SQLite handle 或内部 score。常见错误为 `usage.invalid`、`query.unavailable`、`query.failed`、`store.busy` 和 `store.recovery-required`。

## 错误映射

| HTTP | code                      | 含义                            |
| ---- | ------------------------- | ------------------------------- |
| 400  | `backend.invalid-request` | JSON/字段/请求体不符合合同      |
| 400  | `usage.invalid`           | 查询文本或 limit 不符合领域约束 |
| 503  | `query.unavailable`       | keyword index 不可用            |
| 500  | `query.failed`            | keyword index 查询失败          |
| 503  | `store.busy`              | 无法取得可用 Store snapshot     |
| 503  | `store.recovery-required` | Store 需要恢复                  |

认证、Origin、Host 及通用内部错误见 [API 入口](README.md)。
