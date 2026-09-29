## MODIFIED Requirements

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

## ADDED Requirements

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
