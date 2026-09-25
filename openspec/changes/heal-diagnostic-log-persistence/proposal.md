## Why

Issue #224 观察到：默认 Lorelum 根目录（如 `~/.lorelum`）已存在但权限比诊断数据应有的更宽（例如 `0755`）时，CLI/Hook 日志 sink 的安全检查直接拒绝写入，且不判断该目录是否为 Lorelum 可以安全修复的、当前用户拥有的普通目录，也不将其收紧为私有权限。本可由产品无感恢复的本地状态导致该次 trace 没有任何持久诊断证据。

同一底层事实在不同入口得到不一致解释：`lore logs --trace-id` 可能只返回空 `records` 和空 `missingEvidence`；`lore feedback draft` 对同一 trace 额外返回 `detailed-logs-not-found`；Backend 的 trace 投影又使用 `trace-diagnostics-not-found`。三者都没有区分"没有产生匹配记录"与"logging sink 当时根本没能持久化证据"。

Backend 侧存在更重的同类问题：daemon 在启动时对日志目录执行安全 preflight，失败会抛 `backend.state-invalid` 阻止 daemon 就绪。日志位置不可用本不应使 Backend 服务本身不可用。

本变更**引入新的产品行为**（可安全确认时自动修复、经设计的私有备用位置、统一的 trace 证据状态），并**取代既有设计中的两条规则**：`add-diagnostic-logging` design §6 中"首次安全 preflight 遇到权限越界给受控 error"对"权限过宽但可安全确认归属"场景的处理，以及 Backend daemon 把不安全日志目录当作启动安全边界的做法。

## What Changes

- **安全自愈**：对默认 Lorelum 受管日志位置（受管根及其到日志文件的路径段、Backend 日志目录、受管理的 `.jsonl` 日志文件），当日标是普通目录/文件、非 symlink、归当前 OS 用户所有、且问题仅是权限过宽时，写入前自动收紧到私有权限（目录 `0700`、文件 `0600`，只收紧、绝不放宽），收紧后重新校验。symlink、类型不符、归属他人、无法收紧的情形绝不改动、绝不写入。不递归修改 `~/.lorelum` 下的其他内容。Windows 无 mode/uid 语义，自愈仅按结构检查分叉。
- **经设计的备用位置**：主位置不能安全使用时，日志改写到预先确定的、同样私有的 Lorelum 专用备用根（`~/.lorelum-diagnostics`）。`lore logs`、trace 收集、Backend trace 投影与 `lore logs prune` 都感知主/备双根，并按位置标注结果。
- **当次持久化结果**：发生自动修复、使用备用位置或持久化失败时，把该次调用的持久化结果（尝试的位置、目录/文件检查结论、修复前后的 mode、是否使用备用、失败类别）作为记录写入最终可用的位置，并在当次 CLI 输出（JSON envelope 的 diagnostics 与 text）中如实提示；正常路径保持安静。两个位置都不可用时，原命令的业务结果、错误码与 exit code 不变，仅明确报告"本次诊断日志未保存"。Host Hook 的 raw stdout ABI 不变，提示只走 stderr。
- **统一证据状态**：`@lorelum/log` 提供与 trace 绑定的单一证据状态，至少区分"已读取但无匹配记录""证据未持久化（仅当存在持久化结果记录）""日志不可读取""读取被截断"，并附实际日志位置。`lore logs`、`lore feedback draft` 与 Backend trace 投影 MUST 消费同一状态，不得各自从空数组另造文案。
- **Backend 启动降级**：daemon 启动时日志位置经修复与备用位置仍不可用，MUST 降级为禁用诊断 sink 并继续启动服务，不得因日志不可写抛 `backend.state-invalid`；该降级 MUST 经 daemon 状态接口与 `lore backend start`/`lore backend status` 对用户可见，不得仅存在于进程内部。该收窄只作用于 Lorelum 日志位置；runtime state、锁、模型目录等继续使用原有严格检查。
- **诚实的认知边界**：主备位置都失败时，本次调用之外不存在该事实的持久化痕迹；后续 `lore logs --trace-id` 只能如实报告"未找到该 trace 的已持久化证据"，MUST NOT 断言当时写入失败的原因。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `diagnostic-logging`：新增受管日志位置的自愈规则、备用位置与当次持久化结果报告；修改持久日志与 `lore logs` 的证据呈现（该能力当前位于未归档变更 `add-diagnostic-logging`，见下方合并顺序）。
- `diagnostic-feedback`：trace 草稿的证据缺口说明改为消费统一证据状态（该能力当前位于未归档变更 `improve-feedback-evidence-and-release-stacks`）。
- `backend-runtime`：新增 daemon 启动对日志位置不可用的降级要求；runtime state 严格检查边界不变。

## Impact

- **合并顺序**：本变更对 `diagnostic-logging`、`diagnostic-feedback` 的 MODIFIED 基准是尚未归档的 delta。合并本变更前，须先归档 `add-diagnostic-logging` 与 `improve-feedback-evidence-and-release-stacks`（其实现已实现并通过验证），使这两个能力进入 `openspec/specs` 主规格。归档以独立 docs PR 完成，不属于本变更的实现任务。
- **代码**：`packages/log`（修复原语、双根读取、证据状态、prune）、`packages/cli`（日志 runtime、envelope diagnostics 扩展、text 输出、`lore logs`、feedback 读取）、`packages/backend`（daemon 日志 sink 降级启动、trace 投影消费共享状态）、`packages/config`（备用根路径）。
- **CLI/协议**：失败/成功 envelope 的 `diagnostics` 增加可选持久化字段（仅在偏离正常时出现）；`diagnostics` schema 当前为 `additionalProperties: false`，扩展即公开契约变更，`protocolVersion` 定案升为 3（见 design D7）。`lore logs` 的 JSON 输出增加证据状态与位置信息，`missingEvidence` 语义并入统一状态。
- **兼容性**：修复与备用位置对正常 `0700` 用户完全无感；不改业务错误码与 exit code；Hook stdout ABI 不变。`missingEvidence` 数组保留兼容旧消费者，但其条目由统一状态派生。
- **测试**：按 Issue #224 列举场景——`0700` 正常、当前用户 `0755` 自动收紧、symlink/类型不符/非本用户不被触碰（决策函数以注入 stat 结果单测）、收紧失败、备用位置可用/不可用、未知 trace、截断——并以隔离 HOME 的集成测试固定，不触碰开发者真实 `~/.lorelum`。
