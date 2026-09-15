# Semantic index 命令

当前可观察合同见 [semantic index OpenSpec](../../openspec/specs/semantic-index/spec.md)；本页说明 CLI 状态、命令和恢复操作。

`lore index status/build/rebuild` 管理选中 query context 的 semantic artifact：无 `.lorelum/` 时是 selected LocalStore，存在目录 layer 时是合并后的 ProjectContext。`build/rebuild` 会按需启动本地 Backend；实际需要 embedding 而固定模型缺失时，Backend 自动开始或加入下载，并在模型 ready 后继续同一条 index operation。`status` 保持只读且不启动服务。`lore query` 默认也会自动提交或加入同一 operation，`--mode keyword` 则保留独立的离线路径。

在当前 worktree 验收这组命令时，先按[开发指南的 normal workflow](../development/README.md#normal-development-workflow)选择源码或编译路径；不要用全局 `lore` 或其他 worktree 的 binary 验证当前改动。

模型与 Backend 是用户级资源，derived artifact 也位于用户级 cache。`--store-root` 只选择 Store 基础语料；`--cache-root` 只选择派生 cache；两者都不会切换模型、模型缓存或 Backend 地址。`--project-root` 选择包含 `.lorelum/` 的普通目录，`--no-project` 强制 Store-only。

## 使用顺序

第一次使用不需要手动准备模型：

```sh
lore --store-root /path/to/store index build
lore --store-root /path/to/store index status
```

空 Store 可以直接 `index build`；它会启动 Backend 来执行 Engine 用例，但不会请求或加载模型。对非空 Store，build/rebuild 会自动准备模型，但前台只短暂观察 operation。下载还在进行时，返回 `preparing` 或 `building` 加 operation ID；用 `lore index operation <operation-id>` 查看最终状态。它们不会因为 Store 内容变化自行启动。

`index build` 在 index 已经 ready 时不重复编码。index 过期时，它优先读取 LocalStore 的连续变更记录：新增或语义投影变化的 Practice 才会重新编码；删除和只影响 Store metadata 的变化不请求模型。变更历史缺失、index 不兼容或无法安全复用时，才回退到完整构建。

需要明确放弃已有 index 并强制完整重建时使用：

```sh
lore --store-root /path/to/store index rebuild
```

build/rebuild 被 Backend 接受后，CLI 最多观察约一秒。ready 时直接返回最终 index；仍在执行时返回 `queued`、`building` 或 `preparing`；已失败时按原错误 envelope 返回。Backend 在确定首轮缺少模型后，自动开始或加入 preparation，并在同一 operation ID 下继续一次 build/rebuild。进度写 stderr，例如 `backend: starting`、`index: building`、`model: downloading`。CLI 中断或断开不会取消已接受的构建；Backend 会继续尝试完成这一次 operation。相同内容寻址 artifact 的 build/query 会 join 同一 operation；不同 target 会返回可观察的 `queued` operation，而不是把正常并发调用变成 `backend.busy`。同一目录连续编辑只追赶最新 target。

```sh
lore --store-root /path/to/store index operation <operation-id>
```

`index operation` 只读取指定 operation，不会启动 Backend。daemon restart 后未完成 target 保留进度并进入 `waiting-for-source`；下一次同一 Store 或同一 `projectRootId` 的 query/build/rebuild 会 reattach 当前 source 并继续。journal 不保存项目绝对路径或 Practice 正文。

## 状态

`lore index status` 不调用模型，只读取选中 Store 的 active index metadata：

| `state` | 含义 |
| --- | --- |
| `missing` | 还没有这个 Profile 的 semantic index。 |
| `ready` | complete artifact 与当前 query context 和固定 Profile 一致。 |
| `indexing` | current target 已有可验证 progress；data 包含 operation ID 与已完成/总 Practice counts。 |
| `stale` | 未受 operation 管理的旧 progress 或 source 已变；执行 `index build` 同步，必要时才用 `index rebuild` 强制完整重建。 |
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

semantic artifact、progress 和 shared vector 都是可删除重建的用户级派生数据，默认位于：

```text
~/.lorelum/cache/
├── semantic/v1/vector-cache.sqlite
└── project-context/v1/
    ├── project-cache.sqlite
    └── artifacts/semantic/<artifact-id>/{progress.sqlite,active.sqlite}
```

canonical Practice 仍在 LocalStore 或项目 layer source；artifact 不是正文事实来源。每个 target 以有序 active `(practiceId, contentDigest, projectionDigest)` 清单和 Profile 识别，不包含 Git、worktree、路径、branch、commit 或 mtime。每个 batch 事务发布 queryable progress；complete artifact 通过 manifest、row count、vector contract 与 integrity 后原子替换 active。构建期间 source 变化、模型报错或进程退出时，不会把不完整结果标记为 ready，原来的 active artifact 也会保留。`lore cache status` 查看 cache，`lore cache prune` 显式删除未被 build/query lease 使用的派生状态；它们不修改项目 source 或 LocalStore。

## 常见错误

`status`、已 ready 的 build/rebuild 和被接受的 `preparing`/`building` operation 都退出 `0`；已确认失败退出 `2`。stdout 始终只输出一个 JSON envelope。调用方应按 `state` 或 `error.code` 处理。

| Code | 含义和处理 |
| --- | --- |
| `backend.*` | 自动启动未能安全完成，或 Backend 在操作中断开；检查 `lore backend ...`。 |
| `backend.operation-expired` | 该 operation 属于已经退出的 daemon；查看 `index status` 后按需重新 build。 |
| `embedding.*` | 自动准备被禁用、失败或无法继续；查看 `lore model status`，修复后用 `lore model load` 重试。 |
| `embedding.busy`、`backend.busy` | Backend 正在处理模型或另一条 index build；等待后重试。 |
| `store.busy`、`store.recovery-required` | Store 正在变更或需要恢复；等待变更完成，或先修复 Store 后再重试。 |
| `embedding.failed`、`backend.failed` | 模型或构建失败；查看 `lore model status`，修复后显式 build，必要时 rebuild。 |

## Pack 安装后的同步

`lore pack install` 在 canonical Pack commit 成功后，会对同一个 `--store-root` 提交普通 `index build`。在短观察期内 ready 时，`indexSync.state` 为 `ready`；下载或索引仍在继续时，它为 `pending`，并携带 operation ID 和 phase。它会复用 Engine 的 no-op 或增量规则，不会强制 rebuild。

若 Backend busy、自动下载失败或 index 发布失败，Pack 仍已安装，`pack install` 仍返回 `ok: true`，但 `data.indexSync.state` 是 `failed` 并给出稳定错误码和恢复提示。调用方依赖 semantic query 时必须检查 `ready`/`pending`/`failed`；显式 `index build` 可以在资源恢复后重试。若 daemon 重启后查询旧 operation ID，`lore index operation <operation-id>` 返回 `backend.operation-expired`；检查 `index status` 后按需重新 build。v1 不提供 Hybrid、多个 Profile、自动重建或 daemon 重启后的后台补偿。
