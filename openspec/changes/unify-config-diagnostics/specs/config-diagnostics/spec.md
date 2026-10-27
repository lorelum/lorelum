## Purpose

让用户在实际消费配置的命令中直接定位可纠正的设置与来源，在保持既有 CLI 输出协议、配置优先级和失败边界的同时，区分终止错误与不阻塞业务的日志降级，避免重复信息和虚假的定位精度。

## ADDED Requirements

### Requirement: Consumers choose propagation or an explicit fallback

配置失败 SHALL 保留同一来源与规则事实，由消费方选择传播为原终止错误，或按既有允许降级的行为明确采用默认值。选择降级时 MUST 如实说明实际采用值及已知拒绝原因，不把默认值伪装成用户设置已被接受。诊断 MUST 不新增配置消费范围、校验阶段或公共字段；无法归类的代码异常 MUST 不被猜测成 YAML、字段或来源事实。

#### Scenario: A required setting is invalid

- **WHEN** 必须使用配置的消费者遇到其 validator 已报告的配置失败
- **THEN** 它 MUST 按原错误和退出语义传播，不能因另一个消费者可降级就静默采用默认值

#### Scenario: An optional setting has a permitted fallback

- **WHEN** 消费者按既有允许的降级行为采用明确默认值
- **THEN** 它 MUST 保留原业务可用性，并使降级说明和本机证据中的采用值与实际运行值一致；显式单次覆盖 MUST 如实反映在最终有效值中

### Requirement: Consumed configuration errors identify a repair target

普通 CLI 因消费用户级 query、backend 或 embedding 配置而终止时，SHALL 在既有 `error.message` 中说明已知来源、设置或 section、实际失败规则及修改/移除方向。终止性 query 配置错误 MUST 保留 `query.config-invalid`，Backend/embedding 配置错误 MUST 保留 `backend.config-invalid`，均以 exit 2 结束。Pack canonical commit 后 `indexSync.failed` 等既有非终止结果 MUST 保持原成功 envelope、字段及退出语义，不提升为顶层失败。text 与 JSON MUST 使用同一安全消息，MUST NOT 新增 `error.details`、`diagnostics.notices` 或要求调用方解析 message。

#### Scenario: Query integer is rejected

- **WHEN** `query.maxWaitMs` 是字符串，或 `query.minCoveragePercent` 超出允许范围
- **THEN** 消息 MUST 指出对应完整 key、配置文件来源、整数要求与实际允许范围；调用 MUST 在连接 Backend 前失败，不改写配置

#### Scenario: Backend input has a known rule

- **WHEN** Backend timeout、embedding 嵌套字段、unknown field 或允许的环境变量/内部 override 无效
- **THEN** 消息 MUST 区分文件、具体环境变量或 override 来源，并保留 owning validator 确知的字段与类型/范围/枚举/路径/URL/大小约束；无法定位单一字段时 MUST 只定位相关 section，不展示凭据或未经筛选的原始异常

### Requirement: Document failures report only reliable source facts

配置文件无法读取、类型不符、超过既有大小上限、YAML syntax 或 root shape 无效时，SHALL 说明可靠的文件来源、失败类别和修正方向。YAML 行列 MUST 仅在 parser 提供时显示为一基位置；MUST NOT 暴露 parser snippet、原始异常或猜测的字段位置。缺失、空或仅注释的文档 MUST 继续使用既有默认值。

#### Scenario: YAML syntax has a parser location

- **WHEN** YAML parser 拒绝文档并提供可靠行列
- **THEN** 消费者的终止消息 MUST 显示文件、syntax 类别和该位置，不包含配置片段；无可靠位置时 MUST 省略位置

#### Scenario: Root or file shape is invalid

- **WHEN** root 为数组，或文件过大/类型不符/读取失败
- **THEN** 消息 MUST 显示该已知类别，而不是错误声称某个 logging/query key 无效或伪造 YAML 行列

### Requirement: Configuration presentation preserves consumption and failure ownership

诊断 SHALL 保持现有的设置消费范围、优先级、显式覆盖、query 输入校验优先级与 Backend launch snapshot。logging fallback 与终止错误来自同一来源的文档级失败时，CLI MUST 只呈现终止错误，不额外呈现相同原因的 logging 提示；独立 logging 设置错误 MUST 不因无关终止错误被隐藏。原有 envelope v2、resource、trace、stdout/exit 和 Hook ABI MUST 保持。

#### Scenario: The same malformed document causes terminal failure

- **WHEN** logging 初始化遇到 malformed YAML，随后 query/Backend 也因同一来源的文档错误失败
- **THEN** CLI MUST 保留该 terminal error 和 exit 2，并省略重复 logging 配置提示；可写时 MUST 仍保留真实 fallback 的本机记录

#### Scenario: Logging fallback is independent from the final failure

- **WHEN** logging.level 非法，而命令因另一个设置、usage 或业务原因失败
- **THEN** CLI MUST 提示一次 logging fallback，并保留原终止错误、优先级和退出码

#### Scenario: An unused setting is not newly validated

- **WHEN** keyword 路径或显式方法覆盖按既有规则不消费错误的 semantic method
- **THEN** 调用 MUST 保持原可用行为，不借诊断新增该设置校验、不连接无关 Backend、不改写用户文件

#### Scenario: Pack commit remains successful when index configuration is invalid

- **WHEN** Pack canonical commit 成功，但共享 query method loader 因配置失败而使后续 indexSync 失败
- **THEN** 调用 MUST 保留 canonical success 与既有 `indexSync.failed`，不回滚 Pack、不转换为顶层配置失败；独立 logging fallback 的现场提示 MUST 仍可呈现
