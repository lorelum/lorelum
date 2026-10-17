# agent-integration Delta

## ADDED Requirements

### Requirement: Claude Code 会话身份传递不改变原命令权限

Claude Code 集成 SHALL 只对 `Bash` 与 `PowerShell` 两个 shell 工具的 `PreToolUse` 改写工具输入以传递宿主与会话 ID。改写语法按工具选择：`Bash` SHALL 使用 Unix shell 环境变量语法（Windows 上 Claude Code 的 Bash 工具同样经 POSIX 风格 shell 执行），`PowerShell` SHALL 使用 PowerShell 环境变量语法。改写 MUST 仅通过 `hookSpecificOutput.updatedInput` 生效并保留原输入的其他字段，MUST NOT 携带 `permissionDecision`，MUST NOT 改变原命令的权限、批准与退出语义。Claude Code 与 Codex 共同消费用户级 `agent.shellSessionInjection`：默认 `lore-only` 仅在外层命令文本出现独立 `lore` 字样时注入，`all-shell` 对每次有效 shell 工具调用注入；两种模式 MUST 跳过非 shell 工具，MUST NOT 为判断而读取脚本内容或解析 shell 语法。配置损坏或取值无效时 MUST 不改写该次命令，也 MUST NOT 阻塞原工具调用；无法安全改写时 MUST 不假称显式绑定已生效。

#### Scenario: Bash 工具注入会话身份

- **WHEN** Claude Code 的 Bash `PreToolUse` 带有会话 ID 且命中注入条件（任意平台，含 Windows 经 POSIX 风格 shell 执行的 Bash）
- **THEN** Hook MUST 以 Unix `export` 语法在命令前注入宿主与会话 ID，保留工作目录等原输入其他字段，且返回的 `updatedInput` MUST NOT 携带 `permissionDecision`

#### Scenario: PowerShell 工具注入会话身份

- **WHEN** Claude Code 的 PowerShell `PreToolUse` 带有会话 ID 且命中注入条件
- **THEN** Hook MUST 以 PowerShell `$env:` 语法在命令前注入宿主与会话 ID，并同样不携带 `permissionDecision`

#### Scenario: 默认只检测外层命令

- **WHEN** 用户未配置 `agent.shellSessionInjection`，Claude Code 发来的 shell 命令文本不含独立的 `lore` 字样，即使它运行的脚本内部可能调用 `lore get`
- **THEN** Hook MUST 不注入会话变量；脚本内读取 MAY 漏记，且原命令正常执行

#### Scenario: 用户选择每个 shell 命令都注入

- **WHEN** `agent.shellSessionInjection` 为 `all-shell` 且 Claude Code 收到有效 Bash 或 PowerShell PreToolUse
- **THEN** Hook MUST 注入会话变量，不论原命令是否包含 `lore`；其他工具 MUST 不被改写

#### Scenario: 非 shell 工具或身份无效

- **WHEN** Hook 收到 `Bash` 与 `PowerShell` 之外的工具调用，或会话 ID 缺失/无效
- **THEN** Hook MUST 输出空对象且 MUST 不影响原工具调用

#### Scenario: 改写不改变批准语义

- **WHEN** Hook 返回仅含 `updatedInput` 的 PreToolUse 响应
- **THEN** Claude Code MUST 按改写后的输入走正常权限评估；宿主的 deny/ask 规则 MUST 仍然生效，MUST NOT 因 Hook 改写而自动批准或自动拒绝

### Requirement: Claude Code 子 Agent 获得可选候选提示

Claude Code 集成 SHALL 在 `SubagentStart` 带有会话 ID 且该会话存在已读 Practice 候选时，经 `hookSpecificOutput.additionalContext` 注入按预算裁剪的候选元数据提示。空候选、无会话 ID 或读取故障 MUST 输出空对象且 MUST 不阻塞子 Agent 启动。提示 MUST 声明候选可能相关且不完整，仅在当前子任务需要时由子 Agent 自行 `lore get`；Hook MUST 不自动查询或读取完整正文。

#### Scenario: 子 Agent 启动且本会话已读候选

- **WHEN** Claude Code 的 `SubagentStart` 带有当前会话 ID 且候选簿有该会话已读 Practice
- **THEN** 子 Agent MUST 收到按预算裁剪的 ID、title 和适用条件提示，但不收到 Pack 来源、正文或自动执行 `get`

#### Scenario: 无候选或暂时不可用

- **WHEN** 本会话没有候选，或 Backend 无法读取候选
- **THEN** Hook MUST 输出空对象并允许子 Agent 正常启动

## MODIFIED Requirements

### Requirement: Catalog-aware targeted retrieval

CLI-first 集成的 Skill SHALL 将已提供的 Installed Pack Catalog 仅作为 routing metadata，而不得将其当成完整 Practice 内容或不存在相关 guidance 的证明。generic Skill 在任务上下文没有可用 Catalog 时 MUST 执行一次 `lore pack list --details` 并在当前任务复用结果；通过宿主 SessionStart Hook 注入 Catalog 的 Skill MUST 复用它而不得重复 list。Hook MUST 保持 metadata-only，且不得自动执行 `lore query` 或 `lore get`。当 Skill 判定 material task、decision、verification、recovery 或 completion moment 值得检索时，MUST 先执行一次 targeted natural-language semantic query；准备使用某个 Practice 前 MUST 读取其完整内容。

Cursor 的 `sessionStart` Hook 是 fire-and-forget，宿主不保证注入的 Catalog 在首个 turn 前可见。因此 Cursor 集成的 Skill SHALL 把「Hook 已注入可用 Catalog」作为条件而不是前提：仅当当前任务上下文实际含有可用 Catalog 时才进入复用路径；Catalog 缺失或不可见时，该 Skill MUST 按 generic Skill 规则为当前任务执行一次 `lore pack list --details`，且该行为 MUST NOT 被视为违反复用纪律。

#### Scenario: Generic Skill establishes a missing Catalog once

- **WHEN** generic Skill 的当前任务上下文没有可用的 Installed Pack Catalog，且需要检索 guidance
- **THEN** Skill MUST 只执行一次 `lore pack list --details` 建立 Catalog，并在后续普通编辑、命令或回复前复用它

#### Scenario: Codex reuses Hook-injected Catalog

- **WHEN** Codex Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: ZCode reuses Hook-injected Catalog

- **WHEN** ZCode 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Cursor reuses a visible Hook-injected Catalog

- **WHEN** Cursor 的 `sessionStart` Hook 注入的 Installed Pack Catalog 实际出现在当前任务上下文中，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Cursor establishes the Catalog when injection is absent

- **WHEN** Cursor 会话的任务上下文中没有可见的 Installed Pack Catalog（Hook 未注入、注入延迟或被截断），且 Skill 需要检索 guidance
- **THEN** Skill MUST 为当前任务执行一次 `lore pack list --details` 并复用结果，且该行为 MUST NOT 被判定为违反复用纪律

#### Scenario: WorkBuddy reuses Hook-injected Catalog

- **WHEN** WorkBuddy 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: Claude Code reuses Hook-injected Catalog

- **WHEN** Claude Code 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

### Requirement: Host Hook ABI preserves a shared Catalog boundary

当受支持的宿主提供 SessionStart Hook 时，Lorelum SHALL 为该宿主提供命名为 `lore hook <hostKey>` 的 raw Hook ABI。该 ABI MUST 从 stdin 读取宿主 payload，仅为受支持事件输出该宿主的 Hook envelope；它 MUST 复用同一 Pack Catalog 检索和渲染语义，stdout MUST 只输出协议响应，诊断 MUST 写入 stderr，任何不可恢复的输入、CLI 或 Store 故障 MUST 以不阻塞宿主会话的输出和退出码 0 降级。当前受支持宿主为 `claude`、`codex`、`cursor`、`workbuddy` 与 `zcode`。

每个受支持宿主 SHALL 使用其原生事件名与 envelope：Claude Code、Codex、WorkBuddy 与 ZCode 使用事件名 `SessionStart` 与 `hookSpecificOutput.additionalContext` envelope，并以单行 `{ "continue": true }` 降级；Cursor 使用事件名 `sessionStart`（camelCase）与顶层 `{ "additional_context": ... }` envelope，并同样以单行 `{ "continue": true }` 降级（Cursor 对 `sessionStart` 响应不阻塞会话，该输出为无害 no-op）。各宿主 envelope MUST 遵循该宿主的原生事件契约；原生事件与 envelope 契约不同的宿主之间 MUST NOT 互用 envelope（Claude Code、Codex、WorkBuddy 与 ZCode 原生契约相同，共享同一形状不在此限）。宿主 envelope 之外 MUST NOT 引入新的本地调用路径。

#### Scenario: ZCode SessionStart Hook is unavailable or malformed

- **WHEN** `lore hook zcode` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回

#### Scenario: ZCode SessionStart Hook returns the Catalog envelope

- **WHEN** `lore hook zcode` 收到支持的 ZCode `SessionStart` payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出 ZCode `hookSpecificOutput` envelope，其中包含 `hookEventName: "SessionStart"` 和有界的 Installed Pack Catalog

#### Scenario: Cursor sessionStart Hook returns the Catalog envelope

- **WHEN** `lore hook cursor` 收到 `hook_event_name` 为 `"sessionStart"` 的 payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出单行 JSON，其顶层含字符串字段 `additional_context`，值为有界的 Installed Pack Catalog，且 MUST NOT 使用 `hookSpecificOutput` 包装

#### Scenario: Cursor sessionStart Hook is unavailable or malformed

- **WHEN** `lore hook cursor` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回

#### Scenario: WorkBuddy SessionStart Hook is unavailable or malformed

- **WHEN** `lore hook workbuddy` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回

#### Scenario: WorkBuddy SessionStart Hook returns the Catalog envelope

- **WHEN** `lore hook workbuddy` 收到支持的 WorkBuddy `SessionStart` payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出 WorkBuddy `hookSpecificOutput` envelope，其中包含 `hookEventName: "SessionStart"` 和有界的 Installed Pack Catalog

#### Scenario: Claude Code SessionStart Hook returns the Catalog envelope

- **WHEN** `lore hook claude` 收到 `hook_event_name` 为 `"SessionStart"` 的 Claude Code payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出 `hookSpecificOutput` envelope，其中包含 `hookEventName: "SessionStart"` 和有界的 Installed Pack Catalog

#### Scenario: Claude Code SessionStart Hook is unavailable or malformed

- **WHEN** `lore hook claude` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回
