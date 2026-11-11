# Spec Delta

## ADDED Requirements

### Requirement: 任务关键节点的指导发现和应用

Lorelum Skill SHALL 指引 Agent 在作出设计决策、规划完成后的首次实施修改、测试设计或编写、首次确定测试运行方式、失败后的诊断或返工决策及验收决策之前，结合当前任务判断是否缺少适用指导；适用节点的顺序由实际工作决定，测试先行时测试节点 MAY 先于实现。缺少且需发现指导时 MUST 执行针对当前问题的 semantic query；已知精确 Practice ID 但未完整读取时 MUST 在采用前 get，全新发现的候选也 MUST 完整读取后采用。完整指导仍可用且适用时 MUST 复用；任务范围、环境或已知 Pack 版本变化时 MUST 重新判断，不得机械重复已完成的查询。到达节点时需要的指导不得只留为后续 todo 而先跨过决策。

无计划或无任务工具时，Skill SHALL 仍在实际相关节点执行上述判断，不得仅为 Lorelum 新建计划。只要求分析或规划时 MUST NOT 因这些节点而执行未授权的实现或测试。无结果、准备中和失败 MUST 按既有合同区分；无法取得用户明确要求的规范时 MUST NOT 声称已满足，独立且有充分依据的工作 MAY 继续。Practice MUST NOT 扩大用户授权，不适用、失效或冲突的指导 MUST NOT 被强制执行。

#### Scenario: 规划完成后开始编码
- **WHEN** Agent 完成规划并准备对当前工程作首次实施修改
- **THEN** Agent MUST 判断项目、语言、模块及该变更的指导是否充分；缺少且需发现时先针对具体决策 query，读取将采用的 Practice 全文，并在实施中应用适用约束

#### Scenario: 测试设计、运行和验收的独立决策
- **WHEN** Agent 准备设计或编写测试、首次选择运行方式或确定验收策略
- **THEN** Agent MUST 分别判断该节点是否需要测试约定、数据与执行环境或验收边界指导；缺少时按需查询和完整读取，已有适用全文时复用，不得仅在测试完成后补查

#### Scenario: 检索结果不适用或不可取得
- **WHEN** 检索没有相关结果、尚在准备中或失败，或找到的指导与用户授权冲突
- **THEN** Agent MUST 区分状态、遵循现有恢复合同并保护用户数据；不得捏造指导或强制执行未经授权的动作

#### Scenario: 任务变化或指导更新
- **WHEN** 实际范围、语言、运行环境或已知指导版本变化影响后续决策
- **THEN** Agent MUST 重新判断相关指导是否仍适用，必要时读取当前全文或查询新增问题，不得仅因过期提醒重复已完成的原查询

#### Scenario: 已读指导覆盖相邻决策
- **WHEN** 一份已完整读取的适用指导同时覆盖测试设计与首次实施等相邻决策
- **THEN** Agent MUST 在每个相关决策前判断其适用性，MAY 复用该指导，MUST NOT 仅为逐一经过节点重复相同 query

#### Scenario: 项目测试失败
- **WHEN** 项目的测试或其他非 Lorelum 命令失败，Agent 准备诊断或返工
- **THEN** Agent MUST 基于该失败及当前任务判断指导缺口，不得将项目故障当作 Lorelum 调用故障或为其臆造 `diagnostics.traceId`

### Requirement: 任务计划中的 Practice 指导与检索提醒

当 Agent 使用原生任务计划工具，且已完整读取一条会实质影响当前尚未完成或后续步骤的适用 Practice，Lorelum Skill SHALL 指引 Agent 在继续相关工作前将 Practice 标识和该节点应应用或检查的具体指导写入计划：建立步骤时已知指导则直接写入；计划已存在时优先注释对应步骤，工具不能安全注释时追加一条关联该步骤的简短具体检查项。检查项 MUST NOT 重复实施任务或泛称应用 Practice。Agent 到达节点时 MUST 按当前适用性、用户授权和更高优先级指令判断并检查实际工作。提醒 MUST NOT 把 query 摘要或历史候选当作完整指导，MUST NOT 覆盖、删除其他任务或重置其状态。

当宿主不能读取现有任务或不能安全合并与保留其状态时，Skill MUST NOT 为添加提醒整体替换计划；Agent SHALL 在工作上下文承接该节点指导。追加项若显示在目标步骤之后，MUST 标明实际前置时机，且不得因显示顺序已到末尾才进行原本应在实施或验收前完成的检索。

当计划中可预见的后续实质性决策尚需指导，Lorelum Skill SHALL 指引 Agent 在相应节点记录与当前任务有关的具体检索问题和时机；已知相关 Practice 标识但尚未完整读取时 MAY 记录在该节点先 get。到达节点时 Agent MUST 结合当前任务和已有指导判断是否仍需检索，需发现新指导时按现有 semantic-first 合同查询，并在采用结果前完整读取。已经完成的 query MUST NOT 再写为待办；Skill MUST NOT 为每次编码、测试或普通低风险工作机械要求查询。

Skill MUST NOT 仅为添加 Lorelum 提醒而要求创建计划或假定特定宿主工具、跨会话持久性。无可用工具、当前无计划或无合理节点时，Agent SHALL 沿用既有 query/get 流程。query 失败或准备中 SHALL 按现有恢复合同处理，不得视为无结果。

#### Scenario: 已读指导适用于后续实施
- **WHEN** Agent 完整读取适用于计划中后续实施步骤的 Practice
- **THEN** Agent MUST 在创建步骤时写入具体指导，或在既有对应步骤安全注释；无法注释时追加关联该步骤的具体检查项，到达该步骤时检查并应用，不得复制实施任务或覆盖其他任务

#### Scenario: 未来实现或验收决策需要检索
- **WHEN** 使用现有计划的 Agent 可预见开始实现或确定验收策略时存在尚需指导的具体实质性决策
- **THEN** Agent MUST 将与该任务相关的检索问题及节点时机写入对应步骤，或在无法安全注释时追加关联该步骤的具体检查项；到达节点时根据当前情况判断是否仍需检索，适用时先 query、完整读取将采用的 Practice，再用于后续工作

#### Scenario: 已有检索结果或任务发生变化
- **WHEN** 到达提醒节点前相关检索已完成，或任务变化使原问题不再适用
- **THEN** Agent MUST 根据当前上下文处理该提醒，不得仅因旧提醒重复已完成的 query 或强制采用不适用指导

#### Scenario: 没有任务工具或计划
- **WHEN** 当前宿主没有可用任务工具或当前任务没有计划
- **THEN** Agent MUST NOT 仅为 Lorelum 创建计划，并 SHALL 沿用既有检索与读取流程

#### Scenario: 发现指导不适用或冲突
- **WHEN** 计划提醒引用的 Practice 不适用于当前任务或与用户授权或更高优先级指令冲突
- **THEN** Agent MUST 不强制应用它，并按照当前任务更新或完成相关步骤

#### Scenario: 查询尚未准备或失败
- **WHEN** 计划节点的 semantic query 返回准备中或失败
- **THEN** Agent MUST 遵循现有恢复合同，不将其记作无相关指导或自动降级 keyword

## MODIFIED Requirements

### Requirement: Catalog-aware targeted retrieval
CLI-first 集成的 Skill SHALL 将已提供的 Installed Pack Catalog 仅作为 routing metadata，而不得将其当成完整 Practice 内容或不存在相关 guidance 的证明。generic Skill 需要发现尚未知晓的指导而任务上下文没有可用 Catalog 时 MUST 执行一次 `lore pack list --details` 并在当前任务复用结果；通过宿主 SessionStart Hook 注入 Catalog 的 Skill MUST 复用它而不得重复 list。仅需读取已知精确 Practice ID、没有其他发现需求时 MUST NOT 仅为该读取建立 Catalog。Hook MUST 保持 metadata-only，且不得自动执行 `lore query` 或 `lore get`。当 Skill 判定 material task、decision、verification、recovery 或 completion moment 需要发现尚未知晓的指导时，MUST 先执行一次针对该缺口的 targeted natural-language semantic query；已知需要读取的精确 Practice ID 时 MAY 直接 get，但若仍需发现其他指导 MUST 针对缺口执行 semantic query。准备使用某个 Practice 前 MUST 读取其完整内容。

Cursor 的 `sessionStart` Hook 是 fire-and-forget，宿主不保证注入的 Catalog 在首个 turn 前可见。因此 Cursor 集成的 Skill SHALL 把「Hook 已注入可用 Catalog」作为条件而不是前提：仅当当前任务上下文实际含有可用的 Installed Pack Catalog 时才进入复用路径；需要发现指导且 Catalog 缺失或不可见时，该 Skill MUST 按 generic Skill 规则为当前任务执行一次 `lore pack list --details`，且该行为 MUST NOT 被视为违反复用纪律。

#### Scenario: Generic Skill establishes a missing Catalog once
- **WHEN** generic Skill 的当前任务上下文没有可用的 Installed Pack Catalog，且当前决策需要发现尚未知晓的指导
- **THEN** Skill MUST 只执行一次 `lore pack list --details` 建立 Catalog，并在后续普通编辑、命令或回复前复用它

#### Scenario: Codex reuses Hook-injected Catalog
- **WHEN** Codex Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达需要发现未知指导的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: ZCode reuses Hook-injected Catalog
- **WHEN** ZCode 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达需要发现未知指导的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Cursor reuses a visible Hook-injected Catalog
- **WHEN** Cursor 的 `sessionStart` Hook 注入的 Installed Pack Catalog 实际出现在当前任务上下文中，且 Skill 到达需要发现未知指导的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Cursor establishes the Catalog when injection is absent
- **WHEN** Cursor 会话的任务上下文中没有可见的 Installed Pack Catalog（Hook 未注入、注入延迟或被截断），且 Skill 需要发现未知指导
- **THEN** Skill MUST 为当前任务执行一次 `lore pack list --details` 并复用结果，且该行为 MUST NOT 被判定为违反复用纪律

#### Scenario: WorkBuddy reuses Hook-injected Catalog
- **WHEN** WorkBuddy 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达需要发现未知指导的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Claude Code reuses Hook-injected Catalog
- **WHEN** Claude Code 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达需要发现未知指导的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Exact Practice is known but coverage remains uncertain
- **WHEN** Agent 知道一个需要采用的精确 Practice ID，但尚未完整读取，且当前决策仍有未知指导缺口
- **THEN** Agent MAY 直接 get 该 ID，但 MUST 另行针对未知缺口 semantic query，并在采用任何候选前完整读取

#### Scenario: Exact Practice is known and no discovery is needed
- **WHEN** Agent 只需读取已知精确 Practice ID，且当前决策没有其他未知指导缺口
- **THEN** Agent MAY 直接 get 该 ID，MUST NOT 仅为读取它执行 semantic query 或建立 Catalog，并 MUST 在采用前读取全文
