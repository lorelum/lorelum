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

## Derived cache 路由

请求里的 `storeRoot` 只选择 canonical Store 语料；derived semantic artifact 的位置永远来自 benchmark 进程环境变量，而不是 Store root：

| 环境 | 行为 |
| --- | --- |
| 设置了 `LORELUM_BENCHMARK_CACHE_ROOT=<absolute cache root>` | 从该路径下的 content-addressed cache 打开 artifact，即 Store-only `lore index build --cache-root <same root>` 为同一语料和 Profile 发布的那一个文件。 |
| 未设置或为空 | 回退 `defaultQueryArtifactCacheRoot()`；该值不进入 stdin，因此五个请求字段保持不变。 |
| 设置了非绝对路径 | 作为运行环境失败处理，不回退默认 cache。 |

harness 先从选定 Store root 读取一次 canonical corpus（Practice 内容 digest 决定 artifact identity），再用同一个 corpus 打开 content-addressed artifact。因此 Store 与 artifact 不匹配、artifact 缺失或属于其他 Profile/语料时，都只会得到结构化失败，不会回退读取 Store-local `indexes/semantic/...`，也不会构建、修复或迁移索引。

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

退出码与 `status` 的对应关系是 benchmark runner 判定“有效检索结果”与“运行/协议失败”的唯一依据：

| 退出码 | stdout | 含义 |
| --- | --- | --- |
| `0` | `{"status":"ok",...}` | 一次完成的检索；`candidateIds`、`finalIds` 都来自同一次 attempt 和 snapshot。 |
| 非零 | `{"status":"error","errorCode":...}` | 没有可评分的检索结果；不带任何部分名单。 |

`invalid_request` 只描述 stdin 请求本身（非法 JSON、未知字段、非法 N/K、非法 query 文本或超限输入）。`profile_mismatch` 是请求 Profile 与本地 runtime Profile 不一致；`runtime_unavailable` 是模型、native runtime 或 benchmark 进程环境（含非法 `LORELUM_BENCHMARK_CACHE_ROOT`）不可用；`index_unavailable` 是 content-addressed artifact 缺失、不兼容或不属于该 Store/Profile；`store_busy` 是 Store snapshot 在重试期间持续变化。这些都是运行/协议问题，benchmark 侧不得记为召回或排序失败。

## 名单语义

- `candidateIds` 按 Engine 当前 semantic reader 的候选顺序排列。仅当候选完成 canonical Practice 校验和 Store snapshot 检查后才可返回。
- `finalIds` 是同一次 Engine 检索中当前正常排序的前 `K` 个 ID。第一阶段只拆开 `N`/`K`，不引入新的排序策略；普通 `lore query` 的结果 envelope 不变。
- 两份名单来自同一个成功 query attempt 和 snapshot。若 Store 变化触发 retry，前一 attempt 的名单丢弃；最终失败不能返回部分候选结果。
- `candidateIds` 与 `finalIds` 都必须无重复；`finalIds` 必须是 `candidateIds` 的子集且长度不超过 `K`，不要求是它的前缀。违反协议的结果属于 `invalid_result`，不能作为召回或排序错误评分。

benchmark runner 在进程外读取 gold labels 并评分；labels 永不发送给 harness。runner 应校验结构化响应、退出码和 ID 约束，并将协议/运行失败与相关性失败分开记录。

## 第一轮排序记录的解释限制

`63ec664` 至 `8e97b00` 的实现将重排后的数组作为 candidateIds，排序前观察点没有保持。其历史结果仍可用于判断候选集合命中与 final 排名，但 candidateIds 的位置不能解释为 reader 原始召回名次。后续修复恢复本协议既有 reader 顺序，不升级五字段请求或响应结构，也不改写历史记录。

恢复观察点后的实现先校验全部候选的 canonical digest，再保存 reader 顺序，随后重排。辅助词面评分的 FTS 能力失败使用既有 `retrieval_failed`，不返回另一套隐藏排序或部分名单；普通查询仍沿用既有错误 envelope。
