# agent-integration Specification

## Purpose
定义 Lorelum 面向 AI coding agent 的本地集成边界，使宿主可以稳定检索 Practice，而不会获得第二套本地 runtime、Store 或 MCP 行为。

## Requirements

### Requirement: CLI-first local integration
本地 Agent integration SHALL 使用已发布的 `lore` CLI 加宿主原生 Skill 与 Hook。Plugin、Skill 和 Hook MUST 通过 CLI 的 list、query 与 get 合同取得内容，且 MUST 不直接读取 LocalStore、导入 Engine/Backend、复制排序或错误语义。

#### Scenario: A host needs a relevant Practice
- **WHEN** 宿主 Agent 需要发现或读取 Practice
- **THEN** 集成 MUST 通过 `lore` CLI 的公开 JSON 合同完成发现、query 或 get，而不得绕过 CLI 访问内部包

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

### Requirement: Host Hook ABI preserves a shared Catalog boundary

当受支持的宿主提供 SessionStart Hook 时，Lorelum SHALL 为该宿主提供命名为 `lore hook <hostKey>` 的 raw Hook ABI。该 ABI MUST 从 stdin 读取宿主 payload，仅为受支持事件输出该宿主的 Hook envelope；它 MUST 复用同一 Pack Catalog 检索和渲染语义，stdout MUST 只输出协议响应，诊断 MUST 写入 stderr，任何不可恢复的输入、CLI 或 Store 故障 MUST 以不阻塞宿主会话的输出和退出码 0 降级。

每个受支持宿主 SHALL 使用其原生事件名与 envelope：Codex 与 ZCode 使用事件名 `SessionStart` 与 `hookSpecificOutput.additionalContext` envelope，并以单行 `{ "continue": true }` 降级；Cursor 使用事件名 `sessionStart`（camelCase）与顶层 `{ "additional_context": ... }` envelope，并同样以单行 `{ "continue": true }` 降级（Cursor 对 `sessionStart` 响应不阻塞会话，该输出为无害 no-op）。各宿主 envelope MUST 遵循该宿主的原生事件契约；原生事件与 envelope 契约不同的宿主之间 MUST NOT 互用 envelope（Codex 与 ZCode 原生契约相同，共享同一形状不在此限）。宿主 envelope 之外 MUST NOT 引入新的本地调用路径。

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

### Requirement: Semantic-first recovery preserves CLI semantics
Skill MUST 不因预期延迟跳过可执行的 semantic query，也不得在首次 query 前预检 Backend、model、index 或 status。`data.state: "preparing"` 或 CLI error MUST 被视为 lifecycle state 或 actionable error，而不是空结果或无相关 Practice 的证据；Skill MUST 先按对应 recovery reference 处理，再重试同一个 semantic query。keyword retrieval MUST 只在调用方明确要求 offline lexical lookup 或 semantic-runtime diagnosis 时通过 `--mode keyword` 选择，并明确标识其为 keyword result；Skill MUST 不将其作为自动 fallback。

#### Scenario: Preparing query does not fall back to keyword
- **WHEN** targeted semantic query 返回 `data.state: "preparing"`
- **THEN** Skill MUST 不返回空 guidance 或自动执行 keyword query，而必须在准备完成后重试同一个 semantic query

#### Scenario: Explicit offline lookup uses keyword mode
- **WHEN** 调用方明确要求 offline lexical lookup 或诊断 semantic runtime
- **THEN** Skill MAY 使用 `--mode keyword`，并 MUST 将结果标识为 keyword retrieval

### Requirement: No local MCP surface
当前产品 MUST 不提供或预留本地 MCP server、stdio transport、MCP tools、MCP-backed Plugin/UI/authentication，`packages/mcp` MUST 继续被视为非产品 scaffold。只有需要 Lorelum 运营的远程检索服务时，才可以在新批准的设计中重新评估 MCP。

#### Scenario: Adding a host integration
- **WHEN** 新的本地宿主集成需要调用 Lorelum
- **THEN** 其 MUST 采用 CLI + Skill/Hook 路径，且 MUST 不新增本地 MCP 便利层或第二条本地调用路径
