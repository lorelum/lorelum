# Tasks

## 跨设备交接：先分析再实施（2026-09-26）

本节保存维护者确认的下一轮范围，不是新排序实现授权。下方历史勾选和 verification.md 的结论仍需核实，不能认定 #236 已全部完成。

### 固定版本和结果

- 主仓库 `lorelum/lorelum`，分支 `codex/advance-task-aware-semantic-retrieval`。开始前核实 HEAD、工作区和远端，不 rebase 或合并无关提交。
- baseline：`caecc53694d3162bd145e30f3bc5628ee6902b0c`。
- 第一轮排序：`09e64be914dc93124230f06483c8dfc4c164a61a`；代码提交为 `63ec6640fd5c52e3130b51fd30cc5db9175e4b98`。
- benchmark `retrieval-ranking/v2`，50 query、4 Pack / 97 Practice，N=20、K=5，harness protocol v1。
- Profile：`72c7404af9d533dce3dd5f5e62987fcb225ffdfd180ae2951879d3a54044c2a5`。
- 维护者转交的 benchmark 结果：core candidate recall 49/50 → 49/50；core final top-5 42/50 → 48/50；candidate miss 1 → 1；final-ranking miss 7 → 1；明确 forbidden 进入前五的案例 2 → 2。candidate/replay 全部成功，逐例一致。
- 原有 42 条前五命中没有丢失，但部分名次下降。不能写“没有任何退步”或“scope error 已解决”。

### 新设备证据入口

先读适用 AGENTS.md、当前工作流（若存在 CHANGE_WORKFLOW 则读取）和本 change。下述相对路径在新设备自己的 checkout 内解析。

主仓库重点：`packages/engine/src/query/semantic/task-relevance.ts`、`query-service.ts`（同目录）、`packages/engine/src/query/artifacts/semantic.ts`、`packages/backend/src/benchmark/semantic-index-routing.ts`、`docs/development/semantic-retrieval-benchmark-harness.md`，以及本 change 的 design/specs/tasks/verification。

benchmark 仓库 `lorelum/lorelum-benchmark`，分支 `codex/retrieval-ranking-benchmark`，交接时报告 HEAD `0ff6d2dbfd2e22a10eab3eb9b6b246f1d207abff`，关联 Draft PR #223。只读其 `openspec/changes/retrieval-ranking-benchmark/verification.md`、`results/records/`。逐例 artifacts 在 `artifacts/retrieval-ranking/`，被 Git 忽略，record 保存路径与 hash；新设备不能假定它们随 Git 到达。缺失时报告并请求按 hash 传递，不重跑来替代原始记录。上述摘要可作为分析起点。

已有 `docs/research/task-aware-retrieval-evolution.md` 是研究资料，之前未跟踪。不要覆盖、删除或顺手提交，也不把它当成已批准合同。

### 先核实实现边界

1. 候选观察点：上一轮将 `semanticCandidateIds(candidates)` 改为 `semanticCandidateIds(orderedCandidates)`，部分测试改为 finalIds 是 candidateIds 的前缀。原约定是 canonical 和 snapshot 校验通过后、最终排序前观察。核实是显式换名单还是原地排序污染，确认 digest 校验实际时机。不得把返回位置直接称作原始召回名次。先说明修正和兼容影响，不增加字段或升级协议。
2. 公开类型：`SemanticQueryDependencies` 新增 `taskSignal?`，核实是否经 barrel 公开导出。不能因为未改 index.ts 就声称公开 API 未变。
3. 错误语义：FTS5 不可用时是否静默恢复纯语义顺序，是否符合合同、造成环境间不可见的排序差异？先提建议，不扩大诊断接口。
4. 核实 `similarity + 0.05 × taskStrength`、候选池内 BM25 归一化及字段权重。词面匹配不等于任务/阶段识别，较高字段权重不保证领域词不会占优势。

### 未解决的问题

- 排序：`agentic-limit-investigation`，query 为 “I keep following references into more files, but I cannot name the decision each file will change.”；core `agentic-coding.implementation.limit-investigation-to-current-decision`。两版均召回但未进前五，返回 candidateIds 位置 6 → 11。先核实名单语义；decision 等词让 Pack 类加分只是待验证假设。
- 召回：`agentic-acceptance-direct`，core `agentic-coding.requirements.define-acceptance-and-non-goals`，两版均未进候选。池内重排不能找回池外 Practice。撤回“修复必然需要改变持久化投射/Profile”的未经证明断言；比较候选来源和表示方案再决定。新增候选来源不必然改变 embedding Profile，被测配置变化也不等于题库 revision 必须变化。确需不同 Profile 时先协调兼容和对照边界。
- Scope：`issue-pr-body-scope-conflict` 的 core final #1，forbidden `react.server.request-dedup-cache` #2；`issue-pr-readback-pack-context` 的 core #2，forbidden `pack-creator.release.preserve-versioned-content-and-provenance` #4。相对顺序改善不等于 forbidden 离开前五，不得一律过滤 React、Pack 或领域 Practice。

### 分析和实验纪律

同时检查剩余失败、修好的 6 条、名次下降案例和两条 scope error，解释原始相似度、BM25、归一化及最终排序的贡献。逐词/字段因果归因区分观测与推断。优先评估现有信号修正空间，证据说明不足后再考虑适用性重排或召回补充。

用小型合成 fixture 检查无词面重合、中英文、相邻阶段、领域冲突、直接有用的领域补充、稳定 tie-break 和 snapshot/retry。不写 case/Practice ID 或 query 特例，不扩大 N/K，不围绕一例调大 0.05。

上一轮在要求“不先重跑 benchmark”时读取完整 query/labels，进行了参数扫描及真实 Engine 重放。题集已参与方法选择，后来同题集重跑不是未见数据上的泛化验证；参数区间稳定也不能证明无过拟合。不得沿用旧交付的过度结论。

内部诊断可用主仓库测试或临时程序，不扩展 harness、CLI、公开 exports 或产品 API。额外执行冻结案例的实验先明确范围并确认，不自行重跑全套 benchmark。只读 benchmark 证据，不修改其 query、labels、scorer、corpus 或历史结果。

核查旧记录中“先设计/strict validation 后实现”、独立 CLI 观察、产物清理、测试/格式检查、任务勾选及 v1/v2 引用是否真实准确。先列出需更正项，不伪造完成，不把旧测试结果当新 build 结果。

### 下一份交付

先交付可讨论方案：问题及代码/实验依据；观测/合同错误与算法不足的区分；推荐修改层次和替代方案；对既有命中、跨语言、成本和失败路径的影响；固定对照和 benchmark 分工；未完成任务和应撤回/限定的旧结论。

当前只授权分析和方案整理。讨论确认后才实现、测试并交付新的可 fetch 固定 SHA；benchmark 再用新 run ID 独立对比。不要再次要求维护者决定“剩余失败是否接受”：方向是继续优化，但不能写测试特例。

## 本轮已确认的实施阶段

交接段保留原授权历史；其后维护者先批准 13 条有限诊断，再确认继续修复错误词匹配、候选池分差放大和候选观察点。具体机制见 design 第 8 节。当前不是 #236 已完成，也不授权主仓重跑完整 benchmark。

- [x] 5.1 恢复校验后、排序前的 candidateIds，收回公开 taskSignal 测试属性，明确 FTS 失败语义。
- [x] 5.2 仅修改请求期 semantic 词面投射与强度；技术复合词保持完整，以不同有效匹配词数的自然饱和约束相对 BM25，加分上限不变。
- [x] 5.3 用独立合成 fixture 验证误匹配、微差放大、字段信号、跨语言无重合、digest/retry 和两条查询路径；运行受影响检查。
- [ ] 5.4 审查 diff 与敏感信息后交付固定 build，并由 benchmark 确认可复现；本地验证见 verification §10，正式质量结论等待新 run。
- [ ] 5.5 继续验证召回补充和适用性判断；title+applies_when 单视角已试验并否决，未进入产品，任务/背景消歧的新方案仍需设计确认。

## 1. N/K 边界与本地 harness

- [x] 1.1 在 Engine semantic query 中定义独立候选宽度 `N` 与最终结果数量 `K`；先只拆分候选截断和最终截断，保持当前排序顺序不变。通过 Engine query tests 验证 `N > K` 时排序前候选可超过 K、最终结果仍至多 K，且 Store/ProjectContext 两条路径都使用同一边界；相同输入的旧 final K 结果须符合旧排序行为。
- [x] 1.2 固定主仓库 harness request/response 和协议版本：stdin 请求含 query、固定 Store/Pack、embedding Profile、N、K 且无 labels；成功 stdout 只含状态、`candidateIds`、有序 `finalIds`，失败有明确状态/稳定错误码且不带 ID 名单；protocol version 由锁定 checkout 和 benchmark provenance 绑定，不增加公开产品协议字段。
- [x] 1.3 在 Engine 内确定候选已通过必要 canonical 有效性与 snapshot 检查、即将进入最终排序的观察点；保证两份 ID 名单来自同一次检索和同一 snapshot。通过 Engine tests 验证 candidate IDs 唯一、final IDs 唯一、final IDs 属于 candidate IDs 且数量不超过 K。
- [x] 1.4 实现固定 checkout 内的 stdin/stdout benchmark harness，并通过 Engine tests 验证有效/非法请求、成功/失败结构、无 labels 输入和不输出正文/query/相似度/score；测试不得读取开发者 Store。
- [x] 1.5 为 Store snapshot 变化/重试增加回归测试：失败 attempt 收集的 candidate IDs 必须丢弃；最终成功时两份名单来自同一个成功 attempt，最终失败时不返回任何部分名单。
- [x] 1.6 修正 harness 的 semantic index 路由：从 benchmark 专用 `LORELUM_BENCHMARK_CACHE_ROOT`（未设置时 `defaultQueryArtifactCacheRoot()`）打开与 Store-only `lore index build --cache-root` 相同的 content-addressed artifact，不再把请求里的 `storeRoot` 当作 index root；测试覆盖该 env 路由、默认回退、缺失/异源/跨 Profile artifact 的结构化失败与绝不回退 Store-local index，同时保持五字段 stdin、N/K 与 snapshot 语义、普通 `lore query` 输出和公开 exports 不变。

## 2. 校验并冻结改动前 baseline

- [x] 2.1 benchmark runner 在锁定 Lorelum baseline commit、固定案例/Pack/Profile/N/K/environment 下运行完整案例集；核验 checkout identity 和固定输入 digest，并以固定 harness protocol 启动请求。（benchmark 侧在 `caecc53` 上完成；见其 `results/records/retrieval-ranking-v2-baseline-caecc53.json` 与 replay record。）
- [x] 2.2 benchmark 侧先验证 harness 输出和 scorer：失败、结构不完整、重复 ID、final ID 不属于 candidate IDs 等均记为运行/协议问题，不归为相关性失败；验证逐例 scorer 后再冻结 baseline version 与原始结果。（50 例全部 `status=ok`、failure_count 0，两次运行名单一致。）
- [x] 2.3 对审核案例逐一记录 core 是否进入候选、final 名次、scope error 和计划分母；冻结 baseline revision、逐例名单、判分、Provenance 和必要 hash。将复现命令、摘要与限制写入 `verification.md`。本任务完成前不得开始排序算法改动。（benchmark 侧 `verification.md` 冻结：core candidate recall 49/50、core final top-5 42/50、scope error 2。）
- [ ] 2.4 在单独标记为 test-owned 的隔离 worktree/Store 中，使用现有正常 `lore query` 与已授权 query/Store 配置做独立 CLI 观察；只在终端记录 CLI 返回的 Practice IDs，不增加 flag/诊断/protocol。明确其不是 harness 同次请求的原子 trace；验证后、合并前删除该 worktree、Store 和临时日志，并在记录中注明清理完成。（旧勾选撤回：当前证据不足以核实独立 CLI 调用及清理，不能以 harness 结果代替。）
- [x] 2.5 根据已冻结 baseline 将失败归为召回、排序或混合问题，提出最小实现方案并与维护者讨论；任何需要改变产品合同、额外 runtime 或 scope 的方案，先更新 proposal/design/specs/tasks 并运行 strict validation，再开始该部分实现。（归因：7 例排序失败 + 2 例 scope error + 1 例召回失败；第一轮方案见 design Decision 7，但旧执行先后顺序没有原始日志佐证；本轮确认与实施边界见 Decision 8。）

## 3. 基于证据改进检索

- [x] 3.1 基于 2.5 确认的证据实现任务/阶段优先排序；用小型受控 embedding fixtures 覆盖 review-vs-domain 冲突、相邻阶段、直接有用的领域补充、同 Practice 去重与 deterministic tie-break。（`packages/engine/src/query/semantic/task-relevance.ts` + `task-relevance.test.ts`；候选去重由既有 `semanticCandidateIds` 保证，重排保持无重复。）
- [ ] 3.2 若冻结 baseline 显示当前审核案例存在召回失败，按确认方案只增加有证据必要的候选表示/来源并验证 core recall；若仅是语料未来增长的推测，不纳入本次实现。（**未完成，且本次不实现**：唯一的召回失败 `agentic-acceptance-direct` 在 semantic reader 与任务信号下都不进 top-20 候选；池内重排无法找回。候选来源或查询侧处理不必然改变 Profile；需要单独验证，不以改变题库来掩盖被测配置变化。见 analysis.md。）
- [x] 3.3 使用同一 benchmark revision 对比改动前后；仅更换预先声明的 Lorelum build，保持 Pack、query、标签、Profile、N/K、scorer 和环境不变。用逐例变化分别报告召回失败、排序失败和 scope error，不以单个总分替代。（第一轮 09e64be 的 v2 baseline/candidate/replay 附件已按 hash 核实；新 build 的正式对照仍待 benchmark 新 run，不继承此勾选。）
- [x] 3.4 验证 Store query 与 content-addressed ProjectContext query 共用排序规则、同一 snapshot canonical assembly；通过 Engine tests 覆盖两条路径。（两条路径都经 `executeSemanticQuery`；`query-service.test.ts` 与 `artifacts/semantic.test.ts` 各覆盖一次。）

## 4. 索引/runtime 与交付验证

- [x] 4.1 若实际实现改变持久化 projection/view/chunk，更新 Profile/index compatibility identity 和必要 migration；验证旧 Profile 不会被当成新格式 ready、staging failure 保留旧 active artifact。若不改变持久化表示，记录无需迁移的依据。（不改：任务信号只在 query 期读取 canonical Practice 并在内存排序，`projectSemanticPractice`、index schema、`SEMANTIC_PROJECTION_VERSION` 与 Profile identity 均未变，冻结 Profile 仍可直接查询既有 artifact。）
- [ ] 4.2 仅当评测选中的机制要求额外模型/runtime 能力时，更新相关 Backend/capability design 后实现；否则保持 Backend 生命周期不变并验证既有 semantic operation tests。
- [ ] 4.3 运行 `bun test packages/engine`、受影响的 Backend/CLI tests、`bun run typecheck`、`bun run lint`、`bun run fmt:check` 和 `openspec validate advance-task-aware-semantic-retrieval --strict`；将命令、结果、成本和限制写入 `verification.md`。（见 §9；`fmt:check` 在本机 `core.autocrlf=true` 下对全部既有文件报错，改动文件 `oxfmt --check` 通过。）
- [ ] 4.4 审阅完整 diff，确认 harness 不在 CLI、包公开 exports 或产品 API 中，gold labels/完整 benchmark corpus 不在主仓库；确认 test-owned worktree/Store/日志已清理，且未改动工作区已有未跟踪研究资料。（旧公开类型未变的结论不成立；历史工件清理缺少证据。新实现的源码与产物卫生另见 §5，不把本轮审查当作旧清理证明。）
