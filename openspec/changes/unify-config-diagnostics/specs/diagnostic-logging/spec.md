## ADDED Requirements

### Requirement: Invalid logging configuration has an honest non-blocking outcome

CLI、Hook 和 daemon 读取非法或不可读的 logging 配置时，SHALL 将持续收集等级回退为 `info`，保留原业务的成功、失败或 Hook no-op 结果，不改写配置。CLI/Hook 单次 `--debug` MUST 仍使 effective level 为 `debug`，且 MUST 不掩盖持续设置未生效的事实；request-scoped debug MUST 不改变 daemon 全局收集等级。正常、缺失和空配置 MUST 不产生 fallback 提示。

CLI/Hook MUST 经 stderr 对一次 fallback 提示恰好一次，说明已知来源、设置或文档失败类别、允许规则、回退和实际等级，以及修正方向；消息 MUST 有界、单行且 terminal-safe，不受 `--log-level` 过滤。普通 JSON stdout 与 Hook raw stdout MUST 不变。与同源文档级 terminal error 的去重 SHALL 遵守 config-diagnostics 的失败所有权要求。

无法归类的 logging 读取异常 SHALL 保留既有不阻断业务的可用性策略，只说明设置无法采用与实际 fallback/effective 等级，MUST NOT 猜测来源、key、YAML reason、行列或展示原异常；此类不可分类结果 MUST 不参与文档同因去重。

#### Scenario: Invalid level does not invalidate a successful command

- **WHEN** `logging.level: noisy`，用户运行普通成功命令，包括 `--json --log-level error`
- **THEN** 命令 MUST 保留原业务输出和退出码，并在 stderr 提示一次 level、允许枚举、fallback info、effective info 与配置来源，不增加 JSON notice

#### Scenario: Debug overrides collection but does not hide rejection

- **WHEN** 同一无效 persistent 配置的调用带 `--debug`
- **THEN** 此次 MUST 实际收集 debug，并在提示中区分 persistent fallback info 与 effective debug；配置 MUST 不被改写

#### Scenario: Hook keeps its native response

- **WHEN** 自动 Hook 遇到无效 logging 配置
- **THEN** 它 MUST 继续原 host response 与非阻塞策略，只在 stderr 提示一次配置 fallback，不增加普通 CLI envelope 或 metadata

#### Scenario: Optional logging settings are unexpectedly unavailable

- **WHEN** logging 设置读取遇到不能归类为配置失败的异常
- **THEN** 命令 MUST 保留原业务结果，以 info 或该次 debug 运行，并只说明已知的未采用设置及实际等级，不将异常重分类成 YAML 或某个 key 的错误

### Requirement: Logging fallback leaves real evidence within the owning runtime

可用 sink 中，每次 logging fallback SHALL 留存一条 `logging.level-fallback` warning，包含安全的来源、拒绝规则、fallback 与 effective 等级。CLI/Hook 记录 MUST 关联自身 trace；daemon startup 记录 MUST 属于 Backend source 与其 instance，不附会启动 CLI 或其他 request 的 trace。记录 MUST 使用既有日志通道，MUST NOT 新增全局事件 schema、持久 notice 状态或推测的缺失原因。

#### Scenario: A user reads a CLI fallback trace

- **WHEN** 用户对已保存 fallback 记录的 invocation 执行 `lore logs --trace-id` 或本地 feedback draft
- **THEN** 既有读取范围允许时 MUST 返回该条真实记录；debug 未收集时 MUST 不因 warning 存在就声称 debug 已收集或删除既有缺失标记

#### Scenario: A daemon resolves its own logging configuration

- **WHEN** detached daemon 启动时遇到 logging fallback，且其日志 sink 可用
- **THEN** 它 MUST 保存一条 Backend startup fallback 记录，保留原启动结果；MUST 不承诺经被忽略的子进程 stderr 提示用户，也不得为此转发子进程输出或扩展 wire protocol

#### Scenario: Logging evidence cannot be saved

- **WHEN** CLI/Hook sink 不可用，或 daemon sink 在既有安全预检后发生 I/O 故障
- **THEN** 系统 MUST 保持已有 sink 失败处理与业务结果；CLI/Hook MUST 保留现场 fallback 提示和既有 sink-failure 提示，后续读取 MUST 只报告实际记录及既有缺失信息，不捏造 fallback 已保存；daemon 安全预检的拒绝边界 MUST 不变
