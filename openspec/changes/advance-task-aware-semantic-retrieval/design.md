# Design

## Context

动机见 [proposal.md](./proposal.md)。当前实现与本 Issue 相关的事实如下：

- `packages/engine/src/query/semantic/read.ts` 将请求的 `limit` 原样传给 reader；`packages/engine/src/query/semantic/index/reader.ts` 按该 limit 截断向量结果。因此现在候选宽度与用户最终 `top-k` 相同，尚无独立的最终排序空间。
- `packages/engine/src/query/semantic/query-service.ts` 在 query 期间协调候选选择、同一 Store snapshot 下的 canonical Practice 读取和结果组装，并可能因 Store 变化重试。
- `packages/engine/src/query/semantic/projection.ts` 当前把 frontmatter 与完整 Markdown body 拼为一个向量文本；具体是否改投射或排序策略要由 baseline 结果决定。
- 探索草案 `docs/research/task-aware-retrieval-evolution.md` 记录了目标 review Practice 已被召回但排名靠后的一次观察。它是研究材料，不是已接受的产品合同。

## Goals / Non-Goals

**Goals:**

- 在最终排序前保留独立的候选集合宽度 `N`，最终仅输出至多 `K` 个结果。
- 让 benchmark harness 对同一次检索分别看到候选集合与正常排序结果，从而判断漏召回还是错排序。
- harness 不依赖用户 CLI 调试输出，不要求 benchmark checkout import Engine 私有源码，也不扩大公开产品面。
- 在 baseline 阶段只拆分 N/K、保持旧排序行为；harness 与 scorer 校验通过并冻结 baseline 后，才改进召回/排序。
- 使用现有 CLI 对已授权隔离 Store 做一次独立正常查询，并只在终端观察其结果 IDs；不得把它误称为 harness 的同次候选 trace。

**Non-Goals:**

- 不把 `limit=K` 的旧 top-k 输出重命名成候选名单；`N` 必须是独立的候选生成边界。
- 不将 harness 做成普通 CLI 命令、包公开 export、产品 API 或用户可见诊断。
- 不增加 `--explain`、新 CLI flag、产品 protocol field、诊断子命令或其它 CLI 功能。
- 不把 gold labels、完整 query 集或 Knowledge-Pack 内容复制进主仓库。
- 不引入 query analyzer、Hybrid、ANN、新 embedding 模型或专用 reranker，除非当前审核案例的结果证明有必要并另行完成设计对齐。

## Decisions

### 1. 先分开 N 与 K，再接 harness

`N` 是经过必要有效性与 snapshot 校验、能够进入最终排序的候选宽度；`K` 是正常结果数量。Engine 先收集至多 N 个有效候选，再执行原有排序并截取前 K 个。候选不足 N 时返回实际有效候选；评测用例选择 `N > K`。第一步只拆开边界，不改变旧排序行为，回归测试需确认相同输入的旧最终结果仍保持一致。

不能将旧 `limit=K` 的输出改名为 `candidateIds`，因为这样无法观察被旧 K 截断的候选。

### 2. harness 是固定 checkout 内的本地测试程序

benchmark runner 在锁定 commit 的 Lorelum checkout 中启动仓库自带 harness。调用协议为 stdin 请求 / stdout 单个结构化结果，不是 `lore` CLI 命令：

```text
request:
  query
  fixed Store/Pack input
  embedding Profile
  candidate width N
  final limit K
  (no gold labels)

success response:
  status: success
  candidateIds: [distinct Practice IDs]
  finalIds: [ordered distinct Practice IDs, length <= K]

failure response:
  status: failure
  error: stable, non-content error code
  (no ID lists)
```

成功响应只包含结构化状态、`candidateIds` 和有序 `finalIds`。不增加 response protocol version 字段；harness protocol version 由固定 checkout 对应的内部协议定义/runner provenance 固定。输出不包含 query、Practice 正文、相似度或内部 score。

### 3. 候选 trace 必须属于同一次 Engine retrieval

候选观察点位于候选完成必要 canonical 有效性和 snapshot 检查、即将交给最终排序之时；`candidateIds` 只记录实际进入排序的 distinct Practice IDs。`finalIds` 是同一次检索中正常排序后的前 K 个 ID，必须 distinct，且属于 `candidateIds`。N/K 语义、观测点和失败/成功结构由本仓库计划明确；Engine 自行选择最小内部接线方式，不扩展公开 exports 或产品 API。

候选收集、最终排序与 ID 组装必须在同一 query attempt/snapshot 内完成。若 Store 变化触发 retry，丢弃前一 attempt 的名单；最终成功只返回该成功 attempt 的两份 ID 名单，若最终失败则不返回部分名单。benchmark runner 在进程外持有 gold labels，比对 harness 结果；请求中不得带标签。

### 4. 正常 CLI 观察是单独的验证，不是 harness trace

使用现有正常 `lore query` 命令和已允许的 query/Store 配置，在明确标记为 test-owned 的隔离 worktree/Store 上执行已授权查询。只在终端观察/记录 CLI 实际返回的 Practice IDs；不新增 flag、诊断输出、protocol field 或命令。

这是独立的一次 CLI 调用，不得假设其与 harness 的 `candidateIds` / `finalIds` 来自同一次检索、同一 attempt 或同一原子 snapshot trace，也不得用它单独判断 candidate recall。隔离 worktree/Store/临时日志属于 test-owned 产物；验证记录标注其身份，合并前清理。不得将共享工作区或原有未跟踪研究稿标成 test-owned 或清理。

### 5. 先验证并冻结 baseline，再改排序

依赖顺序为：

```text
N/K boundary (old ranking preserved)
  → harness protocol and same-attempt candidate trace
  → benchmark validates output and scorer
  → run/freeze baseline and raw per-case results
  → change ranking/retrieval
  → compare with every other input/config held constant
```

baseline 固定 Pack/cases/Profile/N/K/environment 和 Lorelum baseline commit。冻结前须核验候选/最终名单有效、逐例 scorer 可重放；运行或协议错误（失败状态、输出不完整、重复 ID、final ID 不属于 candidate IDs）不得计为相关性失败。后续对比只更换预先声明的 Lorelum build，其余条件保持一致。

### 6. 保持 canonical 与索引兼容边界

最终排序内容来自已通过 snapshot 检查的 canonical Practice；候选索引始终是派生状态。Store query 与 content-addressed ProjectContext query 共用同一 Engine 候选/排序规则。若所选排序仅使用当前 canonical 内容且不改变持久化表示，不升级 index schema/Profile；只有持久化 view/projection/chunk 改变时才按现有 staging、snapshot fence、atomic publication 路径迁移。

## Risks / Trade-offs

- **把旧 top-k 冒称为候选名单** → 先实现和验证 N/K 独立边界，再连接 harness。
- **重试导致候选/最终结果来自不同 snapshot** → 在同一 query attempt 捕获两份名单；snapshot retry 丢弃前次诊断并测试。
- **协议错误被记成召回/排序失败** → benchmark scorer 将失败状态、名单重复、不完整输出和 final 不属于 candidate 归为运行/协议错误。
- **CLI 观察与 harness trace 被误当成同一请求** → 将 CLI IDs 记录为独立产品路径观察；只有 harness 响应用于 candidate-vs-final 归因。
- **诊断意外扩大 CLI/公开 API** → 候选名单只由本地测试 harness 暴露；CLI 只运行现有正常路径。
- **测试私有数据或工件留在提交中** → 隔离 worktree/Store 明确标记 test-owned，并列入 merge 前清理验证。
- **先建复杂 reranker 后发现是召回问题** → 冻结 baseline 后按逐例归因选择算法。

## Migration Plan

1. 明确产品内部 `N` 与用户 `K` 的独立语义，拆分 Engine 候选截断与最终输出截断；保持并验证原排序结果不变。
2. 定义本地 harness 请求/响应、启动入口和协议版本；在 Engine 同一次 query/snapshot 生命周期中接出候选和最终 ID 名单。
3. 增加 stdin/stdout harness；校验 IDs 唯一、final IDs 属于 candidate IDs、失败不返回部分名单，retry 丢弃失败尝试结果。
4. benchmark runner 在固定 Lorelum commit 中运行所有固定案例；先校验协议和 scorer，再冻结 baseline 版本及原始逐例结果。
5. 另行在 test-owned 隔离 worktree/Store 中运行一次现有正常 CLI query，在终端观察返回 IDs；不与 harness 名单合并为一次 trace，并在 merge 前清除 test-owned 产物。
6. baseline 冻结后，按逐例召回/最终排序分类选最小任务感知改动；后续比较仅更换 Lorelum build，保持其它输入和配置固定。
7. 若排序/投射改变持久化表示才迁移 Profile/index；随后运行 Engine 及相关 package tests、typecheck、lint。

## Open Questions

benchmark 仓库的关联 Issue/OpenSpec、案例 schema 和记录契约由其实施计划处理；本 change 仅定义主仓库的 harness 依赖边界。若 benchmark 无法固定有效的 Pack/Store 或 checkout identity，先暂停正式 baseline，不退回读取用户 Store。
