# Proposal

## Why

Issue #236 的已知实例中，帮助完成提交前 review 的 Practice 已经出现在语义检索结果中，却排在 Registry/Pack 发布、安装验证等背景相关 Practice 后面。当前首要问题是“找到了但排得太低”；语料增长后也可能出现“正确 Practice 没进候选”，两者必须能够分别测量，不能混为一个失败原因。

## What Changes

- 让 semantic retrieval 优先匹配当前任务和阶段，再考虑对象、约束及领域背景。
- 在 Engine 内先明确分离候选宽度 `N` 与最终结果数 `K`，保持原有排序；候选先通过有效性与 snapshot 检查，再进入最终排序，不能先按 `K` 截断。
- 然后增加一个只在固定 Lorelum checkout 中运行的本地 benchmark harness。benchmark runner 通过 stdin 提供 query、固定 Store/Pack、embedding Profile、`N` 和 `K`，不传 gold labels；harness 在一次检索中返回 `candidateIds`、有序 `finalIds` 和明确状态。
- 保证 harness 的两份 ID 名单来自同一次检索和同一 snapshot；检索重试时丢弃失败尝试的名单。候选与最终名单不得重复，且最终名单必须来自候选集合。输出不含 query、正文、相似度或内部打分。
- benchmark 侧先验证 harness 输出和逐例判分，再固定 baseline 版本及原始结果；baseline 固定后才开始本仓库的排序改进，并在相同评测条件下对比。
- 另行使用现有 CLI 与已授权的隔离私有 Store 执行正常 `lore query`，在终端观察其实际返回的 IDs。该观察与 harness 是分开的调用，不充当同一次检索的候选 trace。
- harness 不作为用户 CLI 命令、不进入包的公开 exports，也不改变产品 API；不新增 CLI flags 或诊断输出。完整评测案例和 gold labels 不复制到 Core 测试语料。

本提案引入 semantic mode 的任务优先排序行为，但不新增用户参数、Practice 正文格式、用户手填结构化 query 或公开诊断合同。多视角 embedding、body chunk、Hybrid、ANN、新模型和完整 Query analyzer 都不是预先承诺的实现要求。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `retrieval-query`: semantic 结果优先服务当前任务与阶段；内部候选宽度和最终 `top-k` 分离，同时保持现有 canonical summary、coverage、envelope 与失败语义。
- `semantic-index`: 仅当经评测选中的实现改变持久化语义表示时，Profile/索引才需演进；旧表示不得被误认为新表示兼容。

## Impact

- **Engine:** `packages/engine/src/query/semantic/` 的候选宽度、候选有效性/snapshot 边界与最终排序；在 Engine 内部提供候选名单给本地 harness 的受控路径。
- **本地评测 harness:** 在固定 checkout 内用 stdin/stdout 运行，不使用 benchmark 仓库跨仓库 import Engine 私有源码。
- **Benchmark:** 外部 runner 固定 Lorelum checkout 和评测输入，通过 harness 收集候选与最终名单；gold labels 仅由 benchmark 进程持有，并冻结 baseline 版本及原始结果。
- **CLI 验证:** 仅使用现有正常 `lore query` 和已允许的配置，在明确标记为 test-owned 的隔离 worktree/Store 中观察终端 IDs；不增加 CLI 功能。
- **Backend:** 除非评测后选中的排序方案确实要求新 runtime 能力，否则不改变 Backend 生命周期。
