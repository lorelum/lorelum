# Design

> **适用域与历史状态：** 本文保留原始设计、版本迁移与实验路线。文档多视角、query clause、384 token 预算及既有聚合公式只约束显式 `multi-view-vector`，其中“默认”是该实验方法内部的默认 recipe，不是当前 semantic 方法默认。当前默认 `single-vector` 对每条完整文档和完整 query 各编码一次并以 cosine 排序，不受本文多视角拆分规则约束。共享的 canonical/snapshot 安全、全量排序后 K、N 只限制报告及禁止 keyword fallback 边界仍适用于两种方法。当前 Profile 绑定 encoding 与方法的 document/query/scoring recipe；原文的 index v3、view 列及“固定 Profile”是历史设计，不覆盖当前 [encoding-input schema v4](../../../docs/development/persistence.md#semantic-encoding-input-schema)。当前 harness 必填方法的示例见 [维护协议](../../../docs/development/semantic-retrieval-benchmark-harness.md#启动和输入)。历史评测数字、撤回记录及后续隔离实验规划不变，不据此声称质量改善或 #236 已解决。


## Context

动机见 [proposal.md](./proposal.md)。当前实现与本 Issue 相关的事实如下：

- `packages/engine/src/query/semantic/read.ts` 将请求的 `limit` 原样传给 reader；`packages/engine/src/query/semantic/index/reader.ts` 按该 limit 截断向量结果。因此现在候选宽度与用户最终 `top-k` 相同，尚无独立的最终排序空间。
- `packages/engine/src/query/semantic/query-service.ts` 在 query 期间协调候选选择、同一 Store snapshot 下的 canonical Practice 读取和结果组装，并可能因 Store 变化重试。
- `packages/engine/src/query/semantic/projection.ts` 当前把 frontmatter 与完整 Markdown body 拼为一个向量文本；`semanticVectors` 以 Practice ID 为主键，无法持久化局部内容视角。
- 第一轮 task-aware 实现只在同一候选池内使用 request-private FTS5 BM25，并以 `similarity + 0.05 × taskStrength` 重排。它能处理已召回候选，但不改变表示，也不能修复候选外漏项。
- 2026-09-26 输入侧参考观察到 query 字段权重与聚合会影响小样本排序；多对多参考提出 `多个 query 视角 × 同一 Practice 的多个内容视角`，但文档侧尚未实验。
- 探索草案 `docs/research/task-aware-retrieval-evolution.md` 记录了目标 review Practice 已被召回但排名靠后的一次观察。它是研究材料，不是已接受的产品合同。

## Goals / Non-Goals

**Goals:**

- 在最终排序前保留独立的候选集合宽度 `N`，最终仅输出至多 `K` 个结果。
- 让 query clause views 与同一 Practice 的 task card 和通用正文块分别进行向量匹配，在 Practice 内先汇总，避免整句、全文或长正文只因总长度大而主导。
- 让 task-card 和 body-view 的表示、分块配方和 digest 可版本化；旧单向量 Profile/index 不得被当成兼容。
- 让 benchmark harness 对同一次检索分别看到候选集合与正常排序结果，从而判断漏召回还是错排序。
- harness 不依赖用户 CLI 调试输出，不要求 benchmark checkout import Engine 私有源码，也不扩大公开产品面。
- 在 baseline 阶段只拆分 N/K、保持旧排序行为；harness 与 scorer 校验通过并冻结 baseline 后，才改进召回/排序。
- 使用现有 CLI 对已授权隔离 Store 做一次独立正常查询，并只在终端观察其结果 IDs；不得把它误称为 harness 的同次候选 trace。

**Non-Goals:**

- 不把 `limit=K` 的旧 top-k 输出重命名成候选名单；`N` 必须是独立的候选生成边界。
- 不将 harness 做成普通 CLI 命令、包公开 export、产品 API 或用户可见诊断。
- 不增加 `--explain`、新 CLI flag、产品 protocol field、诊断子命令或其它 CLI 功能。
- 不把 gold labels、完整 query 集或 Knowledge-Pack 内容复制进主仓库。
- 本轮不把多 query 字段自动提取或动态权重设为默认产品行为，也不引入 Hybrid、ANN、新 embedding 模型或专用 reranker；这些能力须由与文档表示隔离的实验决定。

## Decisions

### 1. 分开 N 与 K，再接 harness

`K` 是正常结果数量；`N` 是 benchmark harness 报告 candidate ID 的宽度上限。排序现在覆盖全部 eligible Practice：reader 先对全量候选聚合排序，`K` 只在完整排序产生后应用，`N` 只限制 harness 返回的 candidate ID 数量，不改变参与打分的集合或最终排序。评测用例仍选择 `N > K`，以便同时观察 candidate 列表与正常排序结果。

历史说明：本 change 最初把 `N` 当作"能进入最终排序的候选宽度"，即先取至多 N 个候选再排序。2026-09-26 的输入侧动态权重实验与多对多向量参考，以及维护者结论，表明向量全量扫描成本很小，这种"先 N 再 K"的收窄是多余的；因此 `N` 降级为报告宽度，排序分母改为全量 eligible Practice。不能将旧 `limit=K` 输出改名成 `candidateIds`，因为那无法观察被旧 K 截断的候选。

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

harness 的 derived semantic artifact 位置来自 benchmark 进程环境变量 `LORELUM_BENCHMARK_CACHE_ROOT`（未设置时回退 `defaultQueryArtifactCacheRoot()`），即与 Store-only `lore index build --cache-root` 相同的 content-addressed artifact；请求里的 Store root 只选择 canonical 语料。该变量只存在于固定 checkout 的被测进程环境，不进入五字段 stdin，也不是 CLI、公开 package export 或产品 API 的一部分。artifact 缺失、不兼容或不属于该 Store/Profile 时只返回结构化失败，绝不回退 Store-local `indexes/semantic/...`，也不自动构建、修复或迁移索引。

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

### 7. 用 Practice 多视角向量替代关键词任务重排

冻结 baseline（50 例：core candidate recall 49/50、core final top-5 42/50、2 例 scope error）说明既存在最终排序失败，也存在候选外漏项。第一轮 FTS5 task signal 只在候选池内调整字面重合，不能表达“同一句子匹配正文中的局部适用条件”，也没有修复召回。因此第二轮把变化放在语义表示与向量聚合，不再扩大关键词权重。

文档表示（两种表示组）：

- 早期配方还编码一个不含 id 与字段标签的整篇 `full` view，作为上下文锚点但不参与打分；因为有效 Practice 总有 `task-card`，它只增加编码与存储成本，已从配方中删除（见 `isolate-semantic-retrieval-methods` 的 design）。
- `task-card` view：只由 schema 字段组成 —— title、`applies_when`、stage，以及 anti-pattern 的 name 与 description。不得包含 tech stack，使领域名词不能单独决定适用性问题。
- `body` views：按通用 Markdown 段落、列表项与长度边界切分；每个块附当前标题路径，否定词、例外和条件句不脱离原块。
- 任何进入 embedding 的文本都不得携带裸 id/slug 或英文字段标签：`Practice: react.server.request-dedup-cache` 与 FTS5 的 `id: 8` 权重是同一个字面信号，只是换了载体。分块配方版本必须进入 view digest。
- 每个 view 持久化 Practice ID、view ID/kind/ordinal、canonical content digest、projection digest 和 embedding。Store 或 ProjectContext 仍从同一 embedding Profile 编码，不引入第二个模型。

查询与聚合（对齐 2026-09-26 的多对多参考）：

- 默认产品 query 不再把整句作为一个主导向量。`query-views.ts` 按跨语言标点边界把原句拆成独立 clause views；当 query 只有一个 clause 时该 clause 才等同原句。内部接口仍允许给定 `intent`/`moment`/`artifact`/`constraints`/`domain` 等更丰富 query views，但不新增 CLI/API 参数。
- 同一 Practice 内，每个 query clause 做两段式片段证据汇总：`task-card` 取最佳匹配作为适用性分数，`body` 同时保留最佳片段与全部片段的均值，再用 `0.5 × max + 0.5 × mean` 得到 m 侧片段证据分数。单片段能贡献局部证据，但更多无关片段会拉低均值，因此块数不能线性抬高分数。缺少 task-card/body 输入或出现其他 channel 时打分返回 typed error。
- 两段都覆盖全部 eligible Practice，不建立候选漏斗：第一段 task-card 适用性、第二段 body 片段证据都在完整集合上计算，最后才按 Practice 去重、排序并应用 `K`。
- 跨 clause 的聚合发生在**同一次检索**里，不引入多轮：每个 clause 先得到该 Practice 的 clause 分数（上述 `task-card` 最佳适用性与 body 片段证据的等权平均），再按 query view 的基准权重求加权平均。排序对全部 eligible Practice 只发生一次。单个背景/领域 clause 的高分不能独自带过整条 Practice，因为动作 clause 的近零余弦会被一起平均进去；决定顺序的仍是向量余弦本身，不是被名次融合替换掉的相对排序。曾叠加的"与最弱 clause 混合"项已被实测否决（见 `verification.md` §20）：它同样惩罚"动作 clause 命中、背景 clause 很弱"的正确 Practice。
- 不建立跨轮 reciprocal rank fusion、单视图槽位轮或细化轮。历史上本 change 曾按 50 例冻结集把 A/B/C/D 四个轮次族做二层 RRF 组合，见 `verification.md` §16–§18。维护者指出该方向错误：它把向量相似度换成了名次融合，并需要靠族组合取舍来选默认。因此 §16–§18 只保留为实验记录，不是当前实现或产品默认；回退记录见 §19。
- 不在任何一层累加块分；也不引入任何词面通道 —— semantic 路径不得出现 FTS5/BM25、关键词表切分 query 字段或 keyword fallback，因为它们对无空格语言（如中文）是零召回，对跨语言按构造不可能命中。
- reader 先对全部 eligible Practices 聚合和排序，`K` 只在完整排序产生后应用；不再有"先取 20 再排 5"的候选池截断。benchmark harness 的候选宽度 `N` 只限制其报告的 candidate ID 数量，不改变参与打分的集合或最终排序。候选观察与快照 retry 语义保持不变。

身份、增量与迁移：

- `SEMANTIC_PROJECTION_VERSION = 4`、`SEMANTIC_QUERY_PROJECTION_VERSION = 2` 与 Profile identity 一起升级；`SEMANTIC_INDEX_VERSION` 保持 3（行结构未变），但 `view_kind` 约束改为 `full | task-card | body`。旧单向量 index、旧 v2 多视角 index 与 v3 的 `applicability/topic/guidance` index 都不是兼容项，状态为 incompatible，后续 build 从完整 snapshot 原子重建。
- 视图文本按**估算 token 预算**切分，而不是字符数：中文约 1 token/字，其它文本约 0.25，按字符切会让中文提前约四倍撞上模型上下文。Engine 没有自己的 tokenizer，因此使用保守估计并在 projection 中固定预算。
- schema 以 `(practice_id, view_id)` 标识向量行，并持久化 view kind/ordinal 与 digest；普通关系读写继续使用 Drizzle。
- 增量 build 以每个 view 的 projection digest 复用未变化向量；正文只改一个局部块时，未变化的 full/task-card/body views 仍可复用，但文档级 digest 与目标 snapshot 必须更新。
- ProjectContext progress、完整 artifact、Store-local semantic index 与共享 vector cache 都使用相同的 view digest 身份，不能把旧单向量缓存冒充新 view 向量。

## Risks / Trade-offs

- **把旧 top-k 冒称为候选名单** → 先实现和验证 N/K 独立边界，再连接 harness。
- **重试导致候选/最终结果来自不同 snapshot** → 在同一 query attempt 捕获两份名单；snapshot retry 丢弃前次诊断并测试。
- **协议错误被记成召回/排序失败** → benchmark scorer 将失败状态、名单重复、不完整输出和 final 不属于 candidate 归为运行/协议错误。
- **CLI 观察与 harness trace 被误当成同一请求** → 将 CLI IDs 记录为独立产品路径观察；只有 harness 响应用于 candidate-vs-final 归因。
- **诊断意外扩大 CLI/公开 API** → 候选名单只由本地测试 harness 暴露；CLI 只运行现有正常路径。
- **测试私有数据或工件留在提交中** → 隔离 worktree/Store 明确标记 test-owned，并列入 merge 前清理验证。
- **局部高分来自例子、反例或否定条件** → view 必须保留所属标题与完整语义单元；benchmark 回读 canonical 原文与实际适用条件，不把高分当成建议适用。
- **块数机会偏差** → 同一 Practice 内按 query view 取 `max`，块数不能线性抬高分数；但 `max` 仍有"块越多越容易碰到一次高分"的机会偏差，因此仍记录 view 数、命中 kind/ordinal 与 chunk size，并在 benchmark 回读原文上下文。
- **词面通道换载体回流** → 关键词表切 query 字段、手工字段权重表、裸 id/slug 进入 embedding 都会让 semantic 路径重新变成关键词检索。以语义角色为键、禁止清单、id 不进入文本作为约束，并在测试中覆盖"只命中 topic 不能取胜"与"CJK 不被字符预算截断"。
- **估算 token 预算不准** → 估计值比真实 tokenizer 保守，只用于避免超出模型上下文，不参与打分；真实 token 计数仍由 embedding runtime 决定。
- **多视角增加编码、存储与查询成本** → 分开记录 build embedding 次数、index 行数/体积、query embedding 次数与全量点积耗时；不以 97 条样本推断生产延迟。
- **clause 聚合没有语义角色** → clause 拆解没有 `intent`/`moment` 角色，单次聚合只能靠"每个 clause 的余弦都要计入平均"这一约束；不得据此宣称某个手工权重最优，也不得把聚合分数当成已校准的相关性概率。任何额外的跨-clause 惩罚项（如最弱-clause 混合）必须先做单变量对照，因为实测它会连正确 Practice 一起压低。
- **轮次绝对分不可比** → 不同 clause 的余弦尺度不同，合并只看每轮名次；不得把跨轮绝对分数直接相加，也不得沿用旧实际余弦阈值。
- **多轮/名次融合会丢掉向量相似度** → reciprocal rank fusion 只吃名次，等于用相对排序替代余弦；而且轮数多的族会淹没轮数少的族。历史上 §16–§18 的二层 RRF 组合即因此被撤回；若将来重新引入任何多轮机制，必须重新论证它仍在做向量检索，而不是换成另一套排序算法。
- **旧 index 被误当成多视角表示** → Profile/document projection/index version 同步升级；旧 artifact 状态为 incompatible，完整重建失败时保留旧文件但不得查询为当前结果。

## Migration Plan

1. 将 semantic projection 拆为 `task-card` 与带标题路径的 `body` views；去掉进入 embedding 的裸 id/slug 与字段标签，按估算 token 预算切块，并让 view recipe 与 digest 进入 Profile。
2. 将 persisted vector schema 改为 `(practice_id, view_id)`，同步 Store-local index、ProjectContext complete/progress artifact 与 shared vector cache。
3. 增量 build 按 view digest 复用；Profile/index version 升级后，旧单向量 index 必须重建。
4. reader 先按 clause 拆 query、在同一 Practice 内平衡 task-card/body，再按 query view 权重把这几个 clause 分数加权平均成一个 Practice 分数；全量 eligible Practice 排序后才应用 `K`，canonical assembly 与 snapshot retry 保持不变。整个打分只发生一次，没有轮次、RRF、槽位或额外的跨-clause 惩罚项。
5. 运行 migration、focused Engine/ProjectContext tests、package tests、typecheck、lint 与 OpenSpec strict validation。
6. 在新的冻结 build 上运行相同模型、query/Pack、N/K、scorer 与环境的 benchmark；Profile 本就随表示改变，因此 baseline 用旧 Profile 的 artifact、新 build 用新 Profile 的 artifact，两侧分别记录 Profile ID 与 corpus digest，报告 candidate recall、final ranking、scope error、chunk/view 成本和失败反例；不得把本轮与旧 BM25 build 的收益合并陈述，也不得宣称“同一 Profile”下对比。
7. 自动 query clause 拆解与按名次的轮次合并已进入默认路径；下一步可把 `intent`/`moment`/`artifact`/`constraints`/`domain` 做成独立 query views，让每轮带语义角色并支持按轮加权，但不得把该实验写成当前产品默认或宣称某个手工权重最优。

归档顺序：本 change MUST 在 `add-project-context-packs` 之后归档，因为两者都 MODIFY `Build and rebuild preserve consistency`，且本 change 的版本已包含该 change 的完整文本。

## Open Questions

benchmark 仓库的关联 Issue/OpenSpec、案例 schema 和记录契约由其实施计划处理；本 change 仅定义主仓库的 harness 依赖边界。若 benchmark 无法固定有效的 Pack/Store 或 checkout identity，先暂停正式 baseline，不退回读取用户 Store。

## 方案 C：角色对齐的隔离验证路线（2026-10-03）

本节只补充后续实验规划，不更改本 change 的生产向量聚合合同。§21–24 的证据与公式冻结仍有效；开头 Context/早期候选池、FTS5 与 rerank 描述属于演进起点，不能作为恢复这些路径的授权。当前执行边界以本 change 的 retrieval-query delta、后续单次全量决策与生产公式 pin 为准。

详细研究方案见 [角色对齐检索与受控学习验证路线](../../../docs/research/role-aligned-retrieval-plan.md)。它记录假设、归因条件、标注协议、增长压力、成本及阶段门槛，不定义新公共 API 或当前产品行为。

- 首先做 G0/G1：控制组逐分复现、有来源的人工 query 角色，以及现有文档 views 上的隔离余弦交互。所有 eligible Practice 评分一次、K 最后应用；检索前不读 labels。
- 分离 query 表示、交互聚合、文档表示与自动 analyzer 的介入条件；新增文档角色只能在单独条件中编码。共享策略不使用 Pack/Practice ID 特征，不增加词面、RRF、多轮或候选截断。
- 允许未知与缺失角色；`stage` 自由字符串及自由 Markdown 不提供统一阶段或正文角色保证。必要条件不得仅因不是动作就降权。来源与版本可追溯，但推断不当作 canonical 事实。
- 现有 50 例仅承担开发/回归；新 pilot 采用独立版本标注，保留未判定与评审分歧。不得改 v2 gold 或把可替代项追加到要求全部命中的 coreIds。
- 人工角色无收益则停止自动化投入；有收益再验证内容增长、新 Pack/语言与自动化损失。门槛和运行成本预算须在新测试评分前冻结。
- 不修改 `scoreSemanticPractice`、golden pin、公开 schema、持久化 Profile 或 active index。接入生产、Profile 身份解耦、持久化新 views、模型替换和反馈学习发布均需另行设计批准。
- 首轮不实施自学习闭环，不自动收集/上传用户日志，不承诺自动适配所有领域或无限容量。仅规划产物完成不能勾选实验通过或生产接入任务。

### G0 登记结果（2026-10-08）

- 实验协议、manifest 字段、角色样本格式、单一候选策略 `role-aligned-policy/1`、新增 pilot 标注协议与成本预算 `role-aligned-cost-budget/1` 登记在 [G0 协议](../../../docs/research/role-aligned-g0-protocol.md)；实现位于 `packages/backend/src/benchmark/role-aligned/`，只是 benchmark 内部工具，不进入包 exports、CLI 或 Backend API，不改变本 change 的生产向量聚合合同。
- 评分阶段在 manifest 状态为 complete 且全量排名与逐对比对产物的 digest 吻合之前不读取 labels；输入缺失/不一致/损坏、运行失败、协议违规与评分不一致都是实验错误，不会被计为检索 miss。
- G0 通过只说明实验基础可重放、可归因，不说明方案 C 有效；G1 仍需独立来源的角色标注与新 pilot，且须另行确认后开始。
