# Spec Delta

## ADDED Requirements

### Requirement: 任务计划中的已读 Practice 提醒

当 Agent 使用原生任务计划工具，且已完整读取一条会实质影响后续步骤的适用 Practice，Lorelum Skill SHALL 指引 Agent 将 Practice 标识和该节点应应用或检查的具体指导写入计划：建立步骤时已知指导则直接写入；计划已存在时优先注释对应步骤，工具不能安全注释时追加一条关联该步骤的简短具体检查项。检查项 MUST NOT 重复实施任务或泛称应用 Practice。Agent 到达节点时 MUST 按当前适用性、用户授权和更高优先级指令判断并检查实际工作。未来决策尚需检索时 MAY 记录具体问题及检索时机；已经完成的 query MUST NOT 再写为待办。提醒 MUST NOT 把 query 摘要或历史候选当作完整指导，MUST NOT 覆盖、删除其他任务或重置其状态。

Skill MUST NOT 仅为添加 Lorelum 提醒而要求创建计划或假定特定宿主工具、跨会话持久性。无可用工具、当前无计划或无合理节点时，Agent SHALL 沿用既有 query/get 流程。query 失败或准备中 SHALL 按现有恢复合同处理，不得视为无结果。

#### Scenario: 已读指导适用于后续实施
- **WHEN** Agent 完整读取适用于计划中后续实施步骤的 Practice
- **THEN** Agent MUST 在创建步骤时写入具体指导，或在既有对应步骤安全注释；无法注释时追加关联该步骤的具体检查项，到达该步骤时检查并应用，不得复制实施任务或覆盖其他任务

#### Scenario: 没有任务工具或计划
- **WHEN** 当前宿主没有可用任务工具或当前任务没有计划
- **THEN** Agent MUST NOT 仅为 Lorelum 创建计划，并 SHALL 沿用既有检索与读取流程

#### Scenario: 发现指导不适用或冲突
- **WHEN** 计划提醒引用的 Practice 不适用于当前任务或与用户授权或更高优先级指令冲突
- **THEN** Agent MUST 不强制应用它，并按照当前任务更新或完成相关步骤

#### Scenario: 查询尚未准备或失败
- **WHEN** 计划节点的 semantic query 返回准备中或失败
- **THEN** Agent MUST 遵循现有恢复合同，不将其记作无相关指导或自动降级 keyword
