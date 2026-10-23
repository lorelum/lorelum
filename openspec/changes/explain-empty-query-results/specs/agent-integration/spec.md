## ADDED Requirements

### Requirement: Agents consume successful empty results without blind diagnosis

portable 和官方宿主 Skill SHALL 先区分 ready、pending 和 error，仅在成功空结果时结合 `empty`、原 mode/coverage/context warnings 理解边界。首选 SHALL 补充决策、约束和技术上下文，改写一次；MUST 不把改写说成补充 corpus，也不得无新事实机械重试或自动运行 status 序列。

只有用户明确怀疑知识源缺失时才建议检查 Pack。另一模式 MUST 由用户意图或 Host policy 明确允许，且符合既有 mode contract，不作为自动 fallback；取得候选后仍 MUST 用 get 读 canonical 全文。

#### Scenario: Keyword miss

- **WHEN** Skill 收到 keyword ready empty explanation
- **THEN** 它 SHALL 优先具体化任务，不自动诊断、切换模式或声称没有安装知识

#### Scenario: Partial, degraded or proven empty corpus

- **WHEN** empty result 有 partial coverage、context warnings 或 `corpus-empty`
- **THEN** Agent MUST 保留相应事实，不说成完整无匹配，不宣称改写会增加知识或循环重放查询

#### Scenario: Explicit source or mode intent

- **WHEN** 用户明确怀疑来源缺失，或用户/Host policy 在原 mode contract 范围内明确允许另一模式
- **THEN** Skill SHALL 可分别建议检查已安装 Pack或显式选择 mode，不自动安装或把后一次结果伪装成原查询结果
