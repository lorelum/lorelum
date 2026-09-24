# 本地语义检索 Benchmark Harness

本文定义主仓库提供给独立 benchmark runner 的内部进程协议。它只用于锁定的 Lorelum checkout，不是用户 CLI 命令、Backend HTTP API 或 Engine 的公开 package export。

## 启动和输入

从仓库根目录启动固定 checkout 中的入口：

```sh
bun packages/backend/src/benchmark/semantic-retrieval-harness.ts
```

进程从 stdin 读取一个 JSON 对象，stdout 写出一行 JSON。请求必须显式指定 test-owned Store 的绝对路径；harness 不会回退到默认 Store，也不会构建或修复 semantic index。benchmark runner 负责固定 Store/Pack、Lorelum commit、Profile、案例版本和运行环境，并在 provenance 中记录协议版本 `1`。

成功请求的字段如下；未知字段会被拒绝，因此 gold labels 不得放入请求：

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `query` | string | Lorelum semantic query；按 Engine query 规则验证和 trim。 |
| `storeRoot` | string | 必填绝对路径，指向 benchmark 管理的固定 Store。 |
| `embeddingProfileId` | string | 64 位小写十六进制 Profile ID，必须与本地 Backend 配置对应的固定 embedding runtime 一致。 |
| `candidateWidth` | integer | `N`，范围 1–50。 |
| `resultLimit` | integer | `K`，范围 1–50，且不得大于 `N`。 |

示例：

```json
{
  "query": "Review the proposed change",
  "storeRoot": "/tmp/lorelum-benchmark/store",
  "embeddingProfileId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "candidateWidth": 20,
  "resultLimit": 5
}
```

harness 复用 Backend 现有的模型准备和 runtime 代码，但不会为 benchmark 自动下载模型。运行环境必须先运行 `bun run build:native` 并预先提供通过校验的本地模型；Profile 不匹配、模型不可用或索引未 ready 时应先修复 benchmark 环境，而不是把失败记为召回/排序错误。

## 输出

成功时 stdout 仅含状态、候选 Practice ID 名单和有序最终 ID 名单：

```json
{
  "status": "ok",
  "candidateIds": ["review.core", "review.supporting"],
  "finalIds": ["review.core"]
}
```

失败时只含明确状态与稳定错误码，不含任何部分名单：

```json
{ "status": "error", "errorCode": "index_unavailable" }
```

当前错误码为 `invalid_request`、`profile_mismatch`、`runtime_unavailable`、`index_unavailable`、`store_busy`、`retrieval_failed`、`invalid_result`。错误消息、query、正文、相似度、score、标签和 snapshot 私有字段都不输出。成功进程退出码为 0；结构化失败响应退出码为非零。

## 名单语义

- `candidateIds` 按 Engine 当前 semantic reader 的候选顺序排列。仅当候选完成 canonical Practice 校验和 Store snapshot 检查后才可返回。
- `finalIds` 是同一次 Engine 检索中当前正常排序的前 `K` 个 ID。第一阶段只拆开 `N`/`K`，不引入新的排序策略；普通 `lore query` 的结果 envelope 不变。
- 两份名单来自同一个成功 query attempt 和 snapshot。若 Store 变化触发 retry，前一 attempt 的名单丢弃；最终失败不能返回部分候选结果。
- `candidateIds` 与 `finalIds` 都必须无重复；`finalIds` 必须是 `candidateIds` 的子集且长度不超过 `K`。违反协议的结果属于 `invalid_result`，不能作为召回或排序错误评分。

benchmark runner 在进程外读取 gold labels 并评分；labels 永不发送给 harness。runner 应校验结构化响应、退出码和 ID 约束，并将协议/运行失败与相关性失败分开记录。
