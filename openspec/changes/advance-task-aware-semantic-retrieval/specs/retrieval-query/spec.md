# Spec Delta

## ADDED Requirements

### Requirement: Task and stage oriented semantic relevance
semantic retrieval SHALL 以调用方自然语言 query 表达的当前任务作为有限结果的首要相关性信号，并依次考虑当前阶段、对象与约束；仅领域、技术栈或实体背景的相似性不得单独压过任务或阶段不匹配的 Practice。调用方 MUST 不必提交 `intent`、`stage`、`domain` 或任何其他结构化 query 字段；Practice 的 Markdown body MUST 继续按自由文本处理。

#### Scenario: Task-specific review outranks domain-only guidance
- **WHEN** 一个 query 表达“对 Registry source 和本地 Pack 安装改动做提交前减法 CR”，且同一完整候选集中同时存在能完成该 review 的 core Practice 与仅匹配发布、安装路径验证或 discovery 背景的 Practice
- **THEN** semantic retrieval SHALL 将 core review Practice 排在每个仅领域相似但任务或阶段不匹配的 Practice 之前

#### Scenario: Same domain has different current stages
- **WHEN** 两个 eligible Practice 讨论同一对象或技术栈，而 query 明确表达其中一个 Practice 的当前阶段
- **THEN** semantic retrieval SHALL 优先返回阶段匹配的 Practice，而不是仅因共享领域词返回另一个阶段的 Practice

#### Scenario: Chinese task query can retrieve English task guidance
- **WHEN** 中文 query 表达的当前任务与一个英文 Practice 的任务或阶段匹配，而另一个 Practice 只共享领域背景
- **THEN** semantic retrieval SHALL 将英文的任务匹配 Practice 排在该领域背景 Practice 之前

### Requirement: Candidate collection is distinct from final result limit
semantic retrieval SHALL 在完成最终任务感知排序前使用内部候选集合；当 compatible active index 中存在额外 eligible Practice 时，候选收集 MUST 不被调用方请求的最终 `top-k` 直接截断。系统 SHALL 只向调用方返回最多 `top-k` 个 canonical Practice summary，并且 MUST 不在既有结果 envelope 中暴露内部 score、候选来源、query 内容或 Practice 正文。

#### Scenario: A lower raw candidate becomes the final task match
- **WHEN** 调用方请求 `--top-k 1`，候选集合中包含一个仅领域相似的 Practice 和一个经任务/阶段排序后更相关的 core Practice
- **THEN** 系统 SHALL 先完成对两者的最终排序，并只返回该 core Practice 的 canonical summary

#### Scenario: Final result remains bounded and private
- **WHEN** semantic retrieval 使用超过最终 `top-k` 的内部候选集合成功完成
- **THEN** public result SHALL 至多包含请求数量的 Practice summary，且不新增内部排名诊断字段

### Requirement: Bounded lexical evidence preserves candidate observation
semantic retrieval SHALL 使用同一次 query attempt 的 canonical 内容计算辅助词面证据；MUST 在最终排序前完成所有候选的 canonical digest 校验，并按 reader 顺序保留内部候选观察名单。query 中的普通代词 MUST 不因技术复合词被拆分而获得匹配证据，近同分且有效匹配词数相同的候选 MUST 不因候选池极值归一化而获得最大幅度的加分差。部分匹配的唯一候选 MUST 不仅因为唯一命中而获得满额词面加分。计算已选排序所需的能力失败时 MUST 返回既有 typed query failure，不成功返回未声明的替代顺序。

#### Scenario: Reader order differs from final order
- **WHEN** 两个候选完成同一 snapshot 的 canonical 校验，且辅助排序改变它们的顺序
- **THEN** 内部 candidateIds SHALL 保持 reader 顺序，finalIds SHALL 使用最终顺序，且都只属于成功 attempt

#### Scenario: Technical compound is not a pronoun match
- **WHEN** 普通代词与 Practice 中技术复合词的某个拆分片段相同，而复合词本身没有被 query 提及
- **THEN** 系统 MUST 不把该片段作为当前任务的词面匹配，但明确请求该技术复合词时仍可匹配

#### Scenario: Weak partial match does not become full evidence
- **WHEN** 一个候选只匹配有效 query 的部分词，且它是唯一词面命中
- **THEN** 词面增强 SHALL 受有效匹配词证据约束，不得仅因候选池中没有其他命中而取满额

#### Scenario: Signal failure does not return a hidden alternative ranking
- **WHEN** 当前请求需要计算辅助词面信号，但排序所需的 FTS 能力不可用
- **THEN** query SHALL 返回既有 typed failure，内部 harness SHALL 不返回任何候选或最终名单

#### Scenario: Unmatched background does not dilute existing lexical evidence
- **WHEN** query 追加了一组对同一候选池的任何文档都不匹配的背景词，候选与原匹配保持不变
- **THEN** 既有候选的词面强度 SHALL 保持不变，而不因 query 变长被降低
