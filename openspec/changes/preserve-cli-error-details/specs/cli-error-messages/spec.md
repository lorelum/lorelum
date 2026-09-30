## Purpose

Define the optional structured diagnostic channel for ordinary `lore` failures. The existing human-readable `message` remains present and actionable; validator-owned facts can now also reach `--json` consumers and text output without prose parsing.

## MODIFIED Requirements

### Requirement: Ordinary command failures use one public message

所有已注册普通 CLI 命令在返回失败 envelope 时 SHALL 包含 `error.code` 和有界、终端安全的人类可读 `error.message`，text 模式 SHALL 在 stderr 呈现同一消息。公共 failure schema SHALL 支持可选的非空 `error.details` 数组，但每个 detail MUST 符合结构化诊断契约。响应 MUST 保留既有 `protocolVersion: 2`、exit code、`diagnostics.traceId`、可选 `error.recovery` 和 success envelope 语义。Host Hook 专用 ABI 不属于普通命令响应。

#### Scenario: Same error and facts in both formats

- **WHEN** 同一个普通命令以 text 和 `--json` 模式分别遇到拥有已验证诊断事实的可纠正错误
- **THEN** 两种输出 MUST 给出语义相同的 `message` 与相同 facts、error code 和 exit code；JSON failure MUST 通过公共 schema 校验，并在有事实时包含非空 `error.details`

## MODIFIED Requirements

### Requirement: Every ordinary command explains correctable invocation failures

每个已注册普通命令的参数解析失败 MUST 指出已知的错误类别或定位事实，并给出该命令可执行的修正方向；参数名称、允许值或范围在拥有规则的校验器已知且安全时 SHALL 直接写入 `message`。校验器和解析器 MUST 不依赖顶层 renderer 猜测错误原因。命令级 Help 提示 SHALL 作为解析事实不足时的安全下一步，而非代替已知事实。

#### Scenario: Parser failure on every registered command

- **WHEN** 任意已注册普通命令收到不适用或未知选项、缺失必填参数等非法调用
- **THEN** 失败的 `message` MUST 说明调用问题并指向该命令的有效用法，不只返回固定的 “The command invocation is invalid.”

#### Scenario: Parser rejects a declared choice

- **WHEN** 已注册命令的枚举 option 或位置参数收到不在 registry 声明列表内的值
- **THEN** `message` MUST 指出该 option 或位置参数，并在列表足够短时列出允许值；列表过长时 SHALL 指向所选命令的 Help。它 MUST 不回显被拒绝的原始输入，也 MUST 不借助顶层 renderer 解析 Commander 异常文本

#### Scenario: Validator knows an option range

- **WHEN** query 整数选项收到越界值
- **THEN** `usage.invalid` 的 `message` MUST 定位选项、说明允许范围并指出修正方向；当 owning validator 已验证同一事实时，MUST 可通过符合公共契约的 `error.details` 输出这些事实，且 MUST NOT 维护第二套语义或从 `message` 反推 details

## ADDED Requirements

### Requirement: Failure details are validator-owned and schema constrained

失败 envelope 的可选 `error.details` SHALL 是非空数组，每项 MUST 使用公共封闭 discriminated shape，至少表达 `kind`、非空 `subject` 和稳定 `reason`，并可在拥有者已验证时表达 `source`、非秘密 `received`、结构化 `expected`、`hint` 与 YAML 行列位置。`kind`、`source.kind`、`reason`、`expected.kind` 和期望类型/格式 MUST 使用封闭枚举；所有对象 MUST 拒绝额外属性。没有已验证事实的失败 MUST 整体省略 `error.details`，不得输出空数组或占位 entry。

结构化事实 MUST 只由真正拥有被违反规则的组件产生。顶层错误转换、allowlist 过滤、failure envelope 构造和 renderer MUST 只做无损传递、预算约束、安全转义或丢弃，MUST NOT 从 `message`、Commander message 或日志文本反推事实。错误码因 command allowlist 不包含而降级为 `runtime.unexpected` 时，原 details MUST 被丢弃。

#### Scenario: Invocation fact reaches both formats

- **WHEN** 调用者执行 `lore query "release validation" --min-coverage-percent 101 --json`
- **THEN** 失败 MUST 保持 `usage.invalid` 与 exit code 2，并在 `error.details[0]` 定位 command-line 的 `--min-coverage-percent`、说明 out-of-range、非秘密 received 值和 0–100 integer range；text 输出 MUST 呈现同一事实

#### Scenario: Configuration fact reaches both formats

- **WHEN** 用户配置包含 `query.maxWaitMs: nope`，且调用者执行 `lore query "release validation" --json`
- **THEN** 失败 MUST 保持 `query.config-invalid` 与 exit code 2，并在 `error.details[0]` 定位 config-file 的 `query.maxWaitMs`、说明 invalid-type、非秘密 received 值和 0–120000 integer range；text 输出 MUST 呈现同一事实

### Requirement: Failure details are bounded and terminal safe

details 数量、subject、received、hint、environment variable name 和 enum expected values MUST 受稳定输出预算约束；超长自由文本 MUST 按 Unicode code point 确定性截断。C0、DEL、C1、line separator 与 bidi control characters MUST 被转义为可见 escape sequence。text details MUST 保持单行。对象、数组、未知结构和被拥有者视为 secret 的值 MUST NOT 出现在 `received`；secret 值 MUST NOT 被拼入 message 或 details，但 subject、source、reason 与安全修正方向仍 SHOULD 保留。

#### Scenario: Received value contains control characters

- **WHEN** 一个允许回显的非秘密 received 值包含 CR/LF、ESC 或 bidi control
- **THEN** JSON details 和 text detail MUST 表示同一安全单行文本，并 MUST 不执行控制效果

#### Scenario: Invalid detail is defensively dropped

- **WHEN** envelope 边界收到非法、不可约束或不可 JSON 安全序列化的 detail
- **THEN** 该 detail MUST 被丢弃；若因此没有剩余 detail，MUST 整体省略 `error.details`
