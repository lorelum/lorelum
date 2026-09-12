# Semantic index 增量 build

状态：已在当前工作树实现，随 [Issue #111](https://github.com/lorelum/lorelum/issues/111) 评审；尚未发布。日期：2026-09-12。

## 当前阶段

本阶段只交付 semantic index 的可靠构建与增量同步，不交付 semantic query，也不改变 `lore query` 的默认 keyword 行为。

已交付的行为：

- `index build` 在兼容且过期的 index 上读取连续 revision history，只编码新增或 document projection 发生变化的 Practice。
- 删除的 Practice 不调用模型；只改变非 projection 内容的 Practice 复用旧向量并更新 binding digest。
- `index rebuild` 始终从完整 Store snapshot 全量构建。
- 历史缺失、断裂、恢复、Profile/root 不兼容或 active 损坏时，安全回退到全量构建。
- 构建先写 staging SQLite，完成完整校验后，在短暂 Store snapshot fence 内原子替换 active index。
- 构建期间不锁住 Store；发布失败保留旧 active 和 canonical Store。

本阶段仍要求用户显式启动 Backend、加载模型并执行 `index build`。安装、升级、卸载不会自动启动 Backend、加载模型或构建 index。

## 现有调用链与边界

当前调用链为：`CLI index command → Backend client → Backend index operation → Engine SemanticIndexService`。Backend 只负责运行期 operation、模型适配和错误映射；Engine 负责 Store snapshot、增量判断、SQLite、向量校验和原子发布。

Engine 不依赖 Backend、CLI 或模型运行时；Backend 不重新实现 Store、index schema 或 ranking 规则；CLI 不直接构造 Engine semantic service。

模型配置和 Backend runtime 是用户级资源；semantic index 属于各自的 `--store-root`。index 是派生数据，canonical Practice 仍以 LocalStore 为准。

## 增量构建流程

假设 active index 的 checkpoint 为 S0，Store 经过多次 mutation 到 S3：

1. Engine 在 index writer lock 下重新读取 active 和当前 Store identity。
2. 若 active 兼容且 retained revision history 从 checkpoint 到当前连续，则读取最终 affected Practice；同一 Practice 多次变更只处理最终状态。
3. 删除的 ID 从 staging 中移除；projection digest 未变化的旧向量复用；新增或 projection 变化的 Practice 才调用 embedding provider。
4. 复制 active 到 staging，在一个 SQLite 事务中更新向量行、binding digest、checkpoint 和完整 metadata。
5. 关闭并验证 staging，包括 SQLite integrity、Practice ID/digest 集合、Profile 身份、向量维度、有限值和 L2 合同。
6. 在 Store snapshot fence 内再次核对目标 identity，随后以同目录 rename 原子替换 active。

source-only 变化和纯删除不需要调用模型，但仍需更新完整 Store metadata。发布后 Store 可以继续变化；下一次 `status` 会据此报告 `stale`。

## 恢复和失败语义

LocalStore 是 revision history 连续性的唯一来源。读取不到连续 history 时，Engine 不猜测可复用范围，直接走一次全量路径。`reindex()` 清空 retained revision log，使恢复后的旧 checkpoint 无法伪装成普通连续增量。

下列情况均保留旧 active，不修改 canonical Store：

- embedding 未加载、忙、返回非法向量或失败；
- staging 写入、完整校验或发布 fence 失败；
- Store 在编码期间变化；
- Backend 在发布前退出。

进程中断留下的 staging 不是恢复输入。下一次显式 `index build` 会重新判断增量或全量；需要强制放弃现有 active 时使用 `index rebuild`。

## 文件与模块责任

```text
packages/engine/src/query/semantic/index/
  service.ts       # 选择 no-op、增量或全量并协调发布
  incremental.ts   # 合并 affected IDs，决定删除、复用或编码
  database.ts      # staging、SQLite 事务、metadata 和向量校验
  metadata.ts      # Profile、Store identity 和兼容性
packages/backend/src/modules/index/
  operation-service.ts  # operation、busy 和错误映射
packages/cli/src/index/
  index-commands.ts     # 参数、client、轮询和 JSON envelope
```

`withSnapshotFence` 只允许执行已验证文件的单次原子发布，不承载编码或长事务。锁顺序固定为 index writer → Store fence；Store mutation 不获取 index writer。

## CLI 合同

```sh
lore index status
lore index build
lore index rebuild
```

- `status` 返回 `missing`、`ready`、`stale` 或 `incompatible`，不调用模型。
- `build` 优先增量；不能安全复用时全量构建；ready 时不重复编码。
- `rebuild` 强制全量构建并原子替换 active。
- Backend 一次只接受一个 build/rebuild；不会排队。

当前阶段的真实 CLI 验收直接运行当前 worktree 的源码入口：

```sh
bun packages/cli/src/main.ts --store-root /path/to/store index build
```

验证时默认使用隔离 Store，直接运行当前 worktree 的源码入口，不使用全局 `lore` 或其他 worktree 的 binary。

## 验收范围

必须覆盖：首次 build、ready no-op、单条新增/修改/删除、多次 mutation 合并、projection 未变时复用、历史缺口全量恢复、reindex 恢复边界、Profile/root 隔离、active 损坏、Store 变化、fence TOCTOU、Backend busy 和进程中断。

增量结果必须与同一最终 Store 的强制全量结果在 Practice ID、digest、metadata 和确定性 mock vector 上一致。真实 CLI 验收使用隔离 Store，并运行受影响测试、typecheck、lint、定向 format check 和 `git diff --check`。

## 明确延后

- semantic query、默认 query 路由、partial coverage：下一阶段设计和实现。
- Backend 按需启动与仅本地模型加载：见 [Issue #114](https://github.com/lorelum/lorelum/issues/114)。
- Pack mutation 后的自动 index 同步、共享运行时协调和持久任务队列：见 [Issue #115](https://github.com/lorelum/lorelum/issues/115)。
- embedding 质量 benchmark、模型比较和多 Profile：见 [Issue #85](https://github.com/lorelum/lorelum/issues/85)。

这些事项不属于 #111 的验收，也不在本文预先定义实现合同。
