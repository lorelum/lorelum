# agent-integration Delta

## MODIFIED Requirements

### Requirement: Catalog-aware targeted retrieval
CLI-first 集成的 Skill SHALL 将已提供的 Installed Pack Catalog 仅作为 routing metadata，而不得将其当成完整 Practice 内容或不存在相关 guidance 的证明。generic Skill 在任务上下文没有可用 Catalog 时 MUST 执行一次 `lore pack list --details` 并在当前任务复用结果；通过宿主 SessionStart Hook 注入 Catalog 的 Skill MUST 复用它而不得重复 list。Hook MUST 保持 metadata-only，且不得自动执行 `lore query` 或 `lore get`。当 Skill 判定 material task、decision、verification、recovery 或 completion moment 值得检索时，MUST 先执行一次 targeted natural-language semantic query；准备使用某个 Practice 前 MUST 读取其完整内容。

#### Scenario: Generic Skill establishes a missing Catalog once
- **WHEN** generic Skill 的当前任务上下文没有可用的 Installed Pack Catalog，且需要检索 guidance
- **THEN** Skill MUST 只执行一次 `lore pack list --details` 建立 Catalog，并在后续普通编辑、命令或回复前复用它

#### Scenario: Codex reuses Hook-injected Catalog
- **WHEN** Codex Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: ZCode reuses Hook-injected Catalog
- **WHEN** ZCode 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

#### Scenario: WorkBuddy reuses Hook-injected Catalog
- **WHEN** WorkBuddy 的 SessionStart Hook 已向当前任务注入 Installed Pack Catalog，且 Skill 到达值得检索的 material moment
- **THEN** Skill MUST 使用该 Catalog 执行 targeted semantic query，且不得重新执行 `lore pack list --details`

### Requirement: Host Hook ABI preserves a shared Catalog boundary

当受支持的宿主提供 SessionStart Hook 时，Lorelum SHALL 为该宿主提供命名为 `lore hook <hostKey>` 的 raw Hook ABI。该 ABI MUST 从 stdin 读取宿主 payload，仅为受支持事件输出该宿主的 Hook envelope；它 MUST 复用同一 Pack Catalog 检索和渲染语义，stdout MUST 只输出协议响应，诊断 MUST 写入 stderr，任何不可恢复的输入、CLI 或 Store 故障 MUST 以 `{ "continue": true }` 和退出码 0 降级，且不得阻塞宿主会话。当前受支持宿主为 `codex`、`workbuddy` 与 `zcode`。

#### Scenario: ZCode SessionStart Hook is unavailable or malformed
- **WHEN** `lore hook zcode` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回

#### Scenario: ZCode SessionStart Hook returns the Catalog envelope
- **WHEN** `lore hook zcode` 收到支持的 ZCode `SessionStart` payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出 ZCode `hookSpecificOutput` envelope，其中包含 `hookEventName: "SessionStart"` 和有界的 Installed Pack Catalog

#### Scenario: WorkBuddy SessionStart Hook is unavailable or malformed
- **WHEN** `lore hook workbuddy` 收到畸形 payload、未支持事件、不可用 Store 或无法使用的 CLI
- **THEN** 命令 MUST 在 stdout 输出单行 `{ "continue": true }`、把诊断写入 stderr，并以退出码 0 返回

#### Scenario: WorkBuddy SessionStart Hook returns the Catalog envelope
- **WHEN** `lore hook workbuddy` 收到支持的 WorkBuddy `SessionStart` payload 且 Pack Catalog 可用
- **THEN** 命令 MUST 在 stdout 输出 WorkBuddy `hookSpecificOutput` envelope，其中包含 `hookEventName: "SessionStart"` 和有界的 Installed Pack Catalog
