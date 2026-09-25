## MODIFIED Requirements

### Requirement: Persistent local logs cover CLI, Backend, and Hooks

CLI、Backend 与每个支持的 Host Hook SHALL 将启用等级的日志写入用户级 Lorelum 日志根目录，并按 source 与调用/运行段隔离，以避免短命令或并发 Hook 争用同一 append 文件。Backend 的长驻日志 MUST 轮转；CLI 与 Hook 的短调用日志 MUST 可按 trace 段定位。自动创建的目录与文件 MUST 为当前用户私有；保留策略 MUST 有文件/总量上限并在后续写入或显式清理时删除最旧的受管理日志。

一次 sink 写入、轮转、flush 或清理的普通 I/O 故障 MUST 禁用或跳过该 sink，且不得把已完成的 query/index/model/Hook 结果变成失败、阻止必要 cleanup 或伪造 success。持久化初始化时的位置选择 SHALL 按以下顺序：先按受管日志位置自愈规则收紧权限；不能安全修复时改用设计的私有备用位置；两者都不可用时降级为本次不持久化并按"当次持久化结果"要求报告。位置一经选定，本次调用 MUST NOT 因运行期写入错误中途改换位置：通过安全校验后发生的写入、flush 或轮转失败维持既有禁用语义，并按"当次持久化结果"要求报告该失败。符号链接替换、越界路径或归属不明的不安全目标 MUST 继续安全失败，绝不被自动改动或用于写入。Backend daemon 的启动与就绪 MUST NOT 因日志位置不可用而失败。日志不是 Store、operation 或 runtime 状态的事实来源。

#### Scenario: A CLI and Hook run concurrently

- **WHEN** 用户同时运行普通 CLI 调用和多个宿主 Hook
- **THEN** 每条记录 MUST 作为完整日志记录写入所属 source/trace 段，任一进程不得截断或混写另一进程的记录；Hook stdout ABI 与普通 CLI 的单行 JSON stdout MUST 不变

#### Scenario: A log sink becomes unavailable after safe startup

- **WHEN** 已通过安全预检的日志目录在运行中变得不可写或轮转失败
- **THEN** 受影响 sink MUST 停止继续写入并可在 stderr 留下有限提示，但对应业务操作仍 MUST 按原结果完成和清理；随后 `lore logs` MUST 如实表现可读取的记录或缺失范围，而不得捏造日志

#### Scenario: The Backend daemon starts while its log location is unavailable

- **WHEN** Backend 日志目录经自愈与备用位置仍不可用，daemon 被启动
- **THEN** daemon MUST 继续完成启动并对 query/model/index 请求正常服务，其诊断 sink 降级为禁用；daemon MUST NOT 因此抛出 `backend.state-invalid` 或拒绝就绪

## ADDED Requirements

### Requirement: Managed log locations self-heal before writes

对默认 Lorelum 受管日志位置——受管日志根及其向下到日志文件的每个路径段、Backend 日志目录，以及受管理的 `.jsonl` 日志文件——系统 SHALL 在写入诊断信息前检查其安全性；当日标是普通目录/文件、不是符号链接、类型正确（文件另须 `nlink === 1`）、归当前 OS 用户所有、且问题仅是 group/other 权限过宽时，MUST 在写入前以掩码方式收紧权限：仅清除 group/other 权限位，原样保留所有者权限位。收紧结果 MUST NOT 较原状态增加任何权限位；掩码后所有者权限不足以完成安全写入的目标（例如 `0505` 目录、`0044` 文件）MUST NOT 被自动修复，按备用位置规则继续。校验与收紧 MUST 作用于同一文件系统对象（例如通过打开的描述符完成校验与收紧），MUST NOT 仅按路径先检查、再按路径修改。自愈 MUST 静默完成，不提示用户执行 `chmod`、修改路径或重跑初始化命令。

满足以下任一条件的目标 MUST NOT 被自动改动，也 MUST NOT 被用于写入：符号链接、类型不符、存在多个硬链接的文件（`nlink !== 1`）、归属不明或不属于当前用户、权限无法在只减不增的前提下收紧、路径越界。系统 MUST NOT 递归修改受管根之外的任何目录或文件；`~/.lorelum` 下不属于日志路径的内容 MUST NOT 被触碰。Windows 无 mode/uid 语义，安全判断 SHALL 退化为结构检查（非符号链接、类型正确），权限自愈不适用；受管位置在 Windows 上的私有性由用户 profile 根的既有 ACL 边界保证，规范不承诺超出该边界的平台私有性。

#### Scenario: A user-owned directory with widened permissions is tightened

- **WHEN** 默认 Lorelum 根目录已存在、归当前用户所有、是普通目录，但 mode 为 `0755`，普通 CLI 调用需要写入该次 trace 日志
- **THEN** 系统 MUST 在写入前以掩码方式收紧（`0755` → `0700`）并校验作用于同一对象，随后正常持久化本条 trace 日志；本次业务结果不变，无需用户参与

#### Scenario: A mask-only tighten never adds owner permissions

- **WHEN** 受管日志目录的 mode 为 `0505`（所有者无写位）或受管日志文件的 mode 为 `0044`（所有者无读写位），其余条件满足
- **THEN** 系统 MUST NOT 为修复增加任何权限位；该目标 MUST NOT 被自动 chmod 或写入，按备用位置规则继续

#### Scenario: A target replaced between check and tighten is not modified

- **WHEN** 安全校验与收紧之间，受管日志路径上的目标被替换为另一对象
- **THEN** 收紧 MUST NOT 作用于替换后的对象；实现 MUST 以绑定同一文件系统对象的方式完成校验与收紧，使该替换无法被利用

#### Scenario: A hard-linked log file is left alone

- **WHEN** 受管理的 `.jsonl` 文件存在除自身以外的硬链接（`nlink > 1`）
- **THEN** 系统 MUST NOT 对其 chmod 或写入，MUST 改用备用位置，且不改动该文件的其他链接所见的权限或内容

#### Scenario: A symlink or foreign-owned target is never touched

- **WHEN** 受管日志路径上某段是符号链接、非目录，或归属当前用户之外的 uid（以注入的 stat 结果在决策单测中覆盖）
- **THEN** 系统 MUST NOT 对其 `chmod` 或写入，MUST 保持目标内容不变，并按"设计的私有备用位置"要求继续

#### Scenario: A widened managed log file is tightened

- **WHEN** 用户曾对 `~/.lorelum` 执行递归放宽权限，已存在的受管理 `.jsonl` 日志文件归当前用户所有、非符号链接、单链接（`nlink === 1`）、仅 group/other 权限过宽，sink 需要继续写入该文件
- **THEN** 系统 MUST 在写入前以掩码方式收紧（如 `0644` → `0600`）并校验同一对象；多硬链接或掩码后所有者权限不足的文件 MUST NOT 被改动或写入，改用备用位置

### Requirement: A designed private fallback preserves evidence

主日志位置存在不能安全修复的问题时，日志持久化组件 SHALL 改用预先确定的 Lorelum 专用备用根（用户主目录下与默认 Lorelum 根同级，创建为当前用户私有），其内部结构与安全规则与主位置相同。备用位置 MUST NOT 临时选择任意目录。备用位置在持久化初始化时与主位置一并判定；运行期写入失败不触发位置切换（见"Persistent local logs cover CLI, Backend, and Hooks"）。Windows 上备用位置与主位置同样依赖用户 profile 根的既有 ACL 边界保证私有性，创建仅做结构检查。`lore logs`、trace 日志收集、Backend trace 投影与 `lore logs prune` MUST 同时感知主位置与备用位置，并在结果中按位置标注记录来源；主位置的修复与备用位置的使用 MUST NOT 使同一 trace 的证据在查看入口之间不一致。

备用位置同样不可用时，系统 MUST 降级为本次不持久化：原命令的业务结果、错误码与 exit code MUST 保持不变，仅按"当次持久化结果"要求报告。清理策略 MUST 以相同规则覆盖备用位置中的受管理文件。

#### Scenario: An unrepairable primary root diverts logs to the fallback

- **WHEN** 主日志根出现不可安全修复的问题（例如归属他人的目录），而备用根可用，随后一次普通 CLI 调用与 `lore logs --trace-id <traceId>` 依次执行
- **THEN** 该次日志 MUST 持久化到备用位置；`lore logs` MUST 返回这些记录并标注其实际位置，feedback 与 Backend 投影对同一 trace MUST 得到一致的记录集合

#### Scenario: Both locations are unavailable

- **WHEN** 主位置与备用位置都不能安全使用，一次普通 CLI 调用执行
- **THEN** 原命令 MUST 按其本来的业务结果与退出码完成，当次输出按"当次持久化结果"要求报告"本次诊断日志未保存"；本次之后对该 trace 的查询 MUST 只报告"未找到已持久化证据"，MUST NOT 断言当时写入失败的具体原因

### Requirement: Per-invocation persistence outcome is recorded and reported once

发生自动修复、使用备用位置或持久化失败（含通过校验后的运行期写入失败）时，日志持久化组件 SHALL 把该次调用的持久化结果作为一条记录写入最终可用的位置，内容包括：尝试使用或实际使用的日志位置、目录/文件类型与归属检查的结论、修复前后的 mode、是否使用备用位置，以及失败的具体类别。持久化结果 MUST 与该次 `traceId` 绑定。Backend daemon 无当次 CLI 输出，其降级的可见性由 `backend-runtime` 的状态呈现要求定义。

当次 CLI 输出 SHALL 如实呈现该结果：JSON envelope 的 diagnostics 增加可选的持久化字段（仅在偏离正常时出现），text 输出给出同样的简明事实；权限位与本机日志位置不是秘密，MUST NOT 以泛化的"安全"理由隐藏。正常路径（无修复、无备用、写入成功）MUST 保持安静，不输出额外提示。Host Hook 的 raw stdout ABI MUST 不变，提示只能出现在 stderr。主备位置都失败时没有任何持久化痕迹，该事实 MUST 只由当次命令报告。

#### Scenario: A repair is visible with its facts

- **WHEN** 一次普通 CLI 调用触发目录权限自动收紧并成功写入
- **THEN** 该次调用 MUST 在持久化结果记录中保留修复前后的 mode 与目录检查结论，当次输出 MUST 以简明事实提示发生过修复，且不改变业务结果与退出码

#### Scenario: A normal invocation stays quiet

- **WHEN** 日志位置私有、写入成功，一次普通 CLI 调用执行
- **THEN** 该次输出 MUST NOT 出现修复、备用位置或持久化失败相关字段或提示

### Requirement: Trace evidence state is derived once and consumed everywhere

`@lorelum/log` SHALL 提供与 trace 绑定的单一证据状态，读取入口 MUST 至少区分：已读取但该 trace 无匹配记录；该 trace 证据未持久化（仅当存在其持久化结果记录时才可判定）；日志文件不可读取或不可用；读取结果被截断。证据状态 MUST 附带记录的实际位置（主位置或备用位置）。`lore logs`、`lore feedback draft` 与 Backend trace 投影 MUST 消费同一状态；feedback 可以为公开报告追加阅读说明，但 MUST NOT 把 `lore logs` 未报告的状态改写为另一种事实，也 MUST NOT 从空记录集合自行另造缺失原因。两个位置都失败造成的"事后不可知"MUST 如实表达为"未找到已持久化证据"，与"证据未持久化"相区分。

`lore logs` 的 JSON 输出 SHALL 呈现该证据状态与实际日志位置；既有 `missingEvidence` 数组保留，其条目 MUST 由同一状态派生。

#### Scenario: Two entrypoints agree on one trace

- **WHEN** 某次调用的日志因主位置不安全而写入备用位置，用户分别执行 `lore logs --trace-id <traceId>` 与 `lore feedback draft --trace-id <traceId>`
- **THEN** 两个入口 MUST 报告同一证据状态与记录位置，feedback 只增加面向公开报告的阅读说明

#### Scenario: An unknown trace is not misreported as a write failure

- **WHEN** 用户以一个从未产生持久化结果记录的 traceId 查询日志
- **THEN** 结果 MUST 报告"已读取但无匹配记录"或"未找到已持久化证据"，MUST NOT 断言该 trace 当时写入失败
