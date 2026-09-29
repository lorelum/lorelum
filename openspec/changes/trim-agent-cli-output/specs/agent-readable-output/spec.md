## Purpose

定义本地 CLI 面向 Agent 阅读的 list、query、get text 视图，使每一步只呈现当前决策所需的信息，同时保留完整 JSON 合同和 Pack 资源的可靠来源。

## ADDED Requirements

### Requirement: Agent-readable text is a decision view over complete data
`lore pack list`、`lore query`、`lore get` SHALL 默认输出面向当前命令用途的 text；`--verbose` SHALL 输出完整 result data 的 text；`--json` MUST 保持同一完整 data、envelope、退出码与字段语义，且 MUST 不受 `--verbose` 影响。text MUST 不作为机器可解析协议。

#### Scenario: Metadata is omitted only from default text
- **WHEN** 调用方分别执行同一命令的默认、`--verbose` 与 `--json` 形式
- **THEN** 默认 text SHALL 隐去该命令定义的非决策字段，verbose text SHALL 完整呈现原 data，JSON SHALL 保留原有完整字段与 envelope

### Requirement: Pack lists preserve explicit browsing locators
默认 `pack list` text SHALL 显示每个 Pack 的名称与版本，不显示快照编号、Practice 数量或全部 Pack root；`pack list --details` SHALL 继续列出每个 Pack 的名称、版本、描述及非空适用范围，且 MUST 不改变其与 Pack 参数互斥的含义；`pack list <name>` SHALL 显示选中 Pack 的名称、root 与每篇 Practice 的 ID、标题、适用时机。空列表 MUST 清楚表示无条目。

#### Scenario: Explicit Pack browse has a usable root
- **WHEN** 调用方执行 `lore pack list <name>` 并需要浏览该 Pack 的资源
- **THEN** 默认 text MUST 提供该 Pack 当前可读的 `packRoot`，而无需调用 verbose 或猜测 Store 路径

### Requirement: Query text preserves retrieval decisions and recovery states
ready query 的默认 text SHALL 保留每个命中的 ID、标题、stage、非空 tech stack 与适用时机；只有非默认 severity、keyword mode、partial coverage、非空降级 warning 才显示相应提示。默认 text MUST 不显示 digest、profile ID、已完成覆盖的重复状态或成功结果的 operation ID。preparing、indexing、degraded 与 error MUST 可与空结果区分，并保留可执行的恢复信息。

#### Scenario: Partial and degraded results are not mistaken for complete absence
- **WHEN** ready query 为 partial coverage 或 ProjectContext 带有 warning
- **THEN** 默认 text MUST 标明覆盖或降级，并保留进度与受影响对象，不得呈现为普通完整空结果

#### Scenario: Accepted operation has an actionable state
- **WHEN** query 返回 preparing 或 indexing
- **THEN** 默认 text MUST 显示状态、恢复消息和 indexing 进度及可供查询的 operation ID（若存在），不得伪造 ready results

### Requirement: Get text keeps complete guidance and its source locator
`get` 的默认 text SHALL 保留 Practice ID、标题、适用时机、非空 tech stack、完整 body 与非空 anti-pattern 的名称和描述；非默认 severity SHALL 显示，默认值与仅供身份识别的 digest、anti-pattern ID、stage MAY 隐去。默认 text MUST 为每一个 source 保留其 Pack 名称、source path 与 `packRoot`，不得因单来源、正文有无 `resource:` 链接而省略或合并来源。Store root 是 Pack 相对资源的 locator；ProjectContext 的 `project-layer-N` MUST 明确标为逻辑来源，而不得当作可拼接的文件路径。

#### Scenario: Store Practice links to a Pack resource
- **WHEN** Store Practice 的正文包含 `resource:references/...`、`resource:assets/...` 或 `resource:scripts/...` 链接
- **THEN** 默认 get text MUST 给出对应 source 的可读 Pack root，使调用方能以 Pack-root-relative 路径定位该资源，不必另查 list

#### Scenario: Multiple sources remain distinct
- **WHEN** 一个 Practice 由多个 Pack 来源提供相同内容
- **THEN** 默认 get text MUST 逐一展示每个来源及其 root，不得默选第一个或把不同来源的资源混用

#### Scenario: Project source is not a filesystem locator
- **WHEN** 当前 Practice 来自 ProjectContext 的逻辑层
- **THEN** 默认 get text MUST 将 `project-layer-N` 标示为 provenance，而非可访问的 Pack root，且 MUST 不借同名 Store root 假装该项目资源可读
