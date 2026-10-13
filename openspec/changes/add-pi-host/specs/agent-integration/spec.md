# Spec Delta

## MODIFIED Requirements

### Requirement: CLI-first local integration
本地 Agent integration SHALL 使用已发布的 `lore` CLI 加宿主原生 Skill 与 Hook 或 Extension。Plugin、Skill、Hook 和 Extension MUST 通过 CLI 的公开合同取得内容，且 MUST 不直接读取 LocalStore、导入 Engine/Backend、复制排序或错误语义。原生 Extension 的上下文适配 MUST 不替代 CLI 检索或共享 Catalog 渲染。

#### Scenario: A host needs a relevant Practice
- **WHEN** 宿主 Agent 需要发现或读取 Practice
- **THEN** 集成 MUST 通过 `lore` CLI 的公开 JSON 合同完成发现、query 或 get，而不得绕过 CLI 访问内部包

## ADDED Requirements

### Requirement: Pi lifecycle Catalog reaches model requests
Pi 集成 SHALL 在会话启动、恢复、切换、fork 和 Extension reload 后，以及成功压缩后的首个模型请求中提供当前生命周期取得的 Installed Pack Catalog。自动压缩后的内部重试 MUST 同样获得 Catalog。单次请求 MUST 不含重复的集成 Catalog；普通后续请求 MUST 复用 Catalog 而不重新调用 CLI。Catalog MUST 不含 Practice 正文、资源内容或 Store 路径，也 MUST 不自动 query/get。

#### Scenario: A new or resumed Pi session discovers installed Packs
- **WHEN** Pi 启动新会话或恢复已有会话且 CLI Catalog 可用
- **THEN** 首个模型请求 MUST 包含有界 Catalog，且 Pack 元数据本身 MUST 不被解释为完整 guidance

#### Scenario: Automatic compaction retries without another user turn
- **WHEN** Pi 成功自动压缩上下文并在同一用户任务中重试模型请求
- **THEN** 重试请求 MUST 包含 Catalog，而不要求用户再发一条消息或手动执行 Skill

#### Scenario: Manual compaction preserves discovery
- **WHEN** 用户手动压缩成功后继续任务
- **THEN** 后续模型请求 MUST 包含 Catalog，且同一次请求中 MUST 不叠加旧 Catalog 副本

#### Scenario: Session changes do not carry stale state
- **WHEN** 用户切换、fork、新建会话或 reload Extension
- **THEN** 集成 MUST 重新取得 Catalog，不得依赖旧会话缓存继续注入旧快照

#### Scenario: Ordinary tool iterations reuse metadata
- **WHEN** Pi 在未发生上述生命周期边界的任务中继续模型请求或工具迭代
- **THEN** 集成 MUST 复用现有 Catalog，且 MUST 不自动调用 list/query/get

### Requirement: Pi Catalog adapter fails open
Pi Catalog 集成 SHALL 对 CLI 缺失、不支持集成的旧 CLI、超时、非零退出、畸形响应与 Store 故障进行非阻塞降级；失败 MUST 不被描述为没有 Pack 或没有相关 Practice，也 MUST 不将失效的旧 Catalog 当作本次成功结果。交互模式 SHALL 给出简短原因和一个恢复动作；非交互模式 MUST 不污染 Pi 的协议 stdout。成功读取空 Store MUST 明确表示没有已安装 Pack。

#### Scenario: Missing or outdated CLI does not prevent the task
- **WHEN** 生命周期调用无法找到 CLI 或 CLI 不支持 Pi Catalog ABI
- **THEN** Pi MUST 继续用户任务，交互模式 MUST 提示安装或更新 CLI 后 reload，且 MUST 不自动安装 CLI

#### Scenario: Catalog execution fails or times out
- **WHEN** Catalog 调用超时、返回无效内容或 Store 读取失败
- **THEN** Pi MUST 继续任务且不注入伪成功 Catalog，提示 MUST 区分失败与空 Store

#### Scenario: Empty Store is a successful discovery result
- **WHEN** CLI 成功读取 Store 且没有已安装 Pack
- **THEN** Pi 模型上下文 MUST 明确包含空 Catalog，且集成 MUST 不自动安装 Pack

### Requirement: Pi Skill preserves targeted retrieval
Pi Package SHALL 提供名为 `lorelum` 的 Skill 并遵守现有 Catalog-aware、semantic-first 和 trace recovery 合同。当前上下文存在可用 Catalog 时 MUST 复用；没有可用 Catalog 且需要检索时 MUST 按 generic Skill 为当前任务执行一次 `lore pack list --details`。显式入口 SHALL 使用 `/skill:lorelum`。集成 MUST 不改写工具调用、注入会话身份或声称支持子 Agent 已读知识传递。

#### Scenario: Pi uses an available Catalog
- **WHEN** Pi Skill 在 material moment 发现上下文中有可用 Catalog
- **THEN** Skill MUST 直接进行 targeted semantic query 而不重复 list，使用 Practice 前 MUST get 完整内容

#### Scenario: Pi Skill works without automatic Catalog
- **WHEN** 生命周期 Catalog 不可用而用户显式调用 `/skill:lorelum` 检索 guidance
- **THEN** Skill MUST 按通用缺失 Catalog 与 CLI recovery 合同处理，不得将自动注入失败视为没有相关 guidance

### Requirement: Pi Catalog CLI ABI shares the renderer
`lore hook pi` SHALL 接受 stdin 中的 JSON 对象，事件字段 `hook_event_name` 支持 `session_start` 和 `session_compact`。成功响应 SHALL 为单行 `{ "additionalContext": "<Catalog>" }`，Catalog MUST 复用现有共享 CLI 检索与渲染语义及默认 4000 字符预算。畸形 payload、未知事件和 Store 故障 SHALL 在 stdout 输出单行 `{}`、诊断写 stderr、退出码为 0。该命令 MUST 不参与 Session Tracking。

#### Scenario: Native Pi lifecycle requests a Catalog
- **WHEN** `lore hook pi` 收到支持的事件且 Store 可读
- **THEN** stdout MUST 只有单行 JSON 响应，包含有界 `additionalContext`，而不是其他宿主的 envelope 或普通 CLI envelope

#### Scenario: Invalid lifecycle request degrades safely
- **WHEN** stdin 畸形、事件未支持或 Store 读取失败
- **THEN** 命令 MUST 输出 `{}`、将诊断写 stderr 并以退出码 0 返回，且 MUST 不影响既有宿主响应协议
