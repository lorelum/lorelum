## ADDED Requirements

### Requirement: Session-bound Agent output can carry a deferred update prompt
已有有效 host/session 绑定的成功 semantic query/get/list/pack.list SHALL 可进行符合 cli-update-notifications 的本地 poll。文本响应 SHALL 在原成功结果之后提供可选的最多 400 字符固定更新 prompt；普通 JSON SHALL 只可启动异步检查，不增加字段、投递或领取提醒。绑定不构成 Main 身份鉴权，主／子 Agent 的普通文本 SHALL 使用同一版本对规则。显式 query --mode keyword 即使有绑定也 MUST 不 poll、不启动或消费提示，以保留离线合同；无绑定、管理命令与错误响应 MUST 保持原路径。Agent SHALL 先完成当前用户任务，任务总结可顺带告知新版和 lore update；MUST 不立即追问、执行更新或单独启动模型 turn。

#### Scenario: Successful text consumes a ready result
- **WHEN** 有效会话绑定的 get 成功且 ready 版本对尚未提醒
- **THEN** 响应 SHALL 保留完整结果并附独立 prompt，不等待网络；同一版本对后续调用不重播

#### Scenario: Machine output does not consume the prompt
- **WHEN** 相同会话执行合格 --json 命令且有 ready 结果
- **THEN** JSON、diagnostics 和 data MUST 不变，通知额度 MUST 留给后续可投递渠道

### Requirement: Native update metadata is separate from Catalog
原生宿主 SHALL 仅在有效会话 ID 的合格 SessionStart 调用本地 poll：Codex、Claude Code、WorkBuddy、ZCode SHALL 要求 source 为 startup/resume；Cursor 原生 sessionStart SHALL 使用有效 session_id 或 conversation_id。compact/clear/fork、工具事件与 SubagentStart MUST 保留原行为、不访问更新 sidecar。原生 envelope 和事件名 MUST 不变，Catalog 的 4000 字符预算 MUST 不被提醒挤占；提醒作为额外段落最多 400 字符，含分隔总 context 最多 4402 字符。自动错误或无 ready 结果 MUST 不丢弃 Catalog 或发更新警告；调用 MUST 不等待发行网络。

#### Scenario: Native startup launches work without waiting
- **WHEN** 合格 SessionStart 有有效 ID 且没有 ready 更新结果
- **THEN** Hook SHALL 可启动异步检查并返回原 Catalog，不等待结果，不输出检查中状态

#### Scenario: Native resume consumes ready metadata
- **WHEN** 合格恢复事件已有可投递更新结果
- **THEN** 原 envelope SHALL 返回 Catalog 和独立提示段，受版本对去重限制

#### Scenario: Compaction only refreshes Catalog
- **WHEN** 原生 compact 事件恢复 Catalog
- **THEN** Hook MUST 不 poll 更新，也不重置版本对历史

### Requirement: Omp update notices are consumed outside the Catalog snapshot
omp extension SHALL 仅在明确 Main 的新建／恢复／切换到实际会话入口，从实际 sessionManager 提供会话 ID 并允许本地更新 poll；同 ID 的 compact/tree/branch 失效、子 Catalog、shell/read-hints 和普通模型请求 MUST 不自行 poll。CLI SHALL 仅返回已 ready 的独立 updateNotice，不等待网络。extension SHALL 至多在当前 generation 的下一次自然模型请求临时注入一次，MUST 不写入 Catalog metadata 快照、持久 transcript 或自发模型 turn。消费、取消、切换和退出 SHALL 清除暂存提示，过期 generation 的结果 MUST 不污染新会话；原消息、system prompt、权限与子 Agent read hints MUST 保持不变。

#### Scenario: The first request starts discovery
- **WHEN** 合格 Main catalog 请求没有 ready 候选
- **THEN** bridge SHALL 立即沿原 Catalog 返回，可启动 worker，但 MUST 不等待或为了结果逐模型请求再次调用

#### Scenario: Later context reuses Catalog but not the notice
- **WHEN** 一次后续合格刷新返回 Catalog 与 updateNotice，之后有多个模型请求
- **THEN** Catalog SHALL 按原生命周期复用，notice MUST 只在首次自然请求出现一次，不增加普通请求的 CLI 调用

#### Scenario: Session switching discards a late notice
- **WHEN** 会话切换或取消后旧 generation 的 bridge 响应返回
- **THEN** extension MUST 丢弃旧提示，不补送或污染新会话

## MODIFIED Requirements

### Requirement: Omp extension Catalog bridge
Lorelum SHALL 提供 lore hook omp 供原生 omp extension 调用。命令 SHALL 接受 stdin JSON {"event":"catalog","agentKind":"main"}；可选 agentKind SHALL 为 main 或 sub，省略 MUST 保持 main 旧语义。Main MUST 始终使用既有 Catalog；sub SHALL 由 CLI 读取 ~/.lorelum/config.yaml 布尔项 agent.subagentPackCatalog，默认 false。false 时 MUST 在读取 Store 前正常返回 {}；显式 true 时 SHALL 复用共享 renderer。extension MUST 显式标记 sub 请求、接受正常 {}，MUST NOT 直接读取配置。成功输出单行 {"additionalContext":"<Catalog>"}；Catalog MUST 只含 Pack routing metadata，最多 4000 字符，MUST NOT 包含完整 Pack 或 Practice 正文、自动 query/get 或启动语义准备。

显式 main 的合格生命周期请求 SHALL 可扩展为 {"event":"catalog","agentKind":"main","sessionId":"<实际 Main session ID>","checkUpdates":true}，其可选响应 updateNotice SHALL 为最多 400 字符的独立字符串。CLI SHALL 只做本地 poll，不等 worker；缺省旧请求 MUST 保持 Catalog-only。sub、缺失或无效更新字段 MUST 只略过更新，原有效 Catalog 行为保留。shell/read-hints MUST 不改变；自动错误 MUST 不令 Catalog 失败或输出更新警告。

输入不支持、JSON 损坏或 Catalog 读取失败时，bridge MUST 输出单行 {} 并以退出码 0 返回，诊断 MUST 写 stderr；非法命令参数 SHALL 保持普通 CLI 用法错误语义。新 extension 的扩展 main catalog 请求若收到退出码 0 的单行合法精确空对象，SHALL 最多一次去掉新增字段重试旧形状；不得断言该结果确定来自旧 CLI。超时、进程失败、畸形响应或普通旧请求 MUST NOT 进入回退，回退 MUST 不带自动字段或继续重试。

#### Scenario: Extension obtains metadata from the selected Store
- **WHEN** extension 用有效 Catalog 请求和指定 Store root 调用 bridge
- **THEN** 返回值 MUST 包含该 Store 的有界 Pack Catalog，与既有宿主共享 Catalog 语义

#### Scenario: Empty Store differs from failed discovery
- **WHEN** 有效 Store 没有已安装 Pack
- **THEN** bridge SHALL 返回说明无 Pack 的 Catalog；读取失败时 MUST 返回 {}，不把故障表示成空结果

#### Scenario: Malformed extension request remains non-blocking
- **WHEN** bridge 收到畸形输入或不支持的 event
- **THEN** 它 MUST 输出 {}、stderr 诊断及退出码 0，MUST NOT 输出其他宿主 envelope

#### Scenario: Sub Catalog is disabled by default
- **WHEN** Catalog 标为 sub，设置缺省或 false
- **THEN** CLI MUST 返回正常 {} 而不读 Store，extension 不诊断故障，Main Catalog 与 read-hints 不受影响

#### Scenario: Explicit opt-in adds metadata only
- **WHEN** sub Catalog 设置 true，即使附带更新字段或没有可靠 Main 身份
- **THEN** CLI SHALL 返回共享 Pack metadata，不 poll 更新，子 Agent MUST 不因此获得完整正文或猜测候选

#### Scenario: Configuration changes while a snapshot exists
- **WHEN** 用户修改子 Catalog 设置但生命周期已有快照
- **THEN** 普通请求 SHALL 复用快照，下一生命周期刷新才读取新值；无需重启 Backend，关闭开关不关闭已读摘要

#### Scenario: Old requests remain Catalog-only
- **WHEN** 调用者未传有效 sessionId、显式 main 与 checkUpdates:true
- **THEN** 新 CLI MUST 保持原 Catalog，不 poll 或增加 updateNotice

#### Scenario: An older CLI rejects new fields
- **WHEN** 扩展 main catalog 请求因旧 CLI 严格字段检查收到有效 {}
- **THEN** extension SHALL 最多一次旧请求回退，不自动安装 CLI 或逐模型请求反复重试
