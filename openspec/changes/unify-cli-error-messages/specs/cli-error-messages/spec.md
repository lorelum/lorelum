## Purpose

定义普通 `lore` 命令失败时唯一的人类可读消息通道，使已知且可纠正的错误在 text 与 JSON 中都能说明原因和下一步，同时保持稳定的错误标识、安全兜底及既有协议形状。

## ADDED Requirements

### Requirement: Ordinary command failures use one public message

所有已注册的普通 CLI 命令在返回失败 envelope 时 SHALL 包含 `error.code` 和人类可读的 `error.message`，text 模式 SHALL 在 stderr 呈现同一消息。公共 failure schema MUST 不包含 `error.details`；响应 MUST 保留既有 `protocolVersion: 2`、exit code、`diagnostics.traceId`、可选 `error.recovery` 和 success envelope 语义。Host Hook 专用 ABI 不属于普通命令响应。

#### Scenario: Same error in both formats

- **WHEN** 同一个普通命令以 text 和 `--json` 模式分别遇到可纠正的错误
- **THEN** 两种输出 MUST 给出语义相同的 `message`、相同的 error code 与 exit code；JSON failure MUST 通过公共 schema 校验且不含 `error.details`

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
- **THEN** `usage.invalid` 的 `message` MUST 定位选项、说明允许范围并指出修正方向，且 MUST 不输出第二条 details 通道

### Requirement: Known configuration and domain failures retain actionable facts

普通命令读取配置或处理已分类的领域失败时，拥有规则的组件 MUST 在安全范围内把已知的 key、来源或允许范围写入 `message`，或给出一条明确的恢复操作。它 MUST 不回显标为 secret 的值、不暴露内部堆栈或未验证猜测。未知或不可安全归因的异常 MUST 降级为既有通用错误。

#### Scenario: Invalid configuration has a repair target

- **WHEN** query 或 Backend 配置中的已知设置无效
- **THEN** 可见错误 `message` MUST 指出设置或来源及修改/移除方向，text 与 JSON 都 MUST 可读

#### Scenario: Unexpected or undeclared error stays private

- **WHEN** 命令抛出未知异常或其错误码不在该命令公开 allowlist 中
- **THEN** failure MUST 使用 `runtime.unexpected` 的安全通用 `message`，且 MUST 不泄露原异常内容

### Requirement: Messages stay bounded and terminal-safe

最终对外的 `message` MUST 是有界单行文本；换行、终端控制符与双向控制符 MUST 被转义或安全替换。已验证的非秘密事实 SHOULD 保留在预算内；secret 值 MUST 不被拼入消息。

#### Scenario: Rejected input contains terminal controls

- **WHEN** 一个非秘密无效值含换行、ESC 或双向控制字符
- **THEN** text stderr MUST 不执行控制效果、不新增消息行，JSON `error.message` MUST 表示同一安全文本
