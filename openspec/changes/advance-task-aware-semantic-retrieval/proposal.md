# Proposal

> **适用域与历史状态：** 本 change 记录多视角算法及其评测演进；下文涉及 `full` / `task-card` / `body`、clause、384 token 预算和聚合公式的规则，现仅适用于显式选择的实验方法 `multi-view-vector`。历史文字中的“默认产品输入/排序”均指该方法内部 recipe，不能覆盖当前 `single-vector` 默认。当前配置与协议以 [配置维护说明](../../../docs/configuration/README.md#query-方法与前台预算)、[Query API](../../../docs/api/query.md) 和 [harness 六字段输入](../../../docs/development/semantic-retrieval-benchmark-harness.md#启动和输入) 为准。旧 Profile/schema 版本与五字段输入只用于固定旧 checkout 的复现；历史证据不改写，也不代表方法隔离后重跑了 frozen benchmark。


## Why

Issue #236 的已知实例中，帮助完成提交前 review 的 Practice 已经出现在语义检索结果中，却排在 Registry/Pack 发布、安装验证等背景相关 Practice 后面。当前实现随后用 request-private FTS5 BM25 给候选加了任务信号；这能改善一组已参与选参的案例，但没有让局部正文、适用条件与完整请求建立独立的向量匹配，而且仍存在候选外召回失败。继续把词面信号当作产品排序主干会把“任务识别”退化为关键词命中，无法满足研究结论指出的输入视角与 Practice 内容视角组合。

2026-09-26 的两份参考给出互补方向：输入侧实验说明 query 字段权重与聚合会改变排序；多对多研究说明应让完整 query 与同一 Practice 的全文、task card 和正文块分别做向量匹配，先在 Practice 内汇总，再做字段聚合。输入侧实验仍是小样本探索，文档侧多视角尚未验证，因此本次先把产品路径改为真正的多视角向量检索，并把 query 字段及动态权重保留为后续隔离实验变量。

## What Changes

- 让 semantic retrieval 的默认候选来源与排序都来自向量相似度：完整 query 对同一 Practice 的清洗后 `full`、`task-card` 与带上下文 `body` views 做矩阵匹配，`full` 与 `body` 按估算 token 预算切分。
- 默认 query 按跨语言标点边界拆成 clause views，不把整句作为主导。每个 clause 在同一 Practice 内分两段计算 task-card 适用性和 body 片段证据；body 用最佳片段与全片段均值的固定混合，避免片段被平均抹掉，也避免块数线性加分。系统把这几个 clause 分数在一次检索里聚合为一个 Practice 分数：按 query view 的基准权重求加权平均。单个背景/领域 clause 不能独自带过整条 Practice，因为动作 clause 的近零余弦会被一起平均进去而不是被丢掉；不再额外叠加最弱-clause 项，因为实测它同时惩罚了"动作 clause 命中、背景 clause 很弱"的正确 Practice。排序覆盖全部 eligible Practice，只做这一次全量打分，不引入跨轮 rank fusion、单视图槽位轮或细化轮。`full` 不参与常规打分，只在没有可打分 view 时兜底；不得把所有 body chunk 分数直接相加，也不得使用负权重。
- 排序覆盖全部 eligible Practice，`K` 只在完整排序产生后应用；benchmark harness 的候选宽度 `N` 只限制其报告的 candidate ID 数量，不改变参与打分的集合或最终排序，也不能先按 `K` 截断。
- 移除 request-private FTS5 task signal 与 `similarity + 0.05 × taskStrength` 路径；keyword 只保留为显式独立模式，不得成为 semantic 的隐式 fallback。
- task-card 只由现有公开 schema 字段组成且不含 `tech_stack`；自由 Markdown body 按通用段落/列表语义单元分块并附标题路径，不引入新的 Practice 正文格式或角色 schema。
- 自动 query clause 拆解与单次聚合进入本轮默认产品输入。多轮检索、轮次族与 reciprocal rank fusion 已按维护者纠正意见撤回，不再属于本轮默认或本轮交付。结构化 `intent`/`moment`/`artifact`/`constraints`/`domain` 字段与手工/分位动态权重仍不进入默认产品输入；其接口可在内部 scoring 边界保留，但必须由后续隔离实验决定是否启用。
- 然后增加一个只在固定 Lorelum checkout 中运行的本地 benchmark harness。benchmark runner 通过 stdin 提供 query、固定 Store/Pack、embedding Profile、`N` 和 `K`，不传 gold labels；harness 在一次检索中返回 `candidateIds`、有序 `finalIds` 和明确状态。
- 保证 harness 的两份 ID 名单来自同一次检索和同一 snapshot；检索重试时丢弃失败尝试的名单。候选与最终名单不得重复，且最终名单必须来自候选集合。输出不含 query、正文、相似度或内部打分。
- benchmark 侧先验证 harness 输出和逐例判分，再固定 baseline 版本及原始结果；baseline 固定后才开始本仓库的排序改进，并在相同评测条件下对比。
- 另行使用现有 CLI 与已授权的隔离私有 Store 执行正常 `lore query`，在终端观察其实际返回的 IDs。该观察与 harness 是分开的调用，不充当同一次检索的候选 trace。
- harness 不作为用户 CLI 命令、不进入包的公开 exports，也不改变产品 API；不新增 CLI flags 或诊断输出。完整评测案例和 gold labels 不复制到 Core 测试语料。

本提案引入 semantic mode 的文档多视角向量行为，但不新增用户参数、Practice 正文格式、用户手填结构化 query 或公开诊断合同。多 query 字段自动提取、动态权重、Hybrid、ANN、新模型和完整 Query analyzer 仍不是预先承诺的实现要求。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `retrieval-query`: semantic 结果由 query clause views 与 Practice 多内容视角的向量相似度决定；排序覆盖全部 eligible Practice、`top-k` 最后应用，同时保持现有 canonical summary、coverage、envelope 与失败语义。
- `semantic-index`: 持久化完整、task-card 与 body-view 向量及其表示身份；旧单向量 Profile/index 必须失效或重建，不能被误认为兼容。

## Impact

- **Engine:** `packages/engine/src/query/semantic/` 的 projection、index schema、增量复用、全量排序、候选有效性/snapshot 边界与多视角聚合；在 Engine 内部提供候选名单给本地 harness 的受控路径。
- **本地评测 harness:** 在固定 checkout 内用 stdin/stdout 运行，不使用 benchmark 仓库跨仓库 import Engine 私有源码。
- **Benchmark:** 外部 runner 固定 Lorelum checkout 和评测输入，通过 harness 收集候选与最终名单；gold labels 仅由 benchmark 进程持有，并冻结 baseline 版本及原始结果。
- **CLI 验证:** 仅使用现有正常 `lore query` 和已允许的配置，在明确标记为 test-owned 的隔离 worktree/Store 中观察终端 IDs；不增加 CLI 功能。
- **Backend:** 继续复用同一 embedding runtime；多视角增加编码次数与索引体积，但不引入新模型或 Backend 生命周期。

## Issue #236 Scope Boundary

本 change 记录 #236 的**本地检索实验与已知限制**，不关闭 #236，也不承诺其全部排序目标：

- **包含**：候选宽度与公开 top-k 分离；全量纯向量排序；多视角（task-card / body / clause）表示；候选观察在排序前完成全部 N 个候选的 canonical 校验；召回与排序分开的评测记录；对本地 harness 的可复现结果。
- **不包含**：通用流程指导压过具体指导的问题的本地解决方案；词面、BM25/FTS5 或其他关键词排序通道；LLM 或 reranker 的本地判断。
- **交给高级检索**：对候选做适用性判断（判断"当前动作与状态是否适用"）属于高级检索的判断步骤。它由服务端或调用方 agent 执行，需要单独的接口设计与批准，不属于本 change，也不在开源本地检索中实现。
- **验收定位**：#236 的目标是"优先"匹配当前任务与阶段，不要求每条查询都把指定 Practice 放到第一位。本地检索以 40 条评测集的召回与排序记录作为基线；未解决的排序失败与召回失败（见 verification §28）按已知限制记录，留给高级检索跟进。

