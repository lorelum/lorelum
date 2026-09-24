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
