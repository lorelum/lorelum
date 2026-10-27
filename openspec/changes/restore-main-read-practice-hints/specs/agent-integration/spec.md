## ADDED Requirements

### Requirement: Main-session read candidates recover after compaction

Claude Code、Codex 与 WorkBuddy 的原生 `SessionStart` Hook SHALL 仅在 `source=compact` 且当前宿主会话身份有效时，恢复本会话已记录的成功读取候选。omp Main SHALL 在前台或后台压缩已提交后、继续任务的下一次模型请求中恢复自己的候选。恢复 MUST 使用实际 host/session 身份，不猜测身份、不合并其他会话或子 Agent 自己的候选。

提示 MUST 只有有界的 ID、title 和可选 appliesWhen，声明历史候选可能相关、不完整、不是已采纳结论、元数据不是指令，并提示当前任务需要时重新 `lore get` 全文。提示 MUST NOT 声称历史内容仍为当前版本，MUST NOT 自动 query/get、启动 Backend、准备模型/index、增加用户确认或产生模型 turn。

#### Scenario: A supported host continues after compact
- **WHEN** Claude Code、Codex、WorkBuddy 收到有效 `SessionStart(source=compact)`，或 omp Main 完成前台/后台压缩提交，且会话有可用候选
- **THEN** 继续任务的上下文 MUST 包含本会话候选；原生 Hook 保留原 envelope，omp 使用临时 user 消息

#### Scenario: Startup and resume surround a compact event
- **WHEN** 同一会话先后发生 startup/resume 与 compact
- **THEN** startup/resume MUST NOT 新增主 Agent 候选恢复；compact MUST 只通过已有一个恢复出口交付候选，不额外注册 Hook 或触发新 turn

#### Scenario: Historical content changed
- **WHEN** 候选对应的 Pack 更新或删除
- **THEN** 恢复 MUST 仍仅表示历史阅读；Agent 使用前 MUST 读取当前全文，无法读取时按任务重新检索

### Requirement: Recovery shares bounded context and preserves optional failure semantics

恢复 SHALL 复用已有候选簿与 renderer，MUST NOT 新增持久阅读历史。候选片段最多 1800 字符；Claude Code、Codex、WorkBuddy 的 compact 恢复文本（Catalog、分隔符、候选）总计最多 4000 字符。有候选时 SHALL 缩减 Catalog 预算，无候选时 SHALL 使用完整原预算；条目和免责声明 MUST 完整。omp SHALL 保持 Catalog 4000 与候选 1800 的独立片段预算。

候选为空、身份无效、Backend 不可用、失败或超时 MUST 省略候选、保留可用 Catalog 并继续任务，不自动启动 Backend、不逐请求重试、不把未记录说成从未阅读。Catalog 自身失败 SHALL 沿用既有失败语义。更新通知、权限、shell 身份策略与子 Agent 来源合同 MUST 保持不变。

#### Scenario: Large Catalog and candidates
- **WHEN** 原生 compact 恢复的两段内容原始合计超过预算
- **THEN** 返回文本 MUST 不超过 4000 字符，同时保留完整候选条目及既有 Catalog 截断提示

#### Scenario: Candidate service alone fails
- **WHEN** Catalog 可读而候选为空、失败或超时
- **THEN** 集成 MUST 仍提供 Catalog，不增加候选恢复前置步骤，原任务继续

### Requirement: Omp committed compaction refresh is request-scoped and isolated

omp SHALL 仅在实际压缩提交后的 `session_compact` 事件刷新候选，后台压缩的准备或摘要生成 MUST NOT 提前恢复或切换身份。Catalog 与候选 SHALL 在下一 `context` callback 懒加载一次，后续请求复用快照，不写持久 transcript、不改原 prompt/system prompt、不累积本扩展提示副本。会话切换、后续 compact、关闭 SHALL 取消旧读取并丢弃晚到结果。

Main 恢复 SHALL 使用当前实际 session ID 与已有 read-hints bridge；子 Agent SHALL 保持源头 Main 来源。恢复 MUST 独立于 `agent.subagentPackCatalog`。

#### Scenario: Background compaction commits while metadata is pending
- **WHEN** 后台压缩提交时旧 metadata 请求仍在运行
- **THEN** 旧请求 MUST 取消或失效，晚到结果 MUST 不覆盖新快照；下一请求 MUST 使用提交后本会话的最新候选

#### Scenario: Repeated callbacks and compactions
- **WHEN** 同一快照出现连续或并发 context callback，或同一任务再次 compact
- **THEN** 普通请求 MUST 共用一次读取并仅含一份候选；再次 compact MUST 替换旧提示而不是追加历史副本，其他真实消息不变

#### Scenario: Child compaction and session switch
- **WHEN** 子 Agent compact 或恢复期间切换会话
- **THEN** 子 Agent MUST 继续读取源头 Main 候选；旧主会话恢复资格 MUST 不泄漏到新会话

### Requirement: Host capability comparison exposes actual support

英中功能对比表 SHALL 以 host 为列、功能为行，并定义 `✓` 完整实现、`△` 部分实现、`✗` 无此功能、`-` 未知。完整能力 MUST 不因本次未做实机验收而标成未知；部分实现 MUST 标明差异并链接对应 host 的详细指南。各 host 的英中指南与 README SHALL 清楚说明支持、限制和按需恢复路径。

ZCode、Cursor 的主 Agent compact 恢复 MUST 标为 `✗`，保留其已有功能，不虚构恢复事件或引入轮询。ZCode 的 SessionStart 只有 startup/resume；Cursor 的 sessionStart 不在 compact 后重跑，旧 context 保留不等于刷新新增候选。

#### Scenario: User compares hosts
- **WHEN** 用户查看功能对比表与某个 host 指南
- **THEN** 表格 MUST 可逐功能比较六个 host，详细指南 MUST 解释部分能力和缺失能力，不以笼统的 Plugin 支持替代差异

#### Scenario: A host has no compact recovery entry
- **WHEN** ZCode 或 Cursor compact 后继续任务
- **THEN** Lorelum MUST 不宣称自动刷新已读候选，用户仍能沿既有 Skill query/get 路径工作
