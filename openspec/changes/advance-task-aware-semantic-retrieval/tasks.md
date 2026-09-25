# Tasks

## 1. N/K 边界与本地 harness

- [x] 1.1 在 Engine semantic query 中定义独立候选宽度 `N` 与最终结果数量 `K`；先只拆分候选截断和最终截断，保持当前排序顺序不变。通过 Engine query tests 验证 `N > K` 时排序前候选可超过 K、最终结果仍至多 K，且 Store/ProjectContext 两条路径都使用同一边界；相同输入的旧 final K 结果须符合旧排序行为。
- [x] 1.2 固定主仓库 harness request/response 和协议版本：stdin 请求含 query、固定 Store/Pack、embedding Profile、N、K 且无 labels；成功 stdout 只含状态、`candidateIds`、有序 `finalIds`，失败有明确状态/稳定错误码且不带 ID 名单；protocol version 由锁定 checkout 和 benchmark provenance 绑定，不增加公开产品协议字段。
- [x] 1.3 在 Engine 内确定候选已通过必要 canonical 有效性与 snapshot 检查、即将进入最终排序的观察点；保证两份 ID 名单来自同一次检索和同一 snapshot。通过 Engine tests 验证 candidate IDs 唯一、final IDs 唯一、final IDs 属于 candidate IDs 且数量不超过 K。
- [x] 1.4 实现固定 checkout 内的 stdin/stdout benchmark harness，并通过 Engine tests 验证有效/非法请求、成功/失败结构、无 labels 输入和不输出正文/query/相似度/score；测试不得读取开发者 Store。
- [x] 1.5 为 Store snapshot 变化/重试增加回归测试：失败 attempt 收集的 candidate IDs 必须丢弃；最终成功时两份名单来自同一个成功 attempt，最终失败时不返回任何部分名单。
- [x] 1.6 修正 harness 的 semantic index 路由：从 benchmark 专用 `LORELUM_BENCHMARK_CACHE_ROOT`（未设置时 `defaultQueryArtifactCacheRoot()`）打开与 Store-only `lore index build --cache-root` 相同的 content-addressed artifact，不再把请求里的 `storeRoot` 当作 index root；测试覆盖该 env 路由、默认回退、缺失/异源/跨 Profile artifact 的结构化失败与绝不回退 Store-local index，同时保持五字段 stdin、N/K 与 snapshot 语义、普通 `lore query` 输出和公开 exports 不变。

## 2. 校验并冻结改动前 baseline

- [ ] 2.1 benchmark runner 在锁定 Lorelum baseline commit、固定案例/Pack/Profile/N/K/environment 下运行完整案例集；核验 checkout identity 和固定输入 digest，并以固定 harness protocol 启动请求。
- [ ] 2.2 benchmark 侧先验证 harness 输出和 scorer：失败、结构不完整、重复 ID、final ID 不属于 candidate IDs 等均记为运行/协议问题，不归为相关性失败；验证逐例 scorer 后再冻结 baseline version 与原始结果。
- [ ] 2.3 对审核案例逐一记录 core 是否进入候选、final 名次、scope error 和计划分母；冻结 baseline revision、逐例名单、判分、Provenance 和必要 hash。将复现命令、摘要与限制写入 `verification.md`。本任务完成前不得开始排序算法改动。
- [ ] 2.4 在单独标记为 test-owned 的隔离 worktree/Store 中，使用现有正常 `lore query` 与已授权 query/Store 配置做独立 CLI 观察；只在终端记录 CLI 返回的 Practice IDs，不增加 flag/诊断/protocol。明确其不是 harness 同次请求的原子 trace；验证后、合并前删除该 worktree、Store 和临时日志，并在记录中注明清理完成。
- [ ] 2.5 根据已冻结 baseline 将失败归为召回、排序或混合问题，提出最小实现方案并与维护者讨论；任何需要改变产品合同、额外 runtime 或 scope 的方案，先更新 proposal/design/specs/tasks 并运行 strict validation，再开始该部分实现。

## 3. 基于证据改进检索

- [ ] 3.1 基于 2.5 确认的证据实现任务/阶段优先排序；用小型受控 embedding fixtures 覆盖 review-vs-domain 冲突、相邻阶段、直接有用的领域补充、同 Practice 去重与 deterministic tie-break。
- [ ] 3.2 若冻结 baseline 显示当前审核案例存在召回失败，按确认方案只增加有证据必要的候选表示/来源并验证 core recall；若仅是语料未来增长的推测，不纳入本次实现。
- [ ] 3.3 使用同一 benchmark revision 对比改动前后；仅更换预先声明的 Lorelum build，保持 Pack、query、标签、Profile、N/K、scorer 和环境不变。用逐例变化分别报告召回失败、排序失败和 scope error，不以单个总分替代。
- [ ] 3.4 验证 Store query 与 content-addressed ProjectContext query 共用排序规则、同一 snapshot canonical assembly；通过 Engine tests 覆盖两条路径。

## 4. 索引/runtime 与交付验证

- [ ] 4.1 若实际实现改变持久化 projection/view/chunk，更新 Profile/index compatibility identity 和必要 migration；验证旧 Profile 不会被当成新格式 ready、staging failure 保留旧 active artifact。若不改变持久化表示，记录无需迁移的依据。
- [ ] 4.2 仅当评测选中的机制要求额外模型/runtime 能力时，更新相关 Backend/capability design 后实现；否则保持 Backend 生命周期不变并验证既有 semantic operation tests。
- [ ] 4.3 运行 `bun test packages/engine`、受影响的 Backend/CLI tests、`bun run typecheck`、`bun run lint`、`bun run fmt:check` 和 `openspec validate advance-task-aware-semantic-retrieval --strict`；将命令、结果、成本和限制写入 `verification.md`。
- [ ] 4.4 审阅完整 diff，确认 harness 不在 CLI、包公开 exports 或产品 API 中，gold labels/完整 benchmark corpus 不在主仓库；确认 test-owned worktree/Store/日志已清理，且未改动工作区已有未跟踪研究资料。
