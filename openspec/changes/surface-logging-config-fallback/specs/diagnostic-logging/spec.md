# diagnostic-logging Specification (delta)

## MODIFIED Requirements

### Requirement: Debug mode controls detailed local collection independently from stderr presentation

系统 SHALL 支持 `lore --debug <command>` 作为一次调用的最高详细本机日志覆盖，并支持用户配置 `logging.level: debug` 持续启用详细本机记录，使自动触发的 Hook 与后台 runtime 在发行版中也可被排障。`logging.level` MUST 至少支持 `error`、`warn`、`info`、`debug`，默认值 MUST 记录正常运行所需的 `info`、`warn` 与 `error`；单次 `--debug` 对该次 CLI 调用及其传入的 Backend request 生效，但不得永久改写配置。

当 persistent `logging.level` 的值无效时，系统 MUST 按默认 `info` 继续完成不依赖 logging level 的业务命令（fail-open 保留），但 MUST NOT 把该无效设置伪装成已生效：本次 invocation MUST 按 `cli-invocation-notices` 契约产生一条结构化 notice，并按"Invalid persistent logging level is surfaced and recorded as invocation evidence"记录本机证据。`--debug` 存在时 MUST 仍读取 persistent `logging.level` 以检测无效值；此时实际生效等级 MUST 保持 `debug`，通知 MUST 同时如实说明"persistent 配置未生效"与"本次实际生效 `debug`"两个事实，不得只呈现其一。

既有 `--log-level` MUST 继续只选择 stderr 呈现等级，不得隐式改变持久 logger 的收集等级或用户配置。详细模式不解除 credential 自动排除、私有文件权限、留存上限或反馈外发审阅要求。

#### Scenario: A release user reproduces a Hook issue with persistent debug enabled

- **WHEN** 用户在本机配置 `logging.level: debug` 后由宿主自动运行 `lore hook <host>`
- **THEN** Hook MUST 在不改变 stdout response 的情况下记录 debug payload handling、catalog rendering 和降级原因；后续用户可用 `lore logs` 查看对应 source/trace 的记录

#### Scenario: A user requests one detailed query reproduction

- **WHEN** 用户执行 `lore --debug query ...`，而配置的持续等级不是 `debug`
- **THEN** 此次 CLI 和关联 Backend request MUST 记录 debug 级 context，命令结束后配置的持续等级 MUST 保持原值，且 `--log-level` 的 stderr 选择语义不改变

#### Scenario: A one-shot debug override coexists with an invalid persistent level

- **WHEN** 用户配置了无效的 `logging.level: noisy`，并执行 `lore --debug query ...`
- **THEN** 本次实际生效等级 MUST 是 `debug`，且调用方 MUST 同时得到 persistent 配置未生效与本次生效 `debug` 两个事实；系统 MUST NOT 因为 override 存在而跳过对 persistent 配置的检测

## ADDED Requirements

### Requirement: Invalid persistent logging level is surfaced and recorded as invocation evidence

当 persistent `logging.level` 无效并在调用起点被回退时，logging runtime MUST 在日志目标可写的情况下，把该回退作为与本次 trace 关联的一条 `warn` 级 LogRecord 写入该 invocation 的日志段，携带 setting 名、收到的非秘密值、实际生效 level 与配置来源，使 `lore logs --trace-id <traceId>` 与 `lore feedback draft --trace-id <traceId>` 能解释"为什么本次没有预期级别的记录"，而不是只表现缺失。该证据记录 MUST 与 envelope notice、text 说明使用同一组事实，不得一个入口说"没有日志"、另一个入口无说明地省略回退。

日志目标不可写或已降级时，notice 与 text 说明仍 MUST 出现，证据记录按既有 sink 降级与 missing-evidence 语义处理；本能力 MUST NOT 为此新增 evidence 词汇（evidence 状态统一由相关变更负责）。notice 与证据记录 MUST 只出现在发生回退的 invocation；系统 MUST NOT 自动改写用户 config，用户按通知说明改回合法 level 即可，无需执行权限命令、重置目录或阅读内部日志实现。Host Hook 与 CLI 共享该行为：Hook 可在 stderr 留下有限提示并写入证据记录，但 host stdout ABI MUST 保持不变。

#### Scenario: A fallback invocation leaves explainable trace evidence

- **WHEN** 无效 `logging.level` 下执行一次普通命令并得到 `diagnostics.traceId`，随后运行 `lore feedback draft --trace-id <traceId> --kind bug --include-logs debug`
- **THEN** 该 trace 的证据 MUST 包含说明 persistent logging level 无效并被回退的 `warn` 记录，使调用方能区分"没有开启 debug"与"日志未被持久化"

#### Scenario: An unwritable log directory still surfaces the fallback

- **WHEN** 日志根目录不可写且 persistent `logging.level` 无效
- **THEN** 本次调用仍 MUST 完成业务结果并在 envelope/text 中携带回退事实；仅证据记录缺失，且主结果 MUST NOT 因此失败

#### Scenario: A healthy level leaves no extra evidence

- **WHEN** `logging.level` 合法或未配置
- **THEN** invocation MUST NOT 产生回退 notice 或回退证据记录，正常调用不增加常驻本机记录
