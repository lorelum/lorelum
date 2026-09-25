## 1. 前置：主规格基线

- [ ] 1.1 以独立 docs PR 归档 `add-diagnostic-logging` 与 `improve-feedback-evidence-and-release-stacks`（实现已完成），使 `diagnostic-logging`、`diagnostic-feedback` 进入 `openspec/specs`；验证归档后主规格与本变更 delta 的 MODIFIED 基准一致，`openspec validate heal-diagnostic-log-persistence --strict` 通过。

## 2. 受管日志位置自愈原语（packages/log）

- [x] 2.1 实现纯函数 `evaluateManagedTarget`（输入 stat 事实，输出 `safe | repairable | unsafe`）与掩码收紧执行（`newMode = oldMode & ~0o077`：只清 group/other 位、原样保留所有者位，结果不可能增加任何权限）；校验与收紧绑定同一文件系统对象——文件复用 `O_NOFOLLOW` 写入句柄 fstat 后同句柄 `chmod`，目录以 `O_DIRECTORY` 句柄处理，首个子任务验证 Bun 目录句柄 chmod 的 macOS/Linux 支持并记录结论（不支持则按 design D1 退回路径 chmod + 事后校验并记录残余风险）；以注入 stat 结果的单元测试覆盖归当前用户的 `0755` 可修、`0505`/`0044` 掩码后不可写不修不加位、symlink/类型不符/异主 uid/win32 仅结构可判不可修，以及检查与修改之间目标被替换时不作用于替换后对象。
  - 验证结论：Linux 本机 Bun 1.4.2 目录句柄 `stat`/`chmod` 可用（`0755 → 0700` 实测通过）；macOS 留待 CI 的非 win32 用例验证。
- [x] 2.2 将自愈接入 `JsonlFileSink` 的目录预检（`ensurePrivateDirectory` 各段）与目标文件预检（`assertPrivateTarget`），不可安全修复时不再静默禁用，而是向调用方报告"主位置不可用"及检查结论；以真实 fs 测试覆盖 `0700` 正常、当前用户 `0755` 目录自动收紧后成功写入、`chmod -R` 放宽后的已有 `.jsonl` 收紧、存在多硬链接（`nlink > 1`）的文件不 chmod 不写入转备用、收紧失败（如只读挂载）转不可用、既有 symlink 不碰用例保持通过。
  - 覆盖映射：只读挂载类收紧失败以 `0505` 掩码后不可写（`owner-bits-insufficient`）与 `location-error` 原始 I/O 错误两条路径覆盖；真实 ro 挂载在测试环境不可用。

## 3. 备用位置与双根读写（packages/config、packages/log）

- [x] 3.1 在 `@lorelum/config` 增加 `defaultDiagnosticsFallbackDirectory()`（`~/.lorelum-diagnostics`），私有创建与安全规则复用 `packages/log` 原语；单元测试验证路径解析不触碰文件系统、创建后为 `0700`。
- [x] 3.2 将 `readManagedLogs`、`collectTraceLogs`、`pruneManagedLogs` 扩展为主/备双根：记录带位置标注，prune 以相同规则覆盖备用根；以 fixtures 验证主根不可用时备用记录可读、双根合并去重、清理不越界。
- [x] 3.3 `createProcessLogRuntime`（CLI/Hook）在持久化初始化时选择位置：主位置可自愈则修复后写入，否则整条 trace 写备用根，并在偏离正常时写与 traceId 绑定的 `log.persistence` 记录（尝试/实际位置、检查结论、修复前后 mode、是否备用、失败类别）；位置一经选定，运行期写入失败不切换位置、维持既有禁用语义并经当次输出报告；测试覆盖三种初始化路径、正常路径不产生该记录，以及运行期失败不换根仍有当次报告。

## 4. 统一证据状态（packages/log、backend、cli）

- [x] 4.1 实现 trace 证据状态模块（输入双根读取结果与持久化结果记录，输出 `no-matching-records` / `not-persisted` / `unreadable` / `truncated` 与记录位置），`lore logs` 的 `missingEvidence` 由其派生；单元测试覆盖四态判定、未知 trace 不误报为写入失败、位置标注。
- [x] 4.2 将 `lore logs`（`cli/src/log/command.ts`）、`readTraceLogs`（`cli/src/feedback/logs.ts`，移除自造 `detailed-logs-not-found`）、`readTraceDiagnosticFacts`（`backend/src/diagnostics/trace-projection.ts`，移除 `trace-diagnostics-not-found`）改为消费共享状态；以同一 trace 的跨入口一致性测试验证三者输出同一状态与位置。

## 5. Backend daemon 降级启动（packages/backend）

- [x] 5.1 `runBackendDaemon` 的日志 sink 装配改为：自愈 → 备用根 → 仍失败则以禁用诊断 sink 继续启动，不再抛 `backend.state-invalid`；`checkDirectory`/`assertPrivateFile` 对 runtime state、锁、模型目录的严格行为保持不变，以既有 backend-runtime 测试全量回归验证。
- [x] 5.2 daemon 降级事实经状态接口与启动就绪结果暴露：`/internal/v1/status` 增加诊断持久化状态，`lore backend start` 的就绪响应与 `lore backend status` 呈现"服务可用但诊断日志未持久化"及失败类别；集成测试覆盖"日志目录异主且备用不可用 → daemon 正常就绪服务请求且状态可见"与"runtime state 目录不安全 → 仍按原行为拒绝"两个方向。
  - 覆盖映射：以 supervisor 集成测试覆盖"可修复 0644 → 收紧后 ready"与"多硬链接不可修复 → 备用根 ready + status 暴露 usedDirectory"；"runtime state 目录不安全仍拒绝"由既有 supervisor/backend-runtime 用例回归（runRecord 路径未改动）。

## 6. 当次报告与协议（packages/cli）

- [x] 6.1 扩展 `ProtocolDiagnostics` 增加可选 `logPersistence` 字段（仅修复/备用/失败时出现），按 design D7 定案实现 `protocolVersion` 3 升级，同步 `protocolResponseSchema`、`lore describe` 输出、text 渲染与站点 CLI reference；测试验证正常路径安静、text/JSON 同源、Hook stdout ABI 不变且提示仅在 stderr。
- [x] 6.2 失败/成功 envelope 的既有字段与 exit code 不变；以 V2→决策后版本的 envelope 回归测试验证业务错误码、recovery、traceId 呈现不受影响。

## 7. 文档与集成验证

- [x] 7.1 更新双语站点文档（troubleshooting、logs/feedback 相关页：证据状态含义、修复/备用提示、双失败时"未找到已持久化证据"的解释）与 `docs/` 维护者材料（development guide 的日志目录自愈与降级行为）；验证链接、示例与 CLI reference 一致。
- [x] 7.2 以隔离 HOME 的集成测试固定 Issue #224 场景：默认根 `0755` 下 `lore query "   "` 失败后按 trace 查询有持久证据且当次提示修复事实、主根异主走备用、双失败当次报告且事后查询如实、Hook 与 daemon 降级路径；确认测试不触碰真实 `~/.lorelum`。（`lore query "   "` 是空白输入错误，只验证 CLI 日志链路，不触达 Backend；daemon 降级由 5.2 的独立集成测试覆盖。）
- [x] 7.3 运行 `bun test`、`bun run typecheck`、`bun run lint`、`bun run fmt:check`、`openspec validate heal-diagnostic-log-persistence --strict`；在 PR 描述报告实际结果、未跑检查（如 Windows runner 上的 win32 行为）与剩余风险。
