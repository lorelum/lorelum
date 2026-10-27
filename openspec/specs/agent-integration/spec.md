# agent-integration Specification

## Purpose
定义 Lorelum 面向 AI coding agent 的本地集成边界，使宿主可以稳定检索 Practice，而不会获得第二套本地 runtime、Store 或 MCP 行为。

## Requirements

### Requirement: CLI-first local integration
本地 Agent integration SHALL 使用已发布的 `lore` CLI 加宿主原生 Skill 与 Hook。Plugin、Skill 和 Hook MUST 通过 CLI 的 list、query 与 get 合同取得内容，且 MUST 不直接读取 LocalStore、导入 Engine/Backend、复制排序或错误语义。面向机器的调用 MUST 使用公开 JSON 合同；宿主 Skill 直接阅读结果时 MAY 使用完整的 Agent 可读 text。

#### Scenario: A host needs a relevant Practice
- **WHEN** 宿主 Agent 需要发现或读取 Practice
- **THEN** 集成 MUST 通过 `lore` CLI 的公开 text 或 JSON 合同完成发现、query 或 get，而不得绕过 CLI 访问内部包；自动解析结果的调用方 MUST 使用 JSON

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
当受支持的宿主提供原生 stdin/stdout SessionStart Hook 时，Lorelum SHALL 为该宿主提供命名为 `lore hook <hostKey>` 的 raw Hook ABI。该 ABI MUST 从 stdin 读取宿主 payload，仅为受支持事件输出该宿主的 Hook envelope；它 MUST 复用同一 Pack Catalog 检索和渲染语义，stdout MUST 只输出协议响应，诊断 MUST 写入 stderr，任何不可恢复的输入、CLI 或 Store 故障 MUST 以不阻塞宿主会话的输出和退出码 0 降级。当前受支持宿主为 `claude`、`codex`、`cursor`、`workbuddy` 与 `zcode`。

每个受支持原生 JSON Hook 宿主 SHALL 使用其原生事件名与 envelope：Claude Code、Codex、WorkBuddy 与 ZCode 使用事件名 `SessionStart` 与 `hookSpecificOutput.additionalContext` envelope，并以单行 `{ "continue": true }` 降级；Cursor 使用事件名 `sessionStart`（camelCase）与顶层 `{ "additional_context": ... }` envelope，并同样以单行 `{ "continue": true }` 降级（Cursor 对 `sessionStart` 响应不阻塞会话，该输出为无害 no-op）。各宿主 envelope MUST 遵循该宿主的原生事件契约；原生事件与 envelope 契约不同的宿主之间 MUST NOT 互用 envelope（Claude Code、Codex、WorkBuddy 与 ZCode 原生契约相同，共享同一形状不在此限）。宿主 envelope 之外 MUST NOT 引入新的本地调用路径。

进程内 extension callback MUST NOT 被当作原生 stdin/stdout Hook。omp 的 extension-to-CLI bridge SHALL 遵循下述独立集成协议，不得声称该协议是宿主原生 Hook envelope；所有数据访问仍 MUST 经已安装的 Lorelum CLI。

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

### Requirement: Semantic-first recovery preserves CLI semantics
Skill MUST 不因预期延迟跳过可执行的 semantic query，也不得在首次 query 前预检 Backend、model、index 或 status。`data.state: "preparing"` 或 CLI error MUST 被视为 lifecycle state 或 actionable error，而不是空结果或无相关 Practice 的证据；Skill MUST 先按对应 recovery reference 处理，再重试同一个 semantic query。keyword retrieval MUST 只在调用方明确要求 offline lexical lookup 或 semantic-runtime diagnosis 时通过 `--mode keyword` 选择，并明确标识其为 keyword result；Skill MUST 不将其作为自动 fallback。

#### Scenario: Preparing query does not fall back to keyword
- **WHEN** targeted semantic query 返回 `data.state: "preparing"`
- **THEN** Skill MUST 不返回空 guidance 或自动执行 keyword query，而必须在准备完成后重试同一个 semantic query

#### Scenario: Explicit offline lookup uses keyword mode
- **WHEN** 调用方明确要求 offline lexical lookup 或诊断 semantic runtime
- **THEN** Skill MAY 使用 `--mode keyword`，并 MUST 将结果标识为 keyword retrieval

### Requirement: No local MCP surface
当前产品 MUST 不提供或预留本地 MCP server、stdio transport、MCP tools、MCP-backed Plugin/UI/authentication。只有需要 Lorelum 运营的远程检索服务时，才可以在新批准的设计中重新评估 MCP。

#### Scenario: Adding a host integration
- **WHEN** 新的本地宿主集成需要调用 Lorelum
- **THEN** 其 MUST 采用 CLI + Skill/Hook 路径，且 MUST 不新增本地 MCP 便利层或第二条本地调用路径

### Requirement: Agent recovery uses local trace evidence and preserves outbound user control
当 CLI failure 提供 trace ID 时，支持的 Agent integration SHALL 只使用该 trace 的本机 `lore logs --trace-id <traceId>` 与对应本机 draft 路径排障；它 MUST NOT 扫描其他 trace、启动额外 runtime 或把新调用结果说成原失败现场。

Agent 发现 Lorelum bug 或功能缺口时，若用户正在执行长任务，MUST 在任务完成或达到安全停点后再告知用户并询问是否创建本机 feedback draft，不得为了反馈流程打断该任务。用户明确同意创建 draft 后，Agent MUST 使用默认 trace draft，因此普通同 trace 调用链会被保留。创建或更新外部 Issue、上传日志或提交其他外部反馈前，Agent MUST 再取得用户对该外发动作的明确授权。

只有待外发材料实际出现 credential 或可识别敏感材料时，Agent MUST 额外提示用户审阅、删减或改走私发/工单；普通本机 query、结果、路径和 Error stack MUST NOT 单独触发该提示。

#### Scenario: Agent defers a feedback offer until a long task is complete
- **WHEN** Agent 在用户委派的长任务中通过同 trace 本机日志确认 Lorelum bug 或功能缺口
- **THEN** Agent MUST 先完成该任务或达到安全停点，并在最终总结中询问用户是否要创建本机 draft，而不得自动创建 Issue 或打断任务

#### Scenario: User authorizes only a local draft
- **WHEN** 用户同意为某个 trace 创建本机 draft，但没有授权任何外发
- **THEN** Agent MAY 创建该本机 draft 并展示其路径，但 MUST NOT 上传内容、创建或更新 Issue

#### Scenario: External report contains no credential signal
- **WHEN** 用户明确授权外发的材料只包含普通 query、结果、路径和 Error stack，且没有 credential 或可识别敏感材料
- **THEN** Agent MUST 执行已授权的外发流程，而不得额外把这些普通材料标为必须脱敏或强制改走私发

### Requirement: Trace-bounded Agent diagnostic recovery and deferred feedback
generic Skill 以及 Codex、ZCode、Cursor、WorkBuddy 的宿主 Skill SHALL 对 Lorelum 故障使用一致的、以当前调用 trace 为边界的恢复路径。若故障没有阻塞主任务且用户没有要求诊断，Skill MUST 仅在当前任务保留候选事实，MUST NOT 自动读取日志、重新执行命令、写 feedback artifact、上传内容或创建/更新 Issue；它 MUST 在任务完成或用户可见里程碑最多一次非打断式询问用户是否需要反馈。

若 Lorelum 故障阻塞当前任务，或用户明确要求诊断，Skill MUST 先使用原始 failure 已显示或 JSON envelope 已提供的当前 `traceId` 执行受管理的同 trace 日志读取，并依据返回的 records 与 `missingEvidence` 说明可验证事实和证据缺口。Skill MUST NOT 扫描其他 trace、任意目录、环境、配置、完整 HTTP 内容或 native 原始输出，也 MUST NOT 在日志读取前为“预检”目的启动 Backend、模型、index 或 status 命令。

只有用户明确要求重现/诊断，或当前任务授权已明确包含安全的最小重现时，Skill 才可以建议或执行带 `--debug` 的后续调用；它 MUST 说明该调用产生的是新的 trace，且不得把新 trace 当成原始 failure 的证据。生成 feedback draft 仍 MUST 先取得用户明确同意；添加 `--include-logs info|debug` 仍 MUST 由用户明确选择。

#### Scenario: A non-blocking candidate is deferred
- **WHEN** Agent 发现清晰的 Lorelum bug、retrieval/guidance gap 或用户请求的缺失能力，但主任务可以继续且用户未要求诊断
- **THEN** Agent MUST 完成主任务，在最终总结或用户可见里程碑最多一次说明候选事实并询问是否需要本地反馈草稿，且不得自动读取额外日志或写 artifact

#### Scenario: A Lorelum failure blocks the task
- **WHEN** 当前 Lorelum failure 阻塞 Agent 完成已授权任务，且该 failure 提供当前调用的 trace
- **THEN** Agent MUST 先读取该 trace 的受管理日志、报告可验证事实与 `missingEvidence`，并在不执行广泛扫描或无授权重现的前提下选择恢复、请求用户决定或继续其他独立工作

#### Scenario: The user asks for a detailed reproduction
- **WHEN** 用户明确要求 Agent 重现或深入诊断，且现有同 trace 日志不足
- **THEN** Agent MAY 执行当前任务范围内安全的最小 `--debug` 重现，MUST 将其新 trace 与原始 trace 区分，并在需要把 detail 放入 feedback draft 前再次取得用户对 `--include-logs` 的明确选择

#### Scenario: A user approves a feedback draft
- **WHEN** Agent 已解释候选问题并且用户明确同意准备反馈
- **THEN** Agent MUST 只生成同 trace 的本地 feedback draft，展示 artifact 路径、included evidence、`externalReview` 与 `missingEvidence`，且不得将草稿视为上传、公开 Issue、triage 或产品变更授权

### Requirement: Hook routing Catalog does not own resource locators
SessionStart Hook 的有界 Catalog SHALL 为每个 Pack 提供名称、非空描述与适用范围，但 MUST 不在每个条目中常驻注入版本或 `packRoot`。Skill 在选中 Practice 后 MUST 从 `get` 的对应 source 读取 Store root 来解析 Pack-root-relative `resource:` 链接；显式浏览 Pack 时 SHALL 从 `pack list <name>` 获取 root。多来源 MUST 分别处理；ProjectContext 的逻辑层标签 MUST 不当作可读目录。

#### Scenario: A resource link is followed without a Catalog root
- **WHEN** Hook Catalog 没有 root 且 Agent 通过 query、get 读到 Store Practice 的资源链接
- **THEN** Agent MUST 使用 get 对应 source 的 root 定位资源，且 MUST 不为普通 query/get 预先重复运行全量 `pack list --details`

#### Scenario: Explicit Pack browsing gets a fresh locator
- **WHEN** 用户明确要求浏览或维护一个已安装 Pack
- **THEN** Skill MUST 从 `pack list <name>` 获取该 Pack 的当前 root，而不得从 Hook Catalog 猜测路径

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

### Requirement: Omp extension Catalog bridge
Lorelum SHALL 提供 `lore hook omp` 供原生 omp extension 调用。命令 SHALL 接受 stdin JSON `{"event":"catalog","agentKind":"main"}`；可选 `agentKind` SHALL 为 `main` 或 `sub`，省略 MUST 保持 main 旧语义。Main MUST 始终使用既有 Catalog；sub SHALL 由 CLI 读取 `~/.lorelum/config.yaml` 布尔项 `agent.subagentPackCatalog`，默认 false。false 时 MUST 在读取 Store 前正常返回 `{}`；显式 true 时 SHALL 复用共享 renderer。extension MUST 显式标记 sub 请求、接受正常 `{}`，MUST NOT 直接读取配置。成功输出单行 `{"additionalContext": "<Catalog>"}`；Catalog MUST 只含 Pack routing metadata，最多 4000 字符，MUST NOT 包含完整 Pack 或 Practice 正文、自动 query/get 或启动语义准备。

输入不支持、JSON 损坏或 Catalog 读取失败时，bridge MUST 输出单行 `{}` 并以退出码 0 返回，诊断 MUST 写 stderr；非法命令参数 SHALL 保持普通 CLI 用法错误语义。

#### Scenario: Extension obtains metadata from the selected Store
- **WHEN** omp extension 用有效 Catalog 请求和指定 Store root 调用自己的 bridge
- **THEN** 返回值 MUST 包含该 Store 的有界 Pack Catalog，与既有宿主保持相同的 Catalog 语义

#### Scenario: Empty Store differs from failed discovery
- **WHEN** 一个有效 Store 没有已安装 Pack
- **THEN** bridge SHALL 返回说明无已安装 Pack 的 Catalog；读取失败时 MUST 返回无 context 的 `{}`，而不是把故障表示成空 Pack 结果

#### Scenario: Malformed extension request remains non-blocking
- **WHEN** bridge 收到畸形输入或不支持的 event
- **THEN** 它 MUST 输出 `{}`、stderr 诊断和退出码 0，且 MUST NOT 输出另一宿主的 Hook envelope

#### Scenario: Sub Catalog is disabled by default
- **WHEN** Catalog 请求标为 sub，且设置缺省或 false
- **THEN** CLI MUST 返回正常 `{}` 而不读取 Store，extension MUST NOT 诊断为故障，Main Catalog 与 read-hints MUST 不受影响

#### Scenario: Explicit opt-in adds metadata only
- **WHEN** sub Catalog 设置显式为 true，即使没有可靠 Main 身份
- **THEN** CLI SHALL 返回共享 renderer 的 Pack metadata；子 Agent MUST NOT 因而获得完整正文或猜测的候选

#### Scenario: Configuration changes while a snapshot exists
- **WHEN** 用户修改子 Agent Catalog 设置但当前生命周期已有快照
- **THEN** 普通请求 SHALL 继续复用快照；CLI SHALL 在新子 Agent 或下一次会话/compact 刷新的 sub Catalog bridge 调用读取新值，无需重启 Backend，关闭开关 MUST NOT 关闭已读摘要

### Requirement: Request-scoped Catalog lifecycle in omp
omp 集成 SHALL 在会话启动、重新加载、切换、fork/tree/branch 导航及 compact 完成后使旧 Catalog 失效，并在下一次模型请求前从对应 CLI bridge 刷新一次。后续普通模型请求 SHALL 复用该会话快照，不得为每次请求重复运行 CLI。

有效 Catalog SHALL 只作为当前模型请求的 metadata 上下文提供；集成 MUST 保留其他宿主消息和 system prompt，MUST NOT 把 Catalog 写成持久会话消息或自动发起一个模型 turn。compact 后继续原任务的下一次模型请求 MUST 能按角色和配置重新提供 Catalog，不得依赖用户发送新任务。失败或超时 MUST NOT 阻塞原任务、继续注入旧会话 Catalog 或逐模型请求重试。Skill MUST NOT 仅因子 Agent 缺少 Catalog 自动执行 pack list 或初始化 Catalog；独立的工程材料发现需求 MAY 按需查询或浏览。

#### Scenario: A session switches before another request
- **WHEN** 宿主从一个会话切换到另一个会话，再准备模型请求
- **THEN** 集成 MUST 清除旧 Catalog，并按新会话的宿主 cwd 调用 CLI；不得因 fork 发出多个通知而重复刷新同一边界

#### Scenario: Compaction continues the same task
- **WHEN** 宿主完成 compact 并继续原任务的模型请求
- **THEN** 集成 MUST 刷新并临时提供 Catalog，且持久 transcript MUST NOT 因反复请求累积 Catalog 消息

#### Scenario: CLI is missing or too old
- **WHEN** extension 无法运行 CLI 或无法取得有效 bridge 响应
- **THEN** 原任务 MUST 继续且没有错误 Catalog；集成 SHALL 提供可操作诊断，Skill SHALL 按缺失 Catalog 路径处理，不得自动 keyword fallback

### Requirement: Omp support boundaries remain explicit
omp 集成 SHALL 通过其 marketplace 分发 `plugins/omp/lorelum/`，提供 Catalog、Skill、semantic query/get、成功读取关联和 task/eval 子 Agent 已读候选。集成 MUST NOT 通过全局环境绑定 session、修改宿主权限或猜测父会话身份。pi 支持不属于本阶段。

#### Scenario: User starts a task in omp
- **WHEN** 用户在受验收版本的 omp 中安装 Lorelum 并开始需要工程 guidance 的任务
- **THEN** Agent SHALL 能利用 Catalog 和 Skill 按需 query、完整 get，并在成功读取后按当前 session 记录候选；子 Agent 使用候选前仍须完整读取 Practice

### Requirement: Omp shell session association
omp extension SHALL 在原生 Bash `tool_call` 中将实际 session ID 和 command 交给 `lore hook omp` 的 `shell` bridge，按已有 `agent.shellSessionInjection` 设置只改写本次输入。默认 SHALL 为 `lore-only`，显式 `all-shell` SHALL 覆盖全部 Bash；其他输入字段、审批和权限 MUST 保持不变。Backend SHALL 接受 `omp` hostKey，成功 get SHALL 复用既有读取报告，不得额外报告失败读取。

#### Scenario: Successful get belongs to the current session
- **WHEN** omp Bash 成功执行 `lore get`
- **THEN** 候选 SHALL 记录在该工具调用的实际 omp session，而非 Agent registry ID、主会话或其他并行子会话

#### Scenario: Hook failure preserves the original command
- **WHEN** bridge 缺失、超时、失败或响应无效
- **THEN** 原始工具输入与宿主任务 MUST 继续，MUST NOT 改写全局环境、绕过审批或生成虚假候选

### Requirement: Omp child read hints
task/eval 子 Agent SHALL 在首次模型请求中获得源头 Main 成功 get 的有界候选摘要；所有嵌套层级 MUST 继承同一 Main 会话身份，而非改为直接父会话。集成 SHALL 在真实派发时关联身份，通过不变的 `read-hints` bridge 复用候选服务和 renderer；bridge MUST NOT 启动 Backend。提示 SHALL 明确未验证采用状态，以 user 消息临时注入，保留原 prompt、其他消息和 system prompt，不永久保存或自动 get。候选 MUST 独立于 `agent.subagentPackCatalog`：默认子 Agent 只有此类摘要，true 时才额外提供 Pack Catalog。

#### Scenario: Parallel and nested children retain originating Main
- **WHEN** task/eval 并行或嵌套创建子 Agent，或父会话在派发后切换
- **THEN** 每个子 Agent SHALL 读取已捕获的源头 Main 候选，不混入其他会话；子 Agent 自己 get SHALL 记录在自己的 session，MUST NOT 自动并入 Main 候选

#### Scenario: Hint lookup is unavailable or invalidated
- **WHEN** 无候选、父身份不明确、Backend 未运行，或读取失败、超时、生命周期失效
- **THEN** 子任务 MUST 继续且不注入错误候选，晚到结果 MUST NOT 污染新会话，也不得逐模型请求自动重试

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
