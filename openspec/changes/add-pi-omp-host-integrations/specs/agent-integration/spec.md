## MODIFIED Requirements

### Requirement: Host Hook ABI preserves a shared Catalog boundary

当受支持的宿主提供原生 stdin/stdout SessionStart Hook 时，Lorelum SHALL 为该宿主提供命名为 `lore hook <hostKey>` 的 raw Hook ABI。该 ABI MUST 从 stdin 读取宿主 payload，仅为受支持事件输出该宿主的 Hook envelope；它 MUST 复用同一 Pack Catalog 检索和渲染语义，stdout MUST 只输出协议响应，诊断 MUST 写入 stderr，任何不可恢复的输入、CLI 或 Store 故障 MUST 以不阻塞宿主会话的输出和退出码 0 降级。

每个受支持原生 JSON Hook 宿主 SHALL 使用其原生事件名与 envelope：Codex 与 ZCode 使用事件名 `SessionStart` 与 `hookSpecificOutput.additionalContext` envelope，并以单行 `{ "continue": true }` 降级；Cursor 使用事件名 `sessionStart`（camelCase）与顶层 `{ "additional_context": ... }` envelope，并同样以单行 `{ "continue": true }` 降级（Cursor 对 `sessionStart` 响应不阻塞会话，该输出为无害 no-op）。各宿主 envelope MUST 遵循该宿主的原生事件契约；原生事件与 envelope 契约不同的宿主之间 MUST NOT 互用 envelope（Codex 与 ZCode 原生契约相同，共享同一形状不在此限）。宿主 envelope 之外 MUST NOT 引入新的本地调用路径。

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

## ADDED Requirements

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
