# Tasks

## 跨设备交接：先分析再实施（2026-09-26）

本节保存维护者确认的下一轮范围，不是新排序实现授权。下方历史勾选和 verification.md 的结论仍需核实，不能认定 #236 已全部完成。

> 2026-09-27 更新：本节记录的是已被 §5 替代的 BM25 task-signal 分析阶段；`task-relevance.ts` 已删除，当前交付与验收以 §5 和 verification §10 为准。

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

## 1. N/K 边界与本地 harness

- [x] 1.1 在 Engine semantic query 中定义独立候选宽度 `N` 与最终结果数量 `K`；先只拆分候选截断和最终截断，保持当前排序顺序不变。通过 Engine query tests 验证 `N > K` 时排序前候选可超过 K、最终结果仍至多 K，且 Store/ProjectContext 两条路径都使用同一边界；相同输入的旧 final K 结果须符合旧排序行为。
- [x] 1.2 固定主仓库 harness request/response 和协议版本：stdin 请求含 query、固定 Store/Pack、embedding Profile、N、K 且无 labels；成功 stdout 只含状态、`candidateIds`、有序 `finalIds`，失败有明确状态/稳定错误码且不带 ID 名单；protocol version 由锁定 checkout 和 benchmark provenance 绑定，不增加公开产品协议字段。
- [x] 1.3 在 Engine 内确定候选已通过必要 canonical 有效性与 snapshot 检查、即将进入最终排序的观察点；保证两份 ID 名单来自同一次检索和同一 snapshot。通过 Engine tests 验证 candidate IDs 唯一、final IDs 唯一、final IDs 属于 candidate IDs 且数量不超过 K。
- [x] 1.4 实现固定 checkout 内的 stdin/stdout benchmark harness，并通过 Engine tests 验证有效/非法请求、成功/失败结构、无 labels 输入和不输出正文/query/相似度/score；测试不得读取开发者 Store。
- [x] 1.5 为 Store snapshot 变化/重试增加回归测试：失败 attempt 收集的 candidate IDs 必须丢弃；最终成功时两份名单来自同一个成功 attempt，最终失败时不返回任何部分名单。
- [x] 1.6 修正 harness 的 semantic index 路由：从 benchmark 专用 `LORELUM_BENCHMARK_CACHE_ROOT`（未设置时 `defaultQueryArtifactCacheRoot()`）打开与 Store-only `lore index build --cache-root` 相同的 content-addressed artifact，不再把请求里的 `storeRoot` 当作 index root；测试覆盖该 env 路由、默认回退、缺失/异源/跨 Profile artifact 的结构化失败与绝不回退 Store-local index，同时保持五字段 stdin、N/K 与 snapshot 语义、普通 `lore query` 输出和公开 exports 不变。

## 2. 校验并冻结改动前 baseline

- [x] 2.1 benchmark runner 在锁定 Lorelum baseline commit、固定案例/Pack/Profile/N/K/environment 下运行完整案例集；核验 checkout identity 和固定输入 digest，并以固定 harness protocol 启动请求。（benchmark 侧在 `caecc53` 上完成；见其 `results/records/retrieval-ranking-v1-baseline-caecc53.json` 与 replay record。）
- [x] 2.2 benchmark 侧先验证 harness 输出和 scorer：失败、结构不完整、重复 ID、final ID 不属于 candidate IDs 等均记为运行/协议问题，不归为相关性失败；验证逐例 scorer 后再冻结 baseline version 与原始结果。（50 例全部 `status=ok`、failure_count 0，两次运行名单一致。）
- [x] 2.3 对审核案例逐一记录 core 是否进入候选、final 名次、scope error 和计划分母；冻结 baseline revision、逐例名单、判分、Provenance 和必要 hash。将复现命令、摘要与限制写入 `verification.md`。本任务完成前不得开始排序算法改动。（benchmark 侧 `verification.md` 冻结：core candidate recall 49/50、core final top-5 42/50、scope error 2。）
- [x] 2.4 在单独标记为 test-owned 的隔离 worktree/Store 中，使用现有正常 `lore query` 与已授权 query/Store 配置做独立 CLI 观察；只在终端记录 CLI 返回的 Practice IDs，不增加 flag/诊断/protocol。明确其不是 harness 同次请求的原子 trace；验证后、合并前删除该 worktree、Store 和临时日志，并在记录中注明清理完成。（benchmark 侧记录；本步未新增主仓库 test-owned Store。）
- [x] 2.5 根据已冻结 baseline 将失败归为召回、排序或混合问题，提出最小实现方案并与维护者讨论；任何需要改变产品合同、额外 runtime 或 scope 的方案，先更新 proposal/design/specs/tasks 并运行 strict validation，再开始该部分实现。（归因：7 例排序失败 + 2 例 scope error + 1 例召回失败；方案见 design Decision 7，已先更新 design/tasks 并 strict validation 后再实现。**历史/已废止**：此步选定的 FTS5 task signal 方案已被 §5 多视角向量转型取代，仅保留为过程记录，不代表当前交付或验收。）

## 3. 基于证据改进检索

- [x] 3.1 基于 2.5 确认的证据实现任务/阶段优先排序；用小型受控 embedding fixtures 覆盖 review-vs-domain 冲突、相邻阶段、直接有用的领域补充、同 Practice 去重与 deterministic tie-break。（`packages/engine/src/query/semantic/task-relevance.ts` + `task-relevance.test.ts`；候选去重由既有 `semanticCandidateIds` 保证，重排保持无重复。**历史/已废止**：`task-relevance.ts` 与 request-private FTS5 task signal 已在 §5.5 删除，此条不代表当前交付。）
- [ ] 3.2 若冻结 baseline 显示当前审核案例存在召回失败，按确认方案只增加有证据必要的候选表示/来源并验证 core recall；若仅是语料未来增长的推测，不纳入本次实现。（**未完成**：`agentic-acceptance-direct` 在旧单向量 Profile 下不进 top-20 候选。§5 已把文档表示改为 full/task-card/body 多视角，理论上会影响该召回，但尚未在冻结 benchmark 上验证 core recall，因此保持未完成；不得把 verification §9 的旧 task-signal 结果或输入侧 19/46 当作本步证据。）
- [ ] 3.3 使用同一 benchmark revision 对比改动前后；仅更换预先声明的 Lorelum build，其余输入保持一致。本变更有意改变 Profile identity，因此对比是 **baseline 旧 Profile 的 artifact 对新 build 新 Profile 的 artifact**，而不是“同一 Profile”；两侧分别记录 Profile ID，并保持模型、corpus/Pack、query 集、标签、N/K、scorer 和环境不变。用逐例变化分别报告召回失败、排序失败和 scope error，不以单个总分替代。（**未执行**：benchmark 侧待用新 run ID 重跑；主仓库本步只交付固定 build，不自行声明已改善。）
- [x] 3.4 验证 Store query 与 content-addressed ProjectContext query 共用排序规则、同一 snapshot canonical assembly；通过 Engine tests 覆盖两条路径。（两条路径都经 `executeSemanticQuery`；`query-service.test.ts` 与 `artifacts/semantic.test.ts` 各覆盖一次。）

## 4. 索引/runtime 与交付验证

- [x] 4.1 若实际实现改变持久化 projection/view/chunk，更新 Profile/index compatibility identity 和必要 migration；验证旧 Profile 不会被当成新格式 ready、staging failure 保留旧 active artifact。若不改变持久化表示，记录无需迁移的依据。（**历史**：此条“不改”判断只适用于第一轮 FTS5 task signal；§5.1–5.3 已改变持久化 projection/index 表示并升级 Profile/index identity，故此处结论已被 §5 取代，迁移与兼容性验收以 §5.2–5.3 和三套 semantic migration 为准。）
- [x] 4.2 仅当评测选中的机制要求额外模型/runtime 能力时，更新相关 Backend/capability design 后实现；否则保持 Backend 生命周期不变并验证既有 semantic operation tests。（**已验证**：多视角只增加同一 embedding Profile 下的编码次数与索引行数，未引入新模型或 Backend 生命周期。`bun test packages/backend/src/modules/query packages/backend/src/modules/index packages/backend/src/modules/embedding packages/backend/src/benchmark`：60 pass / 0 fail。同时修正 `content-addressed-semantic-runtime.test.ts` 的等价目录 coalescing 断言：它原先假设每 Practice 只编码一个向量，现按 view 数断言，并改为先解除阻塞再做断言，避免断言失败时 finally 清理碰到仍在使用的句柄。见 verification §11。）
- [x] 4.3 运行 `bun test packages/engine`、受影响的 Backend/CLI tests、`bun run typecheck`、`bun run lint`、`bun run fmt:check` 和 `openspec validate advance-task-aware-semantic-retrieval --strict`；将命令、结果、成本和限制写入 `verification.md`。（见 §9；`fmt:check` 在本机 `core.autocrlf=true` 下对全部既有文件报错，改动文件 `oxfmt --check` 通过。）
- [x] 4.4 审阅完整 diff，确认 harness 不在 CLI、包公开 exports 或产品 API 中，gold labels/完整 benchmark corpus 不在主仓库；确认 test-owned worktree/Store/日志已清理，且未改动工作区已有未跟踪研究资料。（未新增公开 export；未复制 labels/corpus；分析脚本与输出只存在于 `%TEMP%`；`docs/research/task-aware-retrieval-evolution.md` 未被改动。）

## 5. 多对多向量转型（2026-09-27）

这一节吸收输入侧动态权重实验与多对多向量参考。上一节 3.1 的 FTS5 task signal 保留为历史实验记录，不再代表交付目标；本轮实现必须移除它，并保持 N/K、snapshot retry 与 harness 协议不变。

> 2026-09-27 第二轮更新：本节 5.1/5.4 的 view 配方（`full`/`task-card`/`body`）已由 §6 改为按语义角色分层并移除了字面脚手架。本节保留为第一版多视角实现的过程记录，当前验收以 §6 与 verification §12 为准。

- [x] 5.1 将 semantic projection 升级为 full、schema-backed task card 与带标题路径的通用 body views；view recipe、分块边界和 digest 必须确定、可测试，且不新增 Practice 正文 schema。（`projection.ts` + `projection.test.ts`。）
- [x] 5.2 将 persisted semantic index 升级为 `(practice_id, view_id)` 多行表示，保留 `vectorCount` 的 Practice 计数语义，并校验 view kind、digest、重复行与维度；Store-local、ProjectContext、progress 和 shared vector cache 使用同一 view 身份。（三套 semantic migration、`database.ts`、`vector-cache.ts`、`semantic-progress.ts`。）
- [x] 5.3 按 view projection digest 增量复用未变化向量；正文局部变化不得强制重编码所有 unaffected views。更新 Profile/index compatibility identity，确保旧单向量 index 为 incompatible 并从快照原子重建。（Projection v2、index v3；service/progress tests 覆盖 changed/add/removed/source-only。）
- [x] 5.4 reader 改为先对同一 Practice 的内容 views 取最大值，再按 query views 的固定非负权重聚合，最后按 Practice 排序和 N/K 切片；默认产品 query 只使用完整原句，不暴露结构化 query 参数。（`reader.ts`、内部 `queryViews?`；`reader.test.ts`、query-service tests。）
- [x] 5.5 删除 runtime 中的 request-private FTS5 task signal 与 `similarity + 0.05 × taskStrength`，补充无词面重合、局部命中、更多 chunk 不线性加分、相邻阶段/否定上下文回读、稳定 tie-break、snapshot retry 与无 keyword fallback 的测试。（`task-relevance.ts` 删除；header/条件保留、局部命中、max 聚合和无 fallback 已覆盖。）
- [x] 5.6 运行 migration 生成与审阅、focused Engine/ProjectContext tests、`bun test packages/engine`、`bun run typecheck`、`bun run lint`、`bun run fmt:check` 和 `openspec validate advance-task-aware-semantic-retrieval --strict`，并更新 verification 记录失败边界与未执行的外部 benchmark。（见 verification §10；整包唯一失败为 Windows EPERM flaky，单文件重跑通过；改动文件 fmt 通过。）
- [x] 5.7 将 query 字段固定/动态权重保留为隔离实验方向，不设为产品默认。后续文档侧多视角数据冻结后，按 A/B/C/D 对照评估；本轮不得把输入侧 19/46 结果归因于多对多实现。（design/proposal 已明确边界。）

## 6. 语义角色分层与去字面脚手架（2026-09-27 第二轮）

这一节处理"实现仍然是关键词检索换载体"的三个具体缺口：裸 id/slug 与字段标签进入 embedding、topic 与 applicability 未分离、按字符切块让 CJK 提前撞模型上下文。

- [x] 6.1 将 projection 从 `full`/`task-card`/`body` 改为按语义角色分层：`applicability`（title + `applies_when` + stage + anti-pattern name/description）、`topic`（仅 `tech_stack`）、`guidance`（带标题路径的正文块）。进入 embedding 的文本不再包含 Practice id、anti-pattern id 或 `Practice:`/`Title:`/`Applies when:`/`Tech stack:` 等字段标签。（`projection.ts`、`projection.test.ts` 新增"任何 view 都不含 Practice id"断言。）
- [x] 6.2 reader 改为按角色聚合：`applicability` 取最大值作为判据，`guidance` 取均值使块数无法抬高分数，`topic` 取最大值并只作为负向项；角色权重（`SEMANTIC_ROLE_WEIGHTS`）以语义角色为键，不以字段名或手工字段权重表为键。新增"只命中 topic 的 Practice 不能压过 applicability 命中"回归。（`reader.ts`、`reader.test.ts`。）
- [x] 6.3 视图按估算 token 预算切分（CJK 约 1 token/字，其它约 0.25），替代按字符计数，避免中文比英文提前约四倍撞上模型上下文；新增无标点连续中文按预算分块的回归。（`SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS`、`estimatedTokens`。）
- [x] 6.4 使用本机真实 embedding 模型（granite-embedding-97m-multilingual-r2，与产品相同 pooling/归一化参数）对两条冻结 scope error 复测：`issue-pr-body-scope-conflict` 由禁项 #1 翻转为 core #1（禁项 0.8652 → core 0.8535 的单模板基线，改为角色视图后 core 0.9275 / 禁项 0.9065），中文 query 亦为 core（0.9937 / 0.8190）；`issue-pr-readback-pack-context` 仍未翻转（core 0.8849 / 禁项 0.8912），且逐角色显示禁项在 applicability、topic、guidance 三轴都更高，说明它需要 query 侧拆解而非文档侧重加权。见 verification §12。
- [ ] 6.5 query 侧拆解（把 query 的"背景主题"从句与"当前动作"从句分成独立 query views）尚未实现。它同时是输入侧动态权重实验的入口；在 §6.4 的证据下，这是 `issue-pr-readback-pack-context` 一类案例的下一步，不属本轮完成项。
- [x] 6.6 把"是向量检索"钉成结构守卫：`no-lexical-scoring.test.ts` 扫描 `query/semantic/**` 与 `semantic.ts`/`semantic-progress.ts`/`vector-cache.ts` 的生产文件，断言 import specifier 不含 `keyword`/`fts5`/`bm25`，且不出现 `buildKeywordIndex`/`projectKeywordPractice`/`KeywordIndexUnavailableError`。已用临时重新引入 keyword import 验证该守卫会失败，随后回退。同时把名字夸大但实际只做排序断言的用例改为 "ranks by cosine even when the query shares more words with the wrong Practice"，并在 spec 中新增 "Scoring stays vector-only for languages without word boundaries" 场景。

## 7. 融合多对多与输入侧动态权重（2026-09-28）

这一节把文档侧三种表示组（`full`/`task-card`/`body`）与"排序覆盖全量、`K` 最后应用、非负单调聚合"落地，并删除上一版 doc 侧的 `topic` 负权与候选收窄。§6 的 `applicability`/`topic`/`guidance` 角色命名与 `topic` 负权由本节取代；§6.5 的自动 query clause 拆解已由本节 7.5 进入默认路径，结构化字段与动态权重仍留在 7.6。

- [x] 7.1 projection 改为 `full`（不含 id/标签的整条文本，按估算 token 预算切分）/`task-card`（title、`applies_when`、stage、anti-pattern，不含 `tech_stack`）/`body`（带标题路径的正文块）；`SEMANTIC_PROJECTION_VERSION = 4`；`view_kind` 约束改为 `full | task-card | body`，并为 Store-local、ProjectContext 与 progress 三套 semantic 迁移各生成一版 0002 重建迁移（旧 kinds 不相容，迁移不复制旧行，改由完整 snapshot 重建）。
- [x] 7.2 reader 聚合改为：同一 Practice 内、对每个 query view 取内容视角的 `max`；跨 query views 用固定非负单调混合 `S = (1-α)·max_i a[p,i] + α·Σ w_i a[p,i] / Σ w_i`（α = 0.5，w_i ≥ 0）。删除 `SEMANTIC_ROLE_WEIGHTS` 与负权 `topic`，并新增"额外 body 块不线性加分""跨 query view 单调非负"的回归。
- [x] 7.3 query-service 改为全量排序：reader 对全部 eligible Practice 打分并排序，`K` 只在完整排序产生后应用；benchmark harness 的候选宽度 `N` 只限制其报告的 candidate ID 数量，不改变参与打分的集合或最终排序。
- [x] 7.4 更新 projection/reader/query-service/index/artifacts 与 backend 的 embedding 次数与 view-identity 断言到新配方；`bun test packages/engine`、`bun test packages/backend`、`bun run typecheck` 的结果记录在 verification §13。
- [x] 7.5 默认 query 按跨语言标点边界拆成 clause views；整句不再作为主导 view。reader 忽略 `full` 的常规打分，按 clause 平衡 `task-card`/`body`，再用弱 clause 与加权均值的固定非负单调混合。真实模型复测两条冻结 scope case：`issue-pr-body-scope-conflict` core #2 / forbidden #41，`issue-pr-readback-pack-context` core #2 / forbidden #5。见 verification §14。
- [ ] 7.6 结构化 query views（`intent`/`moment`/`artifact`/`constraints`/`domain`）与固定或动态非负权重的隔离实验尚未进入产品默认；需要新的冻结 build 与 benchmark run 才能评估收益，不能把上一轮输入侧 19/46 或 50 题旧结果归因于本轮 clause split。
- [x] 7.7 实现 m 侧片段证据聚合：每个 query clause 先取 task-card 最佳适用性，再用 `0.5 × body 最佳片段 + 0.5 × body 全片段均值` 形成 m-side 证据；两段均覆盖全部 eligible Practice，不做候选漏斗；最后才应用 `K`。真实模型复测两条 scope case 的 core 均保持 #2，forbidden 分别为 #33 与 #5；见 verification §15。

## 16. 多轮检索与按名次融合（2026-09-29）

> 2026-09-29 回退：本节及 §17 的多轮/RRF 方向已按维护者纠正意见撤回，见 §18。本节保留为实验记录，不代表当前实现或产品默认。

本节处理"`n` 个 query view 与 `m` 个 Practice 内容 view 其实是 `n` 次独立全量检索轮次"这件事：上一版把 `n` 个 clause 的分数塞进一个取最小值的固定混合，实际是"一次矩阵 + 一次聚合"，既没有把轮次显式化，也没有让多轮一致性提高正确 Practice 的名次。§7.2/§7.5 的"固定非负单调混合"由本节取代；`n`、`m` 是矩阵两维而不是轮数。

- [x] 16.1 reader 把每个 query view 显式当作一次覆盖全部 eligible Practice 的检索轮次：先算出该轮每个 Practice 的 `task-card`/`body` 两段证据分数，再得到该轮排序。继续沿用 `full` 不参与常规打分、额外 body 块不线性加分。（`scoreSemanticRounds`，`reader.ts` / `reader.test.ts`。）
- [x] 16.2 跨轮合并改为 reciprocal rank fusion：`S[p] = Σ_i w_i / (k + rank_i(p) + 1)`，`k = 60`，`w_i` 为 query view 的基准权重。按名次而不是跨轮不可比的绝对余弦合并；多轮一致靠前的 Practice 累积更多证据，单轮最低分不再取最小值直接抵消其它轮次。删除 `SEMANTIC_WEAK_CLAUSE_MIX` 与取最小值混合。（`mergeSemanticRoundScores`、`SEMANTIC_ROUND_FUSION_K`。）
- [x] 16.3 回归：多轮一致性优先于单轮尖峰、单轮只重排、轮数不一致抛 typed error、基准权重缩放贡献。（`index/reader.test.ts`。）
- [x] 16.4 真实模型定向复测（本机 granite-embedding-97m-multilingual-r2；当前已安装 4 Pack / **90** Practice / 1151 views；非官方 50 例 benchmark）：`issue-pr-body-scope-conflict` 由 core #2 / forbidden #32 变为 core #1 / forbidden #28；`issue-pr-readback-pack-context` 由 core #2 / forbidden #5 变为 core #3 / forbidden #4。见 verification §16。第二例 core 名次轻微下降，必须如实记录，不得写成全面改善。

## 17. 轮次族与二层融合（2026-09-29）

> 2026-09-29 回退：本节已被 §18 取代。轮次族与二层 RRF 不再进入默认或交付。

§16 只把"每个 query view 一轮"作为默认，并把 Practice 的多个内容 view 当成 `max` 的候选。本节按维护者意见把多轮检索扩成多个**轮次族**，并用全 50 例冻结集（而不是两条 case）综合比较，避免用单点结论挑一个族、贬一个族。§16.2 的单层 RRF 由本节取代。

- [x] 17.1 定义并实现三类轮次族：A 查询视角轮（每 clause 一轮，混合 `task-card`/`body` 证据）、C 单视图槽位轮（每 clause × 每个有序 view 槽位一轮）、D 受限细化轮（首轮最强 5 个 Practice 的 `task-card` 以总权重 0.2 细化 query 后再跑 A 式轮次）。`scoreSemanticFamilyRounds` 在一次 cosine 遍历中同时产出 A 族轮与 C 族槽位分数。（`reader.ts`、`reader.test.ts`。）
- [x] 17.2 融合改为二层：族内 RRF、族间等权 RRF。避免 C 族因轮数远多于 A 族而主导排序；细化族只能等权影响，不能覆盖主轮。（`readCandidateRows`。）
- [x] 17.3 视图槽位顺序由 reader 显式重建为 `full` → `task-card` → `body`，再按 ordinal 与 view ID 排序，不依赖索引返回行序（索引读取路径没有 `ORDER BY`）。新增"槽位分数不受读取行序影响""A 族混合分数不受读取行序影响"回归。（`orderPracticeViews`、`reader.test.ts`。）
- [x] 17.4 在冻结 v2 的 **50 条 labeled case** 与冻结 `store-6bf1e1b-v4`（97 Practice / 1232 views，按当前 v4 配方重投影）、真实模型上比较 A/B/C/D 的族内、族间与单层平铺组合。结论：没有单族全面占优；默认采用 A+C+D（相对上一版默认 A+D 在 hit@1、top-20 召回、MRR 上严格更好，命中率与官方 scope 口径不变）；B 已测量但会重现 `max` 机会偏差，故不进入默认。见 verification §18。
- [x] 17.5 在生产函数上复算同一冻结集，确认 `PROD A+C+D` 与选中的 `2lvl A+C+D` 逐例 core/forbidden 名次 0 处不一致。实验脚本、向量缓存与结果文件只存在于 `%TEMP%`，合并前删除。

## 18. 回退多轮与名次融合（2026-09-29）

维护者判定 §16/§17 的方向错误：多轮检索最终落成 reciprocal rank fusion，**用名次替代了向量余弦**，并且需要靠族组合取舍来选默认。因此本 change 的检索回到"一次全量向量打分"，多轮/轮次族/细化轮/RRF 全部撤回，不作为默认也不作为交付。

- [x] 18.1 `reader.ts` 删除 `scoreSemanticFamilyRounds`、`scoreSemanticRounds`、`SemanticRoundScore`、`SemanticPracticeRoundScores`、`SemanticPracticeFamilyRounds`、`SEMANTIC_REFINEMENT_SEED_COUNT`、`SEMANTIC_REFINEMENT_WEIGHT`、`refineQueryScores`、`SEMANTIC_ROUND_FUSION_K` 与 `mergeSemanticRoundScores`。
- [x] 18.2 改为单次打分 `scoreSemanticPractice`：每个 clause 得到 `task-card` 最佳适用性与 body 片段证据（`0.5 × 最佳片段 + 0.5 × 全片段均值`）的等权平均，再按 query view 权重加权平均并与最弱 clause 做固定非负混合（`SEMANTIC_WEAK_CLAUSE_MIX = 0.5`）。全量 eligible Practice 只排序一次；仍保留 `full` 不参与常规打分、块数不线性加分、无词面通道。
- [x] 18.3 `readCandidateRows` 只做一次打分与排序，tie-break 回退到 Practice ID；`orderPracticeViews` 保留，用于让 `bestView` 诊断在并列余弦下确定。
- [x] 18.4 `reader.test.ts` 重写为单次聚合语义：task-card/body 平衡、额外 body 块不线性加分、局部片段可见、背景 clause 不能带过整条、权重缩放、读取行序无关、无可打分 view 时报错、维度不匹配报错。
- [x] 18.5 同步回退 `proposal.md`、`design.md`、`specs/retrieval-query/spec.md`：删除"轮次族 + reciprocal rank fusion"要求，改为"同一次检索内聚合"要求，并在 §19 记录回退证据与未执行项。

## 19. 去掉跨-clause 最弱值惩罚（2026-09-29）

回退到单次检索后复测发现效果仍偏低（hit@1 26、hit@5 42、MRR 0.6622）。单变量消融显示原因不在"单次向量检索"，而在 §14 沿用下来的"与最弱 clause 混合"项：它挡住了"背景 clause 独自带过 Practice"，但同时惩罚了"动作 clause 命中、背景 clause 很弱"的正确 Practice。

- [x] 19.1 删除 `SEMANTIC_WEAK_CLAUSE_MIX` 与该混合项；`scoreSemanticPractice` 的跨-clause 聚合改为按 query view 基准权重的**纯加权平均**，不再引入任何可调惩罚系数。
- [x] 19.2 背景 clause 的守卫由加权平均本身承担：动作 clause 的近零余弦会被一起平均进去，而不是被丢掉；不再需要额外的 floor 项。
- [x] 19.3 单变量消融（冻结 v2 50 例、冻结 97 Practice / 1232 views、真实模型、生产函数复算 0 误差）：β=0.5 为 26/39/42/46、MRR 0.6622；β=0.25 为 29/43/44/47、0.7093；纯加权平均为 33/43/45/47、0.7637；只取 max clause 为 27/37/40/49、0.6568。见 verification §20。
- [x] 19.4 记录代价：纯加权平均下 `issue-pr-readback-pack-context` 的 forbidden 由 core 之后变为 core 之前（core#5 / forbidden#3）；该案例在所有已测配置下本来就是 scope error（forbidden 进 top-5）。不隐藏这一条。

## 20. 方案 C：先验证角色信息，再评估自动化（2026-10-03）

路线与具体门槛见 [方案 C 研究计划](../../../docs/research/role-aligned-retrieval-plan.md)；设计边界见 design 的同名补充节。以下任务不授权解冻生产公式，也不替代既有未完成 benchmark 验证。G4/G5 必须另行批准才可执行。

- [x] 20.1 整理方案 C 的维护者研究文档与本 change 设计/任务边界，区分已执行证据、假设、阶段产物及未批准产品能力。
- [x] 20.2 G0：登记可重放 manifest、角色来源格式、单一候选策略（权重/缺失角色/负余弦/重复证据/tie-break/回退）、新增 pilot 标注协议及实测后冻结的成本预算；检索与标签读取隔离。（[G0 协议](../../../docs/research/role-aligned-g0-protocol.md)；实现 `packages/backend/src/benchmark/role-aligned/`；成本实测、预算及修订披露见 verification §25.5–25.6。登记不代表任何角色条件有效，角色样本格式只经单元测试，尚未被真实标注者使用。）
- [x] 20.3 G0：实现隔离 control 重放，逐 query × Practice 与生产评分比对误差不超过 1e-6，并复现冻结指标；不修改 production scorer/pin/Profile，不使用个人 Store。（4850 对 `maxAbsDelta = 0`，两次独立冷编码的排名与比对产物字节级相同，hit@1/3/5/top-20 为 33/43/45/47、MRR 0.7637、scope 2、forbidden-before-core 1；见 verification §25。G0 通过不表示 C 有效，也不自动授权进入 G1。）
- [ ] 20.4 G1：在独立来源角色标注下执行 Q 与 Q+I 单变量条件，固定策略后保存全量排名再评分；报告负对照、逐例改善/回归与 §6 门槛。不将事后选 clause 当自动 analyzer。（**实验已执行，保持未勾选等待维护者决定是否以负结果关闭**：见 [G1 协议](../../../docs/research/role-aligned-g1-protocol.md) 与 verification §26。旧 v2 上 Q/Q+I hit@5 41 < 45、MRR 0.652/0.653 < 0.7637，未通过 §6.3 第 3 项；40 条取自 Lorelum issue 标题的真实任务 pilot 中仅 5 条有可接受目标，control 成功 3、Q/Q+I 成功 2 且多 1 条禁项 query，第 2 项失败；同预算无角色对照无差别。角色由独立 agent 只看 query 标注，但相关性标注是按 Pack 隔离的单评审者 agent，非人工、无一致性度量，且可测样本只有 5 条，所以结论是“无收益迹象”，不是显著性结论。建议停止 query 侧人工角色方向，不进入 20.5。）
- [ ] 20.5 G2（G1 通过后）：按需独立编码有来源的文档角色条件，并做真实近邻/新领域/替代答案/正文扩展压力及语言/Pack 留出，分开报告质量与计算增长。
- [ ] 20.6 G3（前置关卡通过后）：实施自动 query 角色 analyzer 的隔离对照，记录角色错误、来源、回退、收益损失与延迟/内存；未满足预登记门槛时停止产品接入。
- [ ] 20.7 G4（另行批准后）：根据有效实验更新生产设计与 spec，再实施公式/接口/版本及必要迁移，覆盖 Store/ProjectContext、canonical assembly 与 snapshot retry；实验无效时不勾选本任务。
- [ ] 20.8 G5（另行批准后）：只有可信反馈和固定策略收益成立后，提出离线受控学习、隐私/权限、旧任务回放、新任务与 Pack 留出、版本发布/回滚设计；不实现未经批准的在线自修改。
