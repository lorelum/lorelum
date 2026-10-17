## Why

在 alpha.2 中，semantic query 已接受的 index operation 若因模型准备或构建错误进入 `failed`，query 仍返回 `data.state: "indexing"` 和“retry shortly”。调用方无法区分仍在进行的后台工作与已确认失败，也无法按既有 `embedding.*` 恢复路径处理。

这是现有失败语义的实现缺口，而不是新增检索模式；现在修复可避免无效重试和误导性的成功 pending 响应。

## What Changes

- 让 semantic query 在其当前 target 已确认失败时返回 `ok: false`、exit code `2` 的 error envelope，而不是 `indexing` pending data。
- 在 daemon-owned semantic operation journal 中保留可公开的稳定失败码；模型准备或 embedding 失败时保留原始 `embedding.*` code，其他未分类失败使用既有 `backend.failed`。
- 使 `lore index operation <id>` 与 query 对同一已失败 operation 给出一致的稳定失败码。
- 增加 Backend/CLI 回归测试，并更新 query 文档，明确 `indexing` 只表示仍在进行的 operation。
- 不改变模型首次失败的资源、下载、native runtime 或重试策略；也不新增自动 keyword fallback。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `retrieval-query`: 已确认失败的 semantic operation 必须作为错误而不是 pending indexing 返回。
- `semantic-index`: operation failure 必须保留并公开稳定、可恢复的错误码。

## Impact

- `packages/backend/src/modules/query/content-addressed-semantic-runtime.ts` 与 operation journal 模型。
- Backend index/query protocol schema 与 `packages/cli/src/query/` 错误 envelope 映射。
- Backend、CLI 的 colocated tests，以及 `docs/cli/query.md` 和中英文 query reference。
- 不新增依赖、网络面、MCP 或模型配置字段。
