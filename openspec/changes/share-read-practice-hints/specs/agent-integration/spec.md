## ADDED Requirements

### Requirement: 跨宿主的会话已读 Practice 候选

Lorelum SHALL 在 CLI 侧记录成功读取的 Practice 候选元数据，并按宿主与会话隔离。候选仅表示某次 `get` 已读取、可能仍相关，不表示主 Agent 采纳或证明有效；记录 MUST 不包含正文、shell 命令、用户 prompt 或查询内容。宿主 SHALL 只映射自己的事件字段，不单独拥有候选语义或存储。

#### Scenario: 通过组合 shell 命令读取 Practice
- **WHEN** 一个受支持的 shell tool 窗口内，直接调用或脚本中的 `lore get` 成功读取 Practice
- **THEN** Lorelum MUST 根据该 CLI 调用的实际执行目录和活动窗口，将 ID、digest、title、可选适用条件与 Pack 身份记录为会话候选，而不要求 `--json` 或解析外层命令及输出

#### Scenario: 非 shell tool 或无法关联的读取
- **WHEN** Hook 收到非 shell tool，或成功读取无法关联到活动 shell 窗口
- **THEN** 路由 MUST 跳过该 tool 或该读取，且 MUST 不影响原调用

#### Scenario: 失败读取
- **WHEN** `lore get` 未成功读取 Practice
- **THEN** 候选簿 MUST 不新增该 Practice，且原命令的错误语义 MUST 保持不变

### Requirement: Codex 子 Agent 获得可选候选提示

Codex 集成 SHALL 在 `SubagentStart` 有可关联候选时注入有界的元数据提示；空候选或读取故障 MUST 不阻塞子 Agent。提示 MUST 声明候选可能相关且不完整，仅在当前子任务需要时由子 Agent 自行 `lore get`；Hook MUST 不自动查询或读取完整正文。

#### Scenario: 子 Agent 启动且本会话已读候选
- **WHEN** Codex 的 `SubagentStart` 带有当前会话 ID 且候选簿有已读 Practice
- **THEN** 子 Agent MUST 收到按预算裁剪的 ID、title、适用条件和 Pack 提示，但不收到正文或自动执行 `get`

#### Scenario: 无候选或暂时不可用
- **WHEN** 本会话没有候选或候选文件不可读
- **THEN** Hook MUST 不注入候选并允许子 Agent 正常启动

#### Scenario: 同路径重叠会话
- **WHEN** 多个会话在同一路径同时使用 shell tool，导致某次 `get` 只能近似归属
- **THEN** 候选提示 MAY 漏记或误归属，用户文档 MUST 明示此限制；候选不得被用作权限、采纳或任务完成判定
