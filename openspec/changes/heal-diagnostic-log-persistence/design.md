## Context

Issue #224 要求日志持久化组件自己拥有本地状态恢复链路：可安全确认时自动修复，不能修复时使用经设计的私有备用位置，并让所有查看入口共享同一份 trace 证据状态。本设计把该要求落成跨 `packages/log`、`packages/cli`、`packages/backend`、`packages/config` 的实现决策，并明确取代的两条既有规则。

## Observed Evidence

以下为当前代码的可观察行为，是本设计的迁移基线：

1. **CLI/Hook sink 拒绝过宽权限且无归属判断**：`packages/log/src/sinks/jsonl.ts` 的 `assertPrivateDirectory`（18-27 行）只检查 symlink/类型/mode，不检查 uid，也不收紧；`~/.lorelum` 为 `0755` 时 `ensurePrivateDirectory` 第一跳即抛错，`write()` 的 catch-all（125-127 行）把 sink 置为 `disabled`，失败原因无任何持久化或输出。现有测试 `jsonl.test.ts` 只覆盖"拒绝符号链接替换"。
2. **Backend 有归属检查但拒绝即启动失败**：`packages/backend/src/runtime/runtime-state.ts` 的 `checkDirectory`（41-70 行）含 `uid !== process.getuid()` 检查但不修复；`daemon.ts`（39-48 行）在启动时 `await createPrivateJsonlSink(...)`，preflight 抛 `backend.state-invalid` 会阻止 daemon 就绪，注释明确声明这是有意的启动安全边界。`checkDirectory` 同时服务 runtime state 读写、activity 锁与模型目录，不能整体放宽。
3. **三个读取入口各自造词**：`packages/cli/src/log/command.ts` 直传 reader 的 `missing`（呈现为 `missingEvidence`）；`packages/cli/src/feedback/logs.ts`（38-43 行）在空结果时追加 `detailed-logs-not-found`、`debug-records-not-found`；`packages/backend/src/diagnostics/trace-projection.ts`（113 行附近）追加 `trace-diagnostics-not-found`。reader（`packages/log/src/reader.ts`）只能报告"读取时磁盘上有什么"，无法表达"写入端当时没存下来"。
4. **协议边界**：`packages/cli/src/output/protocol.ts` 的 `diagnostics` schema 为 `additionalProperties: false`、`protocolVersion = 2`。
5. **被取代的旧规则文本**：`openspec/changes/add-diagnostic-logging/design.md` §6"安全失败与运行时失败分层"——"首次安全 preflight……遇到 symlink/权限越界时给受控 error"；以及 backend-runtime 事实上的"日志目录不安全即启动失败"。

## Decisions

### D1. 自愈原语：只针对受管日志位置，决策与执行分离（对应 MODIFIED "Persistent local logs…" 与 ADDED "Managed log locations self-heal before writes"）

- 新增共享模块（落在 `packages/log`，CLI/Hook 与 Backend 日志 sink 共用；Backend 的通用 `checkDirectory` 不改）：`evaluateManagedTarget(statInfo, platform)` 纯函数返回 `safe | repairable | unsafe`。
- 判定条件：非 symlink、类型正确（目录/受管 `.jsonl` 文件，文件另要求 `nlink === 1`）、POSIX 上 `uid === process.getuid()`、且仅 group/other 位过宽。
- 收紧语义：掩码 `newMode = oldMode & ~0o077`——只清 group/other 位、原样保留所有者位，结果在数学上不可能增加任何权限；掩码后所有者权限不足以安全写入（`0505` 目录、`0044` 文件类）即判为不可修复，转 D3。不设"收紧到 0700/0600"的目标值，避免给所有者加位。
- 对象同一性：校验与收紧 MUST 绑定同一文件系统对象。文件复用写入时的 `O_NOFOLLOW` 打开句柄，在同一 `FileHandle` 上 fstat 判定、按掩码 `chmod`、再写入；目录以 `O_DIRECTORY|O_RDONLY` 句柄校验并收紧。实现第一步先验证 Bun 对目录句柄 chmod 的 macOS/Linux 支持；若不支持，目录退回路径 chmod + 事后校验，并在本节如实记录残余风险，不引入平台 hack。
- 范围限制：只对默认受管日志根（`~/.lorelum` 起的日志路径段）与 Backend 日志目录生效；不递归、不触碰受管根之外或日志路径之外的内容。归属不明的判定来源是 stat 事实本身（`uid` 存在且等于当前 uid），不做任何"看起来像 Lorelum"的猜测。
- 来源：`jsonl.ts:18`、`runtime-state.ts:41`（Backend 已有的 uid 检查作为对齐基线）。

### D2. 日志文件与目录同等自愈（对应 ADDED "Managed log locations self-heal before writes" 第三场景）

`chmod -R a+rX ~/.lorelum` 会同时放宽已有 `.jsonl` 文件；只修目录会在文件检查（`assertPrivateTarget`，`jsonl.ts:71-83`）再次失败。文件沿用同一判定与掩码语义（归当前用户、非 symlink、`nlink === 1`、仅 group/other 位过宽 → 清位掩码）；多硬链接（chmod 会影响受管路径外的同名文件）或掩码后所有者权限不足，即视为主位置不可用转 D3。

### D3. 备用根：`~/.lorelum-diagnostics`（对应 ADDED "A designed private fallback preserves evidence"）

- 固定路径：用户主目录下与默认 Lorelum 根同级（`packages/config/src/paths/lorelum.ts` 新增 `defaultDiagnosticsFallbackDirectory()`），创建为 `0700`，内部结构镜像主位置（`cli|hooks/<host>/<date>/`、`backend/`）。trustedDirectory 为用户主目录。
- 不用系统临时目录：tmp 受清理器与重启影响会无声丢证据，且多用户环境语义复杂。
- 主位置不可用**且不可安全修复**时整条 trace 写备用；不做"部分记录在主、部分在备"的混写。位置选择只发生在持久化初始化：通过安全校验后的运行期写入失败（ENOSPC、EROFS、EACCES 等）维持既有"禁用 sink + 受限提示"语义，不中途换根——同盘备用对磁盘类故障无收益，运行期换根的复杂度不值；该失败经 D4 的当次结果渠道报告。
- 读取与清理：`readManagedLogs`/`collectTraceLogs`/`pruneManagedLogs`（`packages/log/src/reader.ts`、`trace.ts`）与 `readTraceDiagnosticFacts`（backend）扫描双根，记录带位置标注。

### D4. 持久化结果记录与当次报告（对应 ADDED "Per-invocation persistence outcome is recorded and reported once"）

- 偏离正常（修复发生 / 使用备用 / 持久化失败）时，向最终可用位置写一条与 traceId 绑定的 `log.persistence` 记录：尝试与实际位置、检查结论、修复前后 mode、是否备用、失败类别。
- 当次输出：`ProtocolDiagnostics` 增加可选 `logPersistence` 字段（仅偏离正常时出现），text 渲染同等事实；Hook stdout 不变，提示走 stderr（对齐 add-trace-aware-diagnostic-recovery 的 Hook ABI 约束）。正常路径安静。
- 认知边界：主备都失败时无持久化痕迹，只由当次命令报告；后续查询按"未找到已持久化证据"如实呈现，与"证据未持久化"（有持久化结果记录背书）区分。

### D5. 统一证据状态：单一来源，三入口消费（对应 ADDED "Trace evidence state is derived once and consumed everywhere" 与 MODIFIED diagnostic-feedback）

- `packages/log` 新增 evidence-state 模块：输入为双根读取结果 + 持久化结果记录，输出状态集合（`no-matching-records` / `not-persisted` / `unreadable` / `truncated`）+ 每条记录位置；`lore logs` 的 `missingEvidence` 数组保留并由状态派生（兼容既有 `--json` 消费者）。
- 三个消费者改为只消费该状态：`cli/src/log/command.ts`、`cli/src/feedback/logs.ts`（移除自造的 `detailed-logs-not-found`；`debug-records-not-found` 属于等级过滤事实，保留为状态层的派生条目）、`backend/src/diagnostics/trace-projection.ts`（移除 `trace-diagnostics-not-found`）。

### D6. Backend daemon 降级启动（对应 ADDED backend-runtime "Daemon startup tolerates unavailable diagnostics locations"）

- `daemon.ts` 的 `createPrivateJsonlSink` 调用改为：自愈 → 备用 → 仍失败则使用 no-op sink 继续启动，不再向上抛 `backend.state-invalid`。
- 收窄边界：`runtime-state.ts` 的 `checkDirectory`/`assertPrivateFile` 对 runtime state、锁、模型目录的既有严格行为完全不动；日志专用路径绕过或包一层，不修改通用函数语义。`PrivateJsonlSink` 的"preflight 失败即拒绝"保留给显式调用方，daemon 侧改为捕获后降级。

### D7. 协议版本：定案升为 `protocolVersion = 3`

`diagnostics` 形状变化（新增可选 `logPersistence`）违反 v2 schema 的 `additionalProperties: false`；对按 v2 schema 严格校验的消费者，追加字段本身就是破坏性变化，"v2 里静默加字段"反而损害契约可信度。按既有"protocolVersion = 常量 + schema 同步更新"模式（`protocol.ts:5`、`67-125`）升为 3，并在 `lore describe`、站点 CLI reference 与 PR 描述中明示迁移说明；alpha 阶段 README 已声明不保证自动迁移。此为定案，不在实现阶段重开。

### D8. Windows 分叉

win32 沿用现状（`process.platform !== "win32"` 才检查 mode/uid）：自愈不适用，仅结构检查；备用位置与证据状态、当次报告照常生效。受管位置（含备用根）在 Windows 上的私有性由用户 profile 根的既有 ACL 边界继承保证——对齐 `runtime-state.ts:56-57` 的既有立场；创建不额外设置 ACL，规范不承诺超出该边界的平台私有性。

## Migration Plan

1. `packages/log`：**先验证 Bun 目录句柄 chmod 的平台支持（D1 的前置检查）**；随后实现自愈判定纯函数（stat 结果可注入，覆盖归属他人/类型不符/掩码后不可写）与描述符绑定的掩码收紧执行 + `JsonlFileSink` 接入；单测覆盖 `0700` 正常、`0755` 收紧、`0505`/`0044` 不加权限、symlink/异主/多硬链接不碰、检查与修改之间被替换、收紧失败、文件收紧。
2. `packages/config`：备用根路径函数。
3. `packages/log`：双根读取/收集/清理 + evidence-state 模块 + 持久化结果记录类型；`packages/cli` runtime 接线（按次选择位置、写持久化结果记录）。
4. `packages/backend`：daemon 日志 sink 降级启动（D6）；trace 投影消费共享状态。
5. `packages/cli`：envelope `diagnostics` 扩展与 text 渲染（D4/D7）、`lore logs` 输出证据状态、feedback 读取改接共享状态（D5）。
6. 文档：站点双语（troubleshooting/logs/feedback 相关页）与 `docs/`（development guide、CLI 维护者文档）按读者边界更新；Skill 排障引用如需同步一并更新。
7. 集成测试（隔离 HOME）：主根 `0755` 端到端（query 失败 → trace 查询有据）、备用路径、双失败当次报告、Hook stderr 提示、daemon 降级启动。

## Risks / Trade-offs

- **自动 chmod 的误伤面**：以"默认路径 + 归属 + 类型 + 仅权限位过宽"四重条件收窄；判定函数纯函数化并以注入 stat 单测异主场景（无特权进程造不出异主文件，见 tasks）。
- **双根读取的成本与一致性**：读取量翻倍但有文件数/字节上限既有约束；位置标注避免"同一 trace 两处混写"的歧义（按次调用选位置）。
- **协议版本升级**：v2 → v3 是公开契约变化，alpha 声明允许；`lore describe` 与站点 CLI reference 同步更新，避免文档漂移。
- **daemon 降级掩盖配置问题**：降级事实通过 D4 的当次/持久化结果渠道可见，status 侧不新增启动失败模式。

## Deferred Work

- 日志根的用户级配置（当前不存在 `logging.directory`；若未来引入，自愈规则是否延伸到用户自选位置需单独设计）。
- 对 `add-diagnostic-logging` 等四个已实现未归档变更的归档本身（独立 docs PR，是本变更的前置，不属于本变更实现范围）。
- 主备双失败时的"跨调用黑匣子"（例如下一次成功调用补记环境异常的摘要）——超出本变更，且与"不得臆断历史"原则冲突，仅在 design 留此备忘。
