# cli-invocation-notices Specification

## Purpose

为公共 `lore` envelope 提供 invocation 级、非致命运行事实的结构化通道：当某次调用的运行状态与用户持久配置声明不一致（例如 invalid `logging.level` 被回退）时，该事实能以受 schema 约束、可机器读取的形式到达 text 与 JSON 调用方，而不是在 fail-open 内部丢失，同时不改变主结果、exit code 或 stdout 单行 JSON 合同。

## ADDED Requirements

### Requirement: Envelope diagnostics carries invocation-scoped structured notices

公共 envelope 的 `diagnostics` 对象 SHALL 支持可选的 `notices` 数组，success 与 failure envelope 都可承载；每项是一个固定的 discriminated 对象，不是任意 key-value map。每个 entry MUST 提供：

- `kind`:封闭枚举，首个类别为 `configuration`;新增类别 MUST 先扩展本契约。
- `subject`:非空的稳定定位符，例如 `logging.level`。
- `reason`:封闭枚举，复用 `cli-error-details` 契约的 reason 词汇（本类别首个使用的 reason 是 `invalid-value`）。
- 可选 `received`:被拒绝值的规范字符串表示，受输出预算约束。
- 可选 `expected`:受约束的三种变体之一——`enum`、`integer-range` 或 `type`，与 `cli-error-details` 的 `expected` 变体同形。
- 可选 `effective`:本次 invocation 实际生效的值，例如回退后的 `logging.level`。
- 可选 `source`:该设置来源的稳定定位，例如 config 文件路径。

公共 JSON schema MUST 显式定义该结构，且 `diagnostics`、每个 notice entry、每个 `expected` 变体都保持 `additionalProperties: false`;schema MUST 拒绝未定义属性、未列出的 `kind`/`reason` 值、未知 `expected` 变体与空 `notices` 数组。没有可通知事实的调用 MUST 整体省略 `diagnostics.notices`,而不是输出空数组。

#### Scenario: An invalid logging level produces one notice on a successful command

- **WHEN** 用户的 `~/.lorelum/config.yaml` 含 `logging.level: noisy`,且调用者执行一个不依赖 logging level 的普通命令（例如 `lore pack list --json`）
- **THEN** success envelope MUST 以 `diagnostics.notices[0]` 携带 `kind: "configuration"`、`subject: "logging.level"`、`reason: "invalid-value"`、`received: "noisy"`、允许的 enum、`effective: "info"` 与 config 来源；命令仍 MUST 成功完成并保持既有 exit code

#### Scenario: A failing command surfaces the same notice

- **WHEN** 同一无效配置下，调用者执行一个因与 logging 无关的原因而失败的命令
- **THEN** failure envelope MUST 在保持既有 error code、message 与 exit code 的同时，于 `diagnostics.notices` 携带同一条 fallback 事实

#### Scenario: A healthy configuration emits no notices

- **WHEN** 配置合法或未配置 `logging.level`
- **THEN** envelope MUST 整体省略 `notices` 字段并与既有形状逐字节同形，正常调用 MUST NOT 增加常驻输出

### Requirement: Notices originate from the owning runtime boundary and stay bounded

结构化 notice MUST 只由真正拥有该运行事实的组件在事实仍然已知的边界产生，例如 logging runtime 读取 persistent 配置的位置；上层 envelope 组装与 renderer MUST 只做无损传递，MUST NOT 从固定文案、异常 message 或日志文本反推或虚构 notice。本机排障事实——setting 名、非秘密值、允许 enum、生效值、配置路径与来源——默认不是 secret,MUST NOT 以泛化的"隐私"理由抹掉；仅当某 config field 被协议明确标记为 secret 时，该值本身 MUST NOT 出现在 `received` 中，但 `subject`、`reason` 与修正方向仍 MUST 保留。

输出体积 MUST 有明确、确定性的预算：notices entry 数量、`subject`、`received`、`source` 与 enum 值有长度上限，超限值 MUST 按稳定规则截断，使相同输入总是产生相同输出。

#### Scenario: A long received value is truncated deterministically

- **WHEN** 配置文件中的无效 `logging.level` 值超过 `received` 的输出预算
- **THEN** notice MUST 保留可定位的截断表示，且同一次输入在重复调用下 MUST 产生字节相同的截断结果

#### Scenario: Setting names and reasons are never redacted

- **WHEN** 任何 notice 产生
- **THEN** `subject` 与 `reason` MUST 完整出现；不得因为通用"隐私"理由省略 setting 名或失败原因

### Requirement: Text mode presents the same facts without interrupting the main result

text 模式 SHALL 在同一次调用的 stderr 呈现每条 notice 的人可读压缩，完整表达"配置值 → 拒绝规则 → 实际生效值"的关系；该说明 MUST NOT 打断、前置改写或取代主结果，MUST NOT 改变 exit code。`--json` 模式的 stdout MUST 仍为合法的单行 JSON,notice 只能出现在 envelope 结构中，MUST NOT 以 prose 混入 stdout。

#### Scenario: Text callers see a single actionable warning line

- **WHEN** 无效 `logging.level` 下以 text 模式执行普通命令
- **THEN** stderr MUST 包含一条说明 `logging.level` 收到的值无效、允许值与本次实际生效 level 的简短提示，主结果与 exit code 保持不变

#### Scenario: JSON stdout stays pure single-line JSON

- **WHEN** 无效 `logging.level` 下以 `--json` 执行同一命令
- **THEN** stdout MUST 仍是恰好一行合法 JSON,且 notice 事实位于 `diagnostics.notices`

### Requirement: Notice compatibility preserves the envelope contract

`diagnostics.notices` 是 envelope 在 `protocolVersion: 2` 内的可选演进：依据既有判例（v1 内新增可选 `error.recovery` 未 bump 版本；新增必填 `diagnostics` 才 bump 到 v2），本契约 MUST NOT 改变 `protocolVersion`、`traceId` 语义、既有 error code、exit code 或不带 notice 的 envelope 形状。不带 notices 的调用 MUST 与既有 envelope 逐字节同形；带 notices 的调用 MUST 通过随 CLI 导出的公共 schema 校验。

#### Scenario: An old-shape envelope remains valid

- **WHEN** 任何不产生 notice 的既有调用执行
- **THEN** 其 JSON envelope MUST 不包含 `notices` 字段、保持 `protocolVersion: 2`,并通过导出的公共 schema 校验
