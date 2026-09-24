# Verification Plan

> 本文件记录 Lorelum 主仓库实现的验证方案；完整 query 集、gold labels 和正式 benchmark record 由关联 benchmark 工作流维护，不复制进 Core 测试目录。

## 1. Harness 协议与版本

benchmark runner 在固定 Lorelum checkout 中启动本地 harness，使用 stdin/stdout 传输。请求含固定评测输入，不含 gold labels：

```json
{
  "query": "...",
  "storeRoot": "absolute path to a test-owned Store",
  "embeddingProfileId": "fixed 64-character Profile ID",
  "candidateWidth": 20,
  "resultLimit": 5
}
```

成功只返回同一次检索的结构化状态、候选 IDs 和有序最终 IDs：

```json
{
  "status": "ok",
  "candidateIds": ["practice.a", "practice.b"],
  "finalIds": ["practice.a", "practice.b"]
}
```

失败返回 `{"status":"error","errorCode":"..."}`，不返回部分名单；成功进程退出码为 0，结构化失败进程退出码为非零。输出不得包含 query、正文、向量相似度或内部 score。harness protocol version 由锁定 checkout 对应的内部 schema/version 约定与 benchmark provenance 固定，不额外增加公开产品协议字段。此 harness 不是 `lore` CLI 子命令，不新增包公开 exports 或产品 API。

## 2. N 与 K 的边界验证

- Engine 在最终排序前收集至多 N 个通过必要有效性及 snapshot 检查的候选；正常最终排序最多返回 K 个 Practice summary。
- 对评测用例要求 `N > K`，并验证排序前候选名单实际可超过 K；不把旧 `limit=K` 的结果改名作为候选名单。
- 先仅分离 N/K 并保持现有相似度排序；回归测试确认相同输入下旧 final K 行为保持不变。
- 至少在 Store semantic query 与 content-addressed ProjectContext 两条路径验证边界一致。

## 3. Harness 的同次检索与 snapshot/retry

每个成功响应的 `candidateIds` 必须是候选校验后、即将交给最终排序的 distinct Practice ID；`finalIds` 必须是同次正常排序结果的前 K 项，均唯一且属于 `candidateIds`。Store snapshot identity 必须在同一 Engine query attempt 内一致。

并发 Store 变化导致 retry 时，丢弃之前 attempt 的候选名单；最终成功只返回成功 attempt 的 candidate/final IDs，所有 attempt 失败时只返回 failure，不附带任何旧名单。失败状态、输出不完整、重复 ID、`finalIds` 不属于 `candidateIds` 等由 benchmark 侧归为运行/协议问题，不得伪装成相关性失败。

## 4. 改动前 baseline 与冻结门槛

在任何排序策略改动前，固定并验证：

- Lorelum baseline commit/build 和对应 harness protocol version；
- 固定 query/case revision、Pack commit/digest、Store/index 状态和 embedding Profile；
- N、K、运行环境与 benchmark scorer revision；
- harness 每例输出与外部 scorer 的逐例判定、计划分母及原始结果 hash。

先核验候选/最终名单结构有效、scorer 可重复，再冻结 baseline revision 和原始逐例结果。后续对比只更换预先声明的 Lorelum build，其他输入和配置保持一致；分别报告召回失败、排序失败、scope error 的变化。

## 5. 独立的现有 CLI 观察

使用当前已授权 query 和**现有** `lore query`/Store 配置，在单独、明确标记为 `test-owned` 的隔离 worktree 和 Store 上运行正常 CLI。复用现有配置，不增加 `--explain`、新 flag、协议字段、诊断命令或任意 CLI 功能。在终端观察/记录 CLI 正常返回的 Practice IDs。

这是单独一次 CLI 调用：不得声称这些 IDs 与 harness 的 `candidateIds`/`finalIds` 来自同一检索、同一 attempt 或同一原子 snapshot trace；也不得用 CLI 的最终结果单独推断候选召回。验证记录将其标成“独立产品路径观察”，与 harness 逐例指标分开。

隔离 worktree、Store 与任何临时日志须标记为 test-owned；验证后、合并前全部删除。不得删除当前共享工作区中的原有研究文档或其它用户文件。

## 6. 隐私与复现

- benchmark runner 在进程外使用 gold labels；不得把标签放在 stdin、Store/Pack 输入、Engine query、harness 环境变量或被测进程可读文件中。
- 固定并记录 benchmark revision、Lorelum commit/build、Pack/Store digest、Profile、N/K、运行环境、scorer 与 harness protocol version。
- 主仓库 unit tests 使用临时 Store 和受控 EmbeddingPort；不得读开发者 Store、cache 或本机用户 Pack。
- 普通 CLI JSON/text、公开 package exports、Backend API 和 daemon journal 不增加候选诊断字段。

## 7. 指标与计划命令

| 项目 | 记录内容 | 解释 |
| --- | --- | --- |
| Candidate recall | core IDs 是否出现在 harness `candidateIds` | 判断“有没有找到” |
| Final ranking | core IDs 在 harness 有序 `finalIds` 中的位置 | 判断“找到后排得如何” |
| Independent CLI observation | 正常 CLI 返回的 IDs（终端观察） | 检查产品路径；不与 harness trace 合并归因 |
| Scope | 仅领域相似 Practice 是否压过 core | 判断主题相关是否冒充任务相关 |
| Supporting usefulness | 直接补充当前任务的 Practice 是否仍可入选 | 避免把领域结果一律过滤 |
| Cost | query latency、必要的 build/index cost | 评估方案代价，不从小样本外推生产容量 |
| Safety | snapshot/retry、canonical assembly、索引兼容、无 fallback、临时工件清理 | 确认检索改进未损害现行可靠性合同 |

```powershell
bun test packages/engine
bun test packages/backend
bun test packages/cli
bun run typecheck
bun run lint
bun run fmt:check
openspec validate advance-task-aware-semantic-retrieval --strict
```

本地 harness 的固定启动入口、请求字段和退出码约定见 [semantic retrieval benchmark harness](../../../docs/development/semantic-retrieval-benchmark-harness.md)。benchmark runner/scorer 的完整运行命令由 benchmark 仓库维护；本次单次 harness 冒烟不代表 baseline。CLI 观察仅使用现有正常命令及已授权的隔离 Store 配置。

## 8. 观察结果

全量 baseline 尚未运行。单次 harness 冒烟只验证进程协议与真实 runtime，不计入 baseline，也不填入下表。baseline 冻结后用下表记录；CLI 独立观察不得和 harness trace 混同。

| Date | Lorelum commit/build | Eval revision / corpus digest | Harness protocol/scorer | Profile | N/K | Candidate core present? | Baseline rank | Updated rank | CLI IDs observed separately? | Scope | Cost / limitations | Test-owned artifacts removed? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |
