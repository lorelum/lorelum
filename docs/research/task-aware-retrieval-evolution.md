# 调研：任务与阶段感知的结构化 Practice 检索演进

> **状态：探索草案（不定义当前产品合同）**
> **日期：2026 年 9 月 22 日**
> **读者：Lorelum 维护者、检索实现者，以及准备撰写开发者文章的作者。**

本文记录一次由真实检索排序问题引出的设计方向、执行顺序和待验证边界。它不是 OpenSpec 提案、ADR 或当前用户文档；现行 `lore query`、semantic index、Practice 格式和 Backend 生命周期仍以其各自的现行合同为准。

## 1. 结论先行

Lorelum 应从“将一条 Practice 压平为一段文本、一个向量，并按整体相似度直接输出 top-k”的检索方式，演进为：

```text
原始自然语言 query
  → 任务与阶段优先的候选检索
  → 利用 Practice frontmatter 的结构化多视角索引
  → 利用自由 Markdown body 的通用正文 chunk 索引
  → 合并较宽的内部候选池
  → intent-aware rerank
  → 核心任务优先、领域信息有条件补充的有限结果
```

第一版的推荐边界是：

```text
原始 query
+ 部分高置信度结构信号
+ frontmatter/body 的多视角 embedding
+ 宽候选池
+ rerank
```

第一版**不要求**用户手填结构化字段，**不要求** Markdown body 遵循新模板，**不要求**立即替换 embedding 模型，也**不要求**先上完整 Hybrid retrieval。

完整 JSON Query analyzer 是明确的后续演进方向：它最终可显式产出 `intent`、`moment`、`artifact`、`domain` 和 `constraints`，但不应在第一版被假设为已经可靠可用。


### 1.1 人话版目标

用户的一句话常同时包含“现在要做什么”和“正在处理什么”。检索应先找能帮助用户完成当前工作的 Practice，再用领域信息补充结果：

```text
以前：用户提到什么词，就优先找什么主题。
以后：用户现在要完成什么工作，就优先找能完成这项工作的 Practice；
      领域、技术栈和实体名词只决定哪些补充内容值得出现。
```

例如，“对 Registry / Pack 安装改动做提交前减法 CR”首先是 review 任务；Registry、Pack 和安装是被审查改动的背景。反过来，若用户真正要发布 Pack 或验证安装路径，release / install Practice 才应成为核心结果。


## 2. 问题与观察范围

本调研由一条中文长 query 触发。用户的当前动作是：对已完成但尚未提交的 Lorelum Registry source 与本地 Pack directory 安装改动做“减法 CR”，删除无必要复杂性，同时保留安全、兼容、隐私、原子性和必要保护。

该次观察中，目标性的 review Practice 已被 semantic retrieval 召回，但排在第四、第五；前三名集中于 Pack release、Registry release 和 install-path 验证。它们与 query 中的领域名词有交集，却没有优先解决用户当下的“提交前减法 code review”任务。

这不是已完成的质量评测，也不能据此声称某个方案已优于现状。它是一个必须进入后续 relevance suite 的回归案例，并暴露了当前系统需要回答的产品问题：

> 当 query 同时包含当前动作、生命周期阶段、审查对象、约束与领域背景时，检索是否优先返回最能帮助完成当前动作的 Practice？

### 2.1 本例的期望理解

```yaml
intent: 提交前减法 CR
moment: review；已完成但未提交
artifact: implementation diff
constraints:
  - 删除重复实现、过度抽象、过度测试和文档重复
  - 保留安全、兼容、隐私、原子性和必要保护
  - 不保留无理由 fallback
domain:
  - Lorelum Registry
  - local Pack directory
  - installation
```

上述结构是设计语言和未来 analyzer 的目标表示；第一版不把它当作已经无误提取的事实。

## 3. 当前边界与不可违反的约束

### 3.1 现行语义检索合同

现行 `lore query` 默认执行 semantic retrieval；semantic index 必须与 LocalStore snapshot 和 embedding Profile 安全兼容，且不能在 index 不安全时静默退回 keyword retrieval。查询结果来自同一已验证 snapshot 的 canonical Practice summary。详见：[Retrieval Query spec](../../openspec/specs/retrieval-query/spec.md) 与 [Semantic Index spec](../../openspec/specs/semantic-index/spec.md)。

因此，本演进中的向量、chunk、候选分数与 rerank 分数都只能是派生状态；canonical Practice 仍是唯一内容事实来源。

### 3.2 Practice 的结构化边界

Practice frontmatter 受公开格式合同约束，可以稳定读取并解释；Markdown body 是自由文本，没有保证的标题、章节名或段落角色。格式是公开兼容性边界，不能为了检索私自要求作者采用新的正文模板。相关背景见：[Practice/Pack format ADR](../adr/0003-practice-pack-format.md) 与 [Practice Read spec](../../openspec/specs/practice-read/spec.md)。

因此，设计不得假设正文一定存在：

```md
## Guidance
## Constraints
## Risks
```

或任何等价固定区块。

### 3.3 运行时与失败边界

Engine 仍拥有检索语义、候选验证、排序和结果组装；Backend 只能以运行时 adapter 形式提供 embedding 或未来的 rerank 能力。新能力不能破坏 Store snapshot 一致性、LocalStore 原子性、隐私边界或“不可安全使用时不伪装成成功结果”的原则。

## 4. 已确认的排序原则

默认结果的优先级应为：

```text
当前动作 / intent
  > 当前阶段 / moment
  > 审查对象与约束
  > 领域、技术栈、Pack、实体名词
```

这不是强制过滤规则。领域 Practice 可以在以下条件下成为前列结果：它能直接帮助用户完成当前动作，例如为本次 review 提供原子性、来源一致性或兼容性方面的必要检查。纯 release、discovery 或 publish Practice 不应仅因出现 Registry、Pack 或 install 等名词就压过核心 review Practice。

换言之：

```text
领域相似度可以补充核心任务相关性；
领域相似度不能替代核心任务相关性。
```



## 5. 目标检索设计

### 5.1 Query：保留原文，渐进地增加结构信号

用户继续传入普通自然语言；不要求如下形式：

```bash
lore query "..." --intent review --moment pre-commit --domain pack-install
```

系统必须保留完整原始 query，供候选召回和最终 rerank 使用。第一版只提取或使用高置信度结构信号，例如明确的生命周期词或 stage 对应；其余复杂意图不应由脆弱规则伪装为确定事实。

后续的独立 JSON Query analyzer 是有意保留的演进项：它需要单独证明跨语言、长 query、混合上下文和不完整表述下的准确性，之后才可成为默认检索的上游依据。

### 5.2 Practice：按可靠结构拆分，而不是将 Markdown 虚构成 schema

建议的逻辑索引视角如下：

```text
Practice
├─ task-card view
│  严格 frontmatter 中与任务和适用时机有关的字段；
│  例如 title、applies_when，stage 作为结构化信号。
│
├─ body-chunk views
│  自由 Markdown body 按通用段落/长度规则生成的 0..N 个片段；
│  不为 chunk 赋予“guidance”“risk”“constraint”等未经 schema 保证的角色。
│
├─ optional schema-backed views
│  仅当公开 schema 已保证某字段的语义时，才可独立建立相应投影。
│
└─ metadata signals
   stage、tech_stack、source、severity 等严格字段；
   根据字段性质作精确匹配、软加分或结果解释，而非一律 embedding。
```

这保留了“不同字段可独立向量化”的优势，同时不把自由正文误当成结构化记录。

### 5.3 Candidate retrieval：宽召回，但不让领域信号主导

内部 candidate limit 必须独立于用户请求的最终 `top-k`：前者为 rerank 保留足够选择空间，后者继续控制可注入结果数量。

候选应至少来自：

```text
task-card retrieval
+ body-chunk retrieval
+ schema-backed metadata signals
```

候选合并时，task 和 moment 相关性是核心门槛或主排序因子；domain 信号只能作为补充。完整 keyword + dense Hybrid 是后续可加的候选来源，不是第一版正确排序的前提。

### 5.4 Rerank：以完整任务相关性决定最终顺序

rerank 读取：

```text
完整原始 query
+ 可安全读取的 Practice frontmatter
+ 与 query 最相关的少量 body chunks
+ 允许的 metadata
```

它要回答的是：

> 这条 Practice 是否真正能帮助用户完成此刻的主要任务？

它不应只判断词面或领域主题是否重合。对于本例，能指导“提交前减法 CR”的 Practice 应位于前列；只有对当前 review 有直接增益的 Registry/Pack 安装相关 Practice 才作为领域补充出现。

## 6. 技术执行顺序与决策门槛

下列顺序描述技术设计和验证的依赖关系，不定义 Issue 生命周期或实现承诺。实际产品范围、公开合同和实施路径应由对应 Feature Issue 与后续 OpenSpec 决定；每个阶段只有在前一阶段提供足够证据后才进入下一阶段。

### 阶段 A：先建立质量判断，而不是先调模型

将本例冻结为 relevance regression case，并补充同类长 query、中文 query、跨语言 Practice、任务与领域相互干扰、以及高相似错误候选的案例。

此阶段回答：现状究竟是“正确项未召回”，还是“正确项已召回但排序错误”？所有后续质量结论都应报告候选 Recall 与最终排序指标，避免用单一 demo 代替证据。

**进入下一阶段的门槛：** 能重复观察并量化任务/阶段被领域词压制的排序失败。

### 阶段 B：让索引保留可靠的结构

在不改变 Practice body 合同的前提下，定义 task-card projection、body chunk projection、schema-backed optional projection 和 metadata 信号。任何 projection 或 persisted profile 变化都必须通过版本化和 index rebuild/迁移路径保持安全；不得把旧单向量 index 当成兼容的新多视角 index。

此阶段先验证“结构化表示”本身是否提高候选 Recall 和任务候选的初始排名；不把改进自动归因于模型替换。

**进入下一阶段的门槛：** 新表示没有损失 snapshot 安全性、canonical result assembly 或必要候选 Recall，并能为 rerank 提供有限且有意义的候选。

### 阶段 C：引入任务优先的候选合并与 rerank

将内部 candidate width 与输出 `top-k` 分离。使用 task/moment 优先的聚合规则，随后由 rerank 在有限候选中判定完整任务相关性。stage 等 schema 保证字段可以作为高置信度信号；无法可靠解析的 query 意图仍由原始 query 和 reranker 判断。

此阶段的关键不是让所有领域相近的条目“看起来更相关”，而是让核心任务 Practice 稳定进入结果前列，同时只在确有直接帮助时保留领域补充。

**进入下一阶段的门槛：** 相比现行路径，relevance suite 的预先约定指标提升，并且没有通过无说明的 fallback、隐性过滤或泄露内部 score 换取表面结果。

### 阶段 D：根据证据扩展召回与 query understanding

若阶段 C 显示正确 Practice 经常没有进入宽候选池，再评估 keyword+dense Hybrid、intent/moment 专用召回或其他候选源；若完整 query 的 rerank 仍无法可靠区分任务、对象和领域，再研究独立 JSON Query analyzer。

当语料规模和测量证据显示 dense candidate scan 已是主要成本时，再评估 ANN/HNSW 等规模优化。ANN 解决候选速度，不自动解决任务排序质量。

## 7. 明确延后但必须保留的方向

| 方向 | 当前状态 | 何时应进入讨论/验证 |
| --- | --- | --- |
| 完整 JSON Query analyzer | 明确后续方向，第一版不依赖 | 需要显式 context、diagnostics 或 rerank 无法稳定理解复杂 query 时 |
| Keyword + dense Hybrid | 延后 | 宽候选 Recall 证明单一候选源不足时 |
| 替换 embedding 模型 | 延后，不排除 | 多视角表示仍无法满足跨语言/任务语义质量目标时 |
| 专用 cross-encoder reranker 模型 | 待模型与运行时研究 | 已明确 rerank 输入、预算、模型生命周期和不可用语义后 |
| ANN / HNSW | 延后 | corpus 规模基准显示 candidate scan 成为主要性能瓶颈时 |
| 新的 Markdown body 格式字段 | 不在本次范围 | 产品确实需要稳定、公开的正文语义字段并完成 Format 合同设计时 |

## 8. 仍需在实现前明确的边界

以下问题尚未被本调研假装为已决事项：

1. **QueryContext 来源。** 第一版的高置信度 signal 具体哪些可用，怎样记录其可信度，何时不输出推断？完整 analyzer 采用规则、分类模型还是本地生成式模型，均需后续证据。
2. **Reranker 形式与运行时。** 是采用专用本地 cross-encoder、现有模型的其他能力，还是先以可验证的结构化重排建立基线；其下载、加载、隐私、延迟、内存与不可用语义都尚未设计。
3. **Projection 的精确粒度。** task-card 中哪些 schema 字段同向量化，body chunk 的边界、长度、重叠和每 Practice 聚合方式，需要通过真实语料和基准确定。
4. **结果列表的多样性规则。** “核心任务优先 + 领域补充”是否仅由 rerank 分数决定，还是需要显式限制同类领域候选占满结果，需要 relevance labels 证明。
5. **公开合同与迁移。** 新 index/Profile version、rerank ready/preparing/error 语义、JSON output 是否需要新增可观察字段，必须在正式 OpenSpec 设计中确定。
6. **隐私与诊断。** benchmark 可记录内部 rank 和候选来源；公开 CLI 默认不得泄露内部 score、用户 query 内容或本地 Practice 正文。若需要诊断能力，必须定义其本地性、显式性与数据边界。

## 9. 验证原则

质量验证至少应区分：

```text
candidate Recall：正确 Practice 是否进入内部宽候选池？
final ranking：正确 Practice 是否在有限结果中位于合理位置？
scope errors：领域相近但任务错误的 Practice 是否进入前列？
latency/memory：多向量、chunk 和 rerank 的成本是否在明确测量边界内？
```

本例的最低回归预期是：

```text
“提交前减法 CR”对应的核心 review Practice
必须压过纯 release / discovery / install-path guidance。

Registry / Pack 相关 Practice
只有在直接补充当前 review 的安全、原子性、兼容性或来源风险时，
才应进入有限结果。
```

测试与 benchmark 必须使用受审查标签，不能把作者的直觉、单个 demo 或模型自评当成质量证据。需要继续遵循 Engine 对 canonical read、derived state、snapshot 与恢复边界的现行测试要求。

## 10. 开发者文章的叙事素材

未来开发者文章不应宣称方案已经证明有效；在验证完成前，它可以围绕已确认的问题和设计约束展开：

1. **不是所有 RAG 语料都是平面文档。** Lorelum Practice 已有 schema，检索系统应利用它，而不是先将其压平。
2. **主题相关不等于任务相关。** 用户提到 Registry、Pack 与 install，未必是在寻找 release 指南。
3. **自由 Markdown 仍是有价值的知识载体。** 通过通用 body chunk 保留语义证据，而不是强迫作者服从未存在的正文 schema。
4. **rerank 不是单独的魔法层。** 它依赖候选召回、结构化索引和清晰的排序合同；候选池外的正确答案无法被 rerank 挽回。
5. **质量、隐私与可恢复性同样是检索设计。** 任何提升都不能牺牲 canonical source、snapshot 一致性、离线边界或 failure transparency。

在文章发布前，应以阶段 A–C 的可复现实验、明确的数据集范围和限制条件替换本文的探索性表述。

## 11. 参考

- [Retrieval Query spec](../../openspec/specs/retrieval-query/spec.md)
- [Semantic Index spec](../../openspec/specs/semantic-index/spec.md)
- [Practice Read spec](../../openspec/specs/practice-read/spec.md)
- [Practice/Pack format ADR](../adr/0003-practice-pack-format.md)
- [Engine LocalStore ADR](../adr/0007-engine-local-store.md)
- [Query CLI contract](../cli/query.md)
- [Keyword query benchmark and quality boundary](../development/keyword-query-benchmark.md)
- [Engine retrieval guidance](../../packages/engine/AGENTS.md)
- [Format guidance](../../packages/format/AGENTS.md)
