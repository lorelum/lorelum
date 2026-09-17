## Purpose

定义 Lorelum 普通 CLI 命令的人类可读默认输出与显式 JSON machine contract，使两种格式来自同一份公开业务结果、具有相同状态和退出语义，而不制造第二套命令行为。

## ADDED Requirements

### Requirement: Ordinary commands default to complete text and support explicit JSON

除 `lore hook codex` 的专用 Hook ABI 外，所有普通 CLI command、root invocation、`--help` 和 `--version` SHALL 在未传格式参数时将 text 写入 stdout。调用方传入适用的 `--json` 时 MUST 在 stdout 返回完整、未删改的 Lorelum JSON protocol envelope；其中的 `protocolVersion`、顶层 `toolVersion`、`command`、`ok`、`data`/`error`、exit code、业务路径和业务结果 MUST 与格式改造前的 JSON 调用一致。

格式选择 MUST 不依赖 TTY、管道、环境变量、renderer 是否存在或命令类别。`--` 后的 token，以及另一个 option 的值，MUST NOT 被解释为格式参数。无 `--json` 的普通 usage/domain failure MUST 使用 text；带 `--json` 的同类失败 MUST 使用 JSON envelope。

#### Scenario: Default get presents its public result as text

- **WHEN** 用户执行不带 `--json` 的有效 `lore get <practice-id>`
- **THEN** stdout SHALL 是该次 get `data` 的完整可读 text 表现，exit code SHALL 与原 get 结果保持一致

#### Scenario: Explicit JSON preserves the machine envelope

- **WHEN** 调用方为诊断、protocol 核对或显式机器解析执行任一普通命令并传入适用的 `--json`
- **THEN** stdout SHALL 只写一行完整 JSON envelope，调用方 SHALL 可继续读取相同的 `data`、`error.code`、source provenance、operation ID、状态与退出码

#### Scenario: A JSON-looking argument is not mistaken for the format option

- **WHEN** 调用在 `--` 后包含 `--json`，或 `--json` 是一个需要值的 option 的值
- **THEN** CLI MUST 按该 token 在原有参数语义中的含义处理，而不得将输出切换为 JSON

### Requirement: Text is a complete visual representation of public business data

text MUST 从同一次成功 handler result 的公开 `data` 生成，并呈现其中每一个 object field、array item 和 scalar value。identity、status、source、ID、进度、diagnostics、metadata、`null`、空 object、空 array 与多行 string 均 MUST 可见；位于 `data` 的 protocol/tool version 同样 MUST 可见。text 可以不重复 JSON envelope 外壳的 `protocolVersion`、顶层 `toolVersion`、`command` 与 `ok`。

默认 text SHALL 使用稳定的树形可读排版。单个 command MAY 使用内部 custom renderer 改善 Help、version 或其他天然面向人类的布局，但 custom renderer MUST 保留同一公开数据的完整信息、顺序和值；它 MUST NOT 读取 Store、连接 Backend、等待 operation、重新排序、过滤字段、推导状态或成为外部 custom-render plugin contract。Agent 与 Skill 可直接阅读 text 的完整信息，但 text 不是供任何调用方以格式化规则解析的协议；需要机器解析时使用 `--json`。

#### Scenario: Generic text retains nested, empty and multiline data

- **WHEN** 任一普通 command 的 `data` 同时包含 nested object、array、空集合、`null` 和多行 string
- **THEN** 默认 text SHALL 以可读层级显示全部字段和值，不得以摘要、省略号、隐藏 metadata 或第二次数据读取替代它们

#### Scenario: Help uses a more comfortable layout without losing its capability data

- **WHEN** 用户运行 `lore --help` 或任一普通 command 的 `--help` 且未传 `--json`
- **THEN** CLI MAY 使用面向终端浏览的 Help 排版，但 text SHALL 仍完整呈现 command usage、summary、positionals、options、result schema、error codes、exit codes 及 root invocation 包含的 command capabilities

#### Scenario: Public data is not silently hidden from text

- **WHEN** command 的 JSON `data` 包含 `contentDigest`、`packRoot`、`profileId`、`operationId`、warning、diagnostic 或其他当前公开字段
- **THEN** text SHALL 显示该字段和值；若未来某字段不应公开，产品 MUST 先在 JSON data contract 中移除或重构它，而不得只在 text renderer 中隐藏

### Requirement: One rendering boundary preserves handler and lifecycle semantics

handler SHALL 继续只产生现有结构化 `data` 与 exit code；可见 error SHALL 继续由既有 error mapping 产生。格式改造 MUST 在一个 render 边界选择 JSON 或 text，且 JSON/text MUST 使用同一 handler invocation、同一 source snapshot、同一 result ordering、同一 public schema 和同一 exit code。

该 render 边界 MUST NOT 改变 Engine、Backend、LocalStore、semantic/keyword mode、index lifecycle、retry/recovery 行为或 `lore hook codex` ABI。它 MUST NOT 对 text 引入额外 I/O 或后台工作。

#### Scenario: A partial or pending result is not recomputed for text

- **WHEN** query、index 或 Pack mutation handler 返回 partial、preparing、indexing、pending、failed 或 degraded data
- **THEN** text SHALL 显示 handler 已返回的相同 state 和全部关联字段，且 MUST NOT 等待、重试、补建 index 或把它改写为 ready

#### Scenario: Hook ABI remains independent

- **WHEN** 调用 `lore hook codex`
- **THEN** 该调用 SHALL 保持其专用 Hook 输入/输出 ABI，且普通 text/`--json` 协商不得改变其输出

### Requirement: Error destination retains complete public error information

默认 text command 的 usage/domain failure MUST 在 stderr 显示完整的 `error.code`、`message` 和存在时的完整 `recovery` object，并以既有 exit code 结束。带 `--json` 的失败 MUST 在 stdout 输出完整 JSON failure envelope，stderr 不得承载该 envelope。成功但 exit code 为 `1` 的 lifecycle data 仍是 result，MUST 在 stdout 以选定格式呈现而不是伪装成 error。

#### Scenario: Default text failure remains actionable

- **WHEN** 未传 `--json` 的普通调用返回可见 `usage.invalid` 或 domain error
- **THEN** stderr SHALL 显示 error code、message 以及存在时的 recovery fields，stdout SHALL 不写 JSON envelope，exit code SHALL 与原失败相同

#### Scenario: Explicit JSON failure remains machine-readable

- **WHEN** 带 `--json` 的普通调用返回可见 error
- **THEN** stdout SHALL 是完整 JSON failure envelope，stderr SHALL 不写该 error 的 text rendition，exit code SHALL 与默认 text 路径相同
