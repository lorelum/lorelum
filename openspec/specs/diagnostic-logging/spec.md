# diagnostic-logging Specification

## Purpose

为 Lorelum 的 CLI、Backend、Host Hook 与开发者提供可关联、可查看、可管理的本机日志，使发行版问题能够复现和定位，同时不把本机记录自动扩展成外发、上传或远程 telemetry。

## Requirements

### Requirement: Local logger is direct to use and preserves useful local context

系统 SHALL 通过内部 `@lorelum/log` workspace package 提供 `debug`、`info`、`warn`、`error` 的本机 logger。调用方 MUST 能以字符串 message 和普通 JSON context 记录新日志，并可将 Error 交给 logger 序列化；新增普通日志 MUST NOT 要求先修改全局 event union、字段类别表或单字段字节上限。logger MUST 支持可选的 `traceId`、`requestId`、`operationId`、`preparationId`、`nativeRunId` 上下文，使同一次调用及其原子节点能够关联而不把共享 operation 归属于唯一 trace。

logger MUST NOT 自动记录 authorization、cookie、Bearer token、private key、probe credential，或通过扫描环境、配置、仓库与完整 HTTP request 发现的 secret。对调用方显式给出的普通本机 context，logger MUST 不仅因为它是 query、Practice、路径、模型、原生输出或错误文本而自动脱敏、截断或拒绝；已知 credential key/value 仍必须在写入前排除。

#### Scenario: Developer records a new query-adjacent log without schema work

- **WHEN** Backend 开发者以带有 `traceId` 的 logger 写入 `info("query.completed", { query, durationMs })`
- **THEN** 该条记录 MUST 保留 message、关联 ID 和本机 context，且开发者不需要新增全局诊断事件声明；若 context 含 `authorization` 或 `cookie` 键，其值 MUST 不进入 sink

#### Scenario: Logger serializes an unhandled error locally

- **WHEN** CLI、Backend 或 Hook 将 Error 作为 `error` logger 的 error 参数提供
- **THEN** 本机记录 MUST 包含足以排障的 error 名称、message 与 stack（如果存在），并保留已有关联上下文；logger 不得因为 Error 未被上层处理而终止原业务或改变 stdout 协议

### Requirement: Trace context relates an end-to-end invocation without restricting ordinary logs

普通 CLI 调用 SHALL 在开始时创建 `traceId`，并通过受保护的 Backend transport metadata 传入同一调用链。普通 CLI JSON envelope MUST 在稳定 diagnostics metadata 中返回该 `traceId`；Hook raw stdout ABI MUST 不增加该 metadata。Backend request、operation、preparation 和 native runtime MUST 保留它们各自的 request/operation/preparation/native-run ID，并按接受、加入或因果关系关联 trace；同一共享资源的普通日志可关联多个 trace，且不得泄露另一条 trace 的 request context。

`traceId` 是关联与检索根，不是 logger 的写入许可：没有 trace 的 daemon、启动、清理或开发调试日志仍 MUST 可被记录和按 source 查看。

#### Scenario: A semantic request crosses CLI and Backend

- **WHEN** 普通 `lore query` 调用经 authenticated loopback request 进入 Backend 并触发 operation 或模型准备
- **THEN** CLI envelope MUST 返回本次 `traceId`，Backend request/operation/preparation/native 日志 MUST 可通过该 trace 与其原子 ID 追溯；另一并发 trace 的 query、error 与普通 context MUST 不被归入该 trace

#### Scenario: A Hook handles an unsupported payload

- **WHEN** `lore hook <host>` 收到不支持或畸形的 payload
- **THEN** Hook MUST 用自己的 trace 记录本机 warning/error 与足够的 debug context，stderr 保留简短 degraded 提示，stdout 仍 MUST 仅输出原有 continue envelope 并以退出码 0 返回

### Requirement: Persistent local logs cover CLI, Backend, and Hooks
CLI、Backend 与每个支持的 Host Hook SHALL 将启用等级的日志写入用户级 Lorelum 日志根目录，并按 source 与调用/运行段隔离，以避免短命令或并发 Hook 争用同一 append 文件。Backend 的长驻日志 MUST 轮转；CLI 与 Hook 的短调用日志 MUST 可按 trace 段定位。自动创建的目录与文件 MUST 为当前用户私有；已存在的受管日志段与受管日志文件按"Managed log locations self-heal within the logs subtree"要求保持私有。保留策略 MUST 有文件/总量上限并在后续写入或显式清理时删除最旧的受管理日志。

一次 sink 写入、轮转、flush 或清理的普通 I/O 故障 MUST 禁用或跳过该 sink，且不得把已完成的 query/index/model/Hook 结果变成失败、阻止必要 cleanup 或伪造 success。日志位置在写入前按受管位置自愈规则判定：可安全使用（含收紧后）即写入；不能安全使用时，该次调用 MUST NOT 持久化诊断日志，并 MUST 经既有 stderr 通道以一行提示说明已知的失败类别，而原命令的业务结果、错误码与 exit code MUST 保持不变；Host Hook 的 raw stdout ABI MUST 不变。通过安全校验后发生的写入、flush 或轮转失败维持既有禁用语义，同样只按该行提示报告。符号链接替换、越界路径或归属不明的不安全目标 MUST 继续安全失败，绝不被自动改动或用于写入。日志不是 Store、operation 或 runtime 状态的事实来源；事后读取 MUST 只报告实际读到的记录与读取限制，不得推断当时的失败原因。

#### Scenario: A CLI and Hook run concurrently
- **WHEN** 用户同时运行普通 CLI 调用和多个宿主 Hook
- **THEN** 每条记录 MUST 作为完整日志记录写入所属 source/trace 段，任一进程不得截断或混写另一进程的记录；Hook stdout ABI 与普通 CLI 的单行 JSON stdout MUST 不变

#### Scenario: A log sink becomes unavailable after safe startup
- **WHEN** 已通过安全预检的日志目录在运行中变得不可写或轮转失败
- **THEN** 受影响 sink MUST 停止继续写入并可在 stderr 留下有限提示，但对应业务操作仍 MUST 按原结果完成和清理；随后 `lore logs` MUST 如实表现可读取的记录或缺失范围，而不得捏造日志

#### Scenario: The log location is unusable from the start
- **WHEN** 一次普通 CLI 调用启动时其受管日志位置即不可安全使用（例如信任根是符号链接或归属他人），该调用以业务失败（如无效输入）或成功结束
- **THEN** 原命令 MUST 输出与其日志位置可用时完全一致的业务结果、错误码与退出码；stderr 除既有限制输出外 MUST 恰好多一行说明已知失败类别的提示；随后 `lore logs --trace-id <traceId>` MUST 只报告实际读到的证据（例如空记录与既有缺失词汇），MUST NOT 断言当时写入失败的原因

### Requirement: Debug mode controls detailed local collection independently from stderr presentation

系统 SHALL 支持 `lore --debug <command>` 作为一次调用的最高详细本机日志覆盖，并支持用户配置 `logging.level: debug` 持续启用详细本机记录，使自动触发的 Hook 与后台 runtime 在发行版中也可被排障。`logging.level` MUST 至少支持 `error`、`warn`、`info`、`debug`，默认值 MUST 记录正常运行所需的 `info`、`warn` 与 `error`；单次 `--debug` 对该次 CLI 调用及其传入的 Backend request 生效，但不得永久改写配置。

既有 `--log-level` MUST 继续只选择 stderr 呈现等级，不得隐式改变持久 logger 的收集等级或用户配置。详细模式不解除 credential 自动排除、私有文件权限、留存上限或反馈外发审阅要求。

#### Scenario: A release user reproduces a Hook issue with persistent debug enabled

- **WHEN** 用户在本机配置 `logging.level: debug` 后由宿主自动运行 `lore hook <host>`
- **THEN** Hook MUST 在不改变 stdout response 的情况下记录 debug payload handling、catalog rendering 和降级原因；后续用户可用 `lore logs` 查看对应 source/trace 的记录

#### Scenario: A user requests one detailed query reproduction

- **WHEN** 用户执行 `lore --debug query ...`，而配置的持续等级不是 `debug`
- **THEN** 此次 CLI 和关联 Backend request MUST 记录 debug 级 context，命令结束后配置的持续等级 MUST 保持原值，且 `--log-level` 的 stderr 选择语义不改变

### Requirement: Users can inspect and manage their local logs through the CLI

系统 SHALL 提供 `lore logs` CLI surface，使用户能按 source、level、`traceId` 和 limit 读取受管理的本机日志，并在 JSON envelope 中得到记录、来源与明确的缺失/截断信息。系统 SHALL 提供显式的 `lore logs prune` 清理入口；它 MUST 只删除 Lorelum 管理的超出当前保留策略或用户指定范围的日志，MUST 不扫描或删除任意用户目录、Store、反馈 artifact 或运行时状态。

日志读取 MUST 不启动 Backend/model、下载模型、执行 query 或修改 Store/index/runtime；读取损坏、已轮转、缺失或不可访问文件时 MUST 返回可解释的部分结果/缺失信息，而不得把其他 source 的内容填充为匹配 trace 的内容。

#### Scenario: User views a trace after a failed CLI call

- **WHEN** 用户从 CLI envelope 复制 `traceId` 并执行 `lore logs --trace-id <traceId> --limit 100`
- **THEN** 命令 MUST 在单个 JSON envelope 中按时间返回该 trace 的可读取记录、source 和 level，并报告已轮转或不可读 evidence；它不得启动 daemon 或输出另一 trace 的普通 context

#### Scenario: User prunes retained logs

- **WHEN** 用户显式执行 `lore logs prune`
- **THEN** 系统 MUST 仅清除已由保留规则淘汰的 Lorelum 日志并返回删除统计；若没有可安全删除的受管理日志，MUST 成功返回零删除而不得触碰其他文件

### Requirement: Managed log locations self-heal within the logs subtree
私有性边界 SHALL 由威胁模型定义：日志文件内容与文件名（含 traceId、日期）必须私有；`~/.lorelum` 的存在性与"其下有 logs 目录"不是秘密。`~/.lorelum` 及其上任何目录 MUST 只做结构检查（非符号链接、类型正确、归当前 OS 用户所有），MUST NOT 检查或修改其权限，MUST NOT 检查或修改 `~/.lorelum` 之上的任何目录；缺失的信任根以私有权限创建。从受管日志根（`~/.lorelum/logs`）向下到目标目录的每个路径段与受管 `.jsonl` 日志文件，系统 SHALL 在写入前检查：归当前用户、非符号链接、类型正确（文件另须 `nlink === 1`），且 group/other 权限过宽时 MUST 以只减不增的掩码收紧（仅清除 group/other 位，原样保留所有者与特殊位）。校验与收紧 MUST 作用于同一打开的文件系统对象；无法对同一对象安全收紧时 MUST 拒绝该位置，MUST NOT 退回按路径 chmod。自建目录/文件创建即私有。自愈 MUST 静默完成，不提示用户执行 `chmod`、修改路径或重跑初始化命令。

满足以下任一条件的目标 MUST NOT 被自动改动，也 MUST NOT 被用于写入：符号链接、类型不符、多硬链接文件、非当前用户所有、掩码后所有者权限不足以完成写入（例如 `0505` 目录、`0044` 文件）、路径越界。`~/.lorelum` 下不属于日志路径的内容 MUST NOT 被触碰。信任根归属他人时，当次提示 SHALL 给出聚焦该路径的非递归修复指引（不建议递归修改整个 `~/.lorelum`）。Windows 无 mode/uid 语义：安全判断 SHALL 退化为结构检查（非符号链接/junction、类型正确，文件另须 `nlink === 1`），权限自愈不适用；受管位置在 Windows 上的私有性由用户 profile 根的既有 ACL 边界保证，规范不承诺超出该边界的平台私有性。

#### Scenario: A user-owned 0755 Lorelum root no longer loses trace logs
- **WHEN** 默认 Lorelum 根目录已存在、归当前用户所有、是普通目录，但 mode 为 `0755`，普通 CLI 调用需要写入该次 trace 日志
- **THEN** 系统 MUST 正常持久化该次日志（受管段私有），MUST NOT 改变 `~/.lorelum` 的任何权限位，业务结果与输出与私有根时完全一致；随后 `lore logs --trace-id <traceId>` MUST 能读回该次记录

#### Scenario: A widened managed subtree and log file are tightened
- **WHEN** 受管日志段目录（如 `0755`）或已有受管 `.jsonl` 文件（如 `0644`）归当前用户所有、非符号链接、文件单链接，sink 需要写入
- **THEN** 系统 MUST 在写入前以掩码方式收紧（`0755` → `0700`、`0644` → `0600`，保留所有者位与特殊位）并作用于同一对象，随后正常写入；收紧静默完成

#### Scenario: A mask-only tighten never adds owner permissions
- **WHEN** 受管日志目录的 mode 为 `0505`（所有者无写位）或受管日志文件的 mode 为 `0044`（所有者无读写位）
- **THEN** 系统 MUST NOT 为修复增加任何权限位；该位置 MUST NOT 被 chmod 或写入，当次按一行 stderr 提示报告已知失败类别

#### Scenario: Symlinks, wrong types, hard links, and foreign owners are never touched
- **WHEN** 受管日志路径上某段是符号链接、非目录/非文件类型不符、目标文件存在额外硬链接（`nlink > 1`），或（以注入 stat 结果在决策单测中覆盖）归属当前用户之外的 uid
- **THEN** 系统 MUST NOT 对其 chmod 或写入，MUST 保持目标内容与其权限不变，当次按一行 stderr 提示报告已知失败类别

#### Scenario: A foreign-owned Lorelum root gives focused non-recursive guidance
- **WHEN** 信任根 `~/.lorelum` 归当前用户之外的用户所有（例如曾以 `sudo` 运行 `lore`），一次普通 CLI 调用执行
- **THEN** 业务结果与退出码 MUST 不变；当次 stderr 提示 MUST 指出该路径归属他人并给出聚焦该路径的非递归修复指引，MUST NOT 建议对整个 `~/.lorelum` 递归 chown

#### Scenario: A target replaced between check and tighten is not modified
- **WHEN** 安全校验与收紧之间，受管日志路径上的目标被替换为另一对象
- **THEN** 收紧 MUST NOT 作用于替换后的对象；实现 MUST 以绑定同一文件系统对象的方式完成校验与收紧，使该替换无法被利用

#### Scenario: HOME and ancestors keep their permissions bit-for-bit
- **WHEN** 任意场景下的 CLI/Hook 调用执行日志位置自愈、拒绝或写入
- **THEN** 用户主目录与 `~/.lorelum` 之上的任何目录的权限位 MUST 逐 bit 保持不变（以回归测试守卫）

### Requirement: Ordinary command lifecycle has single stage evidence

当收集等级允许对应记录时，普通 CLI 调用 SHALL 为同一次 invocation 的开始与完成各持久化一份生命周期证据，MUST 不仅因同时接入普通 logger 和诊断适配器而重复记录相同阶段。失败所需的错误详情与 stack SHALL 继续保留；阶段去重 MUST 不改变 stdout、业务错误码、退出码、trace 关联、凭据排除或日志失败隔离。

#### Scenario: Successful command records each lifecycle stage once

- **WHEN** 一个普通 CLI 命令以启用 info 的收集设置成功完成
- **THEN** 该 invocation SHALL 有一个开始和一个完成阶段记录，且 stdout 与原命令合同一致

#### Scenario: Failed command retains diagnostics without changing business output

- **WHEN** 命令失败，或诊断 sink 不可用
- **THEN** 系统 MUST 保留原命令错误码、输出与退出码；可记录时 SHALL 保留失败排障信息与 trace，日志不可用时 SHALL 沿用现有有限提示与缺失语义

### Requirement: Trace collection preserves independent bounded evidence windows

按 trace 收集日志 SHALL 分别限制该 trace 的直接记录与用于查找 shared lifecycle 的全局记录窗口。direct record MUST 不因被其他 trace 挤出全局窗口而丢失。shared record SHALL 仅沿选中的原子关系 ID 收集未归属其他 trace 的记录；缺失、损坏和任一窗口截断 MUST 继续如实报告。

#### Scenario: An older direct record survives a crowded global window

- **WHEN** 指定 trace 的记录早于全局最近窗口，且其数量仍在 direct 窗口限额内
- **THEN** 收集结果 MUST 保留该 direct record；全局窗口截断 SHALL 如实报告，不得用其他 trace 的记录替代

#### Scenario: Shared lifecycle does not import another trace context

- **WHEN** 两个 trace 关联同一 operation，而可读日志包含 anonymous lifecycle 与另一 trace 的 context
- **THEN** 当前 trace SHALL 能收集匹配的 anonymous lifecycle，MUST 不返回另一 trace 的普通 context；读取失败与截断信息 MUST 保留
