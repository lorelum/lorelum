# Semantic index 命令

`lore index status/build/rebuild` 管理指定 LocalStore 的 semantic index。它们通过本地 Backend 使用已经加载的 embedding 模型；这一步只准备按语义检索所需的派生数据，**不会改变当前 `lore query` 的 keyword 行为**。

在当前 worktree 验收这组命令时，先按[开发指南的 normal workflow](../development/README.md#normal-development-workflow)选择源码或编译路径；不要用全局 `lore` 或其他 worktree 的 binary 验证当前改动。

模型与 Backend 是用户级资源，index 则属于 Store。`--store-root` 只选择目标 Store 及其 index，不会切换模型、模型缓存或 Backend 地址。

## 使用顺序

对包含 Practice 的 Store，先启动 Backend 并加载模型，再构建 index：

```sh
lore backend start
lore model load
lore --store-root /path/to/store index build
lore --store-root /path/to/store index status
```

空 Store 可以直接 `index build`；它不会请求或加载模型。`index build` 不会隐式启动 Backend、下载模型、加载模型，也不会在 Store 内容变化后自动重建。

`index build` 在 index 已经 ready 时不重复编码。index 过期时，它优先读取 LocalStore 的连续变更记录：新增或语义投影变化的 Practice 才会重新编码；删除和只影响 Store metadata 的变化不请求模型。变更历史缺失、index 不兼容或无法安全复用时，才回退到完整构建。

需要明确放弃已有 index 并强制完整重建时使用：

```sh
lore --store-root /path/to/store index rebuild
```

build/rebuild 被 Backend 接受后，CLI 会轮询到完成或失败，并只在最终状态输出 JSON envelope。CLI 中断或断开不会取消已接受的构建；Backend 会继续尝试完成这一次操作。v1 一次只构建一个 Store；其他 build/rebuild 会返回 `backend.busy`，不会排队。

## 状态

`lore index status` 不调用模型，只读取选中 Store 的 active index metadata：

| `state` | 含义 |
| --- | --- |
| `missing` | 还没有这个 Profile 的 semantic index。 |
| `ready` | index 与当前 Store snapshot 和固定 Profile 一致。 |
| `stale` | Store 内容已变，现有 index 尚未完整覆盖当前 Store；执行 `index build` 同步，必要时才用 `index rebuild` 强制完整重建。 |
| `incompatible` | index 格式、Profile 或完整性不再兼容；执行 `index rebuild`。 |

成功的 `index status` data 例如：

```json
{
  "state": "ready",
  "profileId": "<固定 Profile 的内部身份>",
  "vectorCount": 42
}
```

`profileId` 是 Engine 根据模型编码身份、向量维度和投影规则计算的 index 身份，不是 v1 的用户选择项。`vectorCount` 表示已写入 index 的 Practice 向量数；缺少或无法读取 index 时可以省略。

## 数据与恢复

semantic index 是 Store 的派生数据，位于：

```text
<store-root>/indexes/semantic/v1/<profileId>/active.sqlite
```

canonical Practice 仍在 LocalStore；index 不是正文事实来源。首次构建、强制 rebuild 或无法安全复用历史时会从完整 Store snapshot 建立 staging SQLite。正常增量 build 复制当前 active index，只替换变更记录影响的行并复用未变化向量。两条路径都校验后再原子替换 active index。构建期间 Store 发生变化、模型报错或进程退出时，不会把不完整结果标记为 ready，原来的 active index 也会保留。之后查看状态，并在需要时显式 `index build` 或 `index rebuild`。

## 常见错误

所有命令成功退出 `0`，可见错误退出 `2`，stdout 始终只输出一个 JSON envelope。调用方应按 `error.code` 处理。

| Code | 含义和处理 |
| --- | --- |
| `backend.unavailable` | 先执行 `lore backend start`。 |
| `embedding.not-loaded` | Store 非空但模型未就绪；先执行 `lore model load`。 |
| `embedding.busy`、`backend.busy` | Backend 正在处理模型或另一条 index build；等待后重试。 |
| `store.busy`、`store.recovery-required` | Store 正在变更或需要恢复；等待变更完成，或先修复 Store 后再重试。 |
| `embedding.failed`、`backend.failed` | 模型或构建失败；查看 `lore model status`，修复后显式 build，必要时 rebuild。 |

当前阶段不提供 semantic query、Hybrid、多个 Profile 或自动重建。这些功能会在 semantic index 的真实流程完成验收后另行推进。
