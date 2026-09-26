# Design: surface-logging-config-fallback

## Context

### 观察到的证据（当前代码与测试）

- 静默回退发生在 `packages/cli/src/log/runtime.ts:36-44`：`configuredLevel()` 在 `--debug` 时直接短路返回 `"debug"`（不读 config），否则 `loadLoggingSettings()` 抛出的任何异常被整体吞掉并返回 `"info"`。
- `packages/config/src/logging.ts:21-31`：`loadLoggingSettings()` 对无效值（如 `noisy`）抛出 `ConfigError`，但该错误不携带 setting 名、收到值或允许 enum；`packages/config/src/logging.test.ts:20-29` 已有 `level: noisy` 的拒绝 fixture。
- `packages/backend/src/runtime/daemon.ts:42-44` 存在同一 fail-open 模式，但 daemon 非 per-invocation surface，本变更不触碰。
- `packages/cli/src/output/protocol.ts`：`protocolVersion = 2`；`ProtocolDiagnostics` 仅含 `traceId`，success/failure 两处 `diagnostics` schema 均 `additionalProperties: false`，今天没有 notice 位置。
- 在途分支 `feat/cli-error-details`（change `add-cli-error-details`）已确立 envelope 演进先例：可选附加字段 + `protocolVersion` 不变 + `createErrorDetail` 工厂强制预算（`kind/subject/reason/received/expected/hint`，封闭枚举，确定性截断），并在 spec 中记录了版本判例（v1 内可选 `error.recovery` 未 bump；新增必填 `diagnostics` 才 bump v2）。
- 证据链已具备：`createProcessLogRuntime` 的 diagnostics emitter fan-out 到按 traceId 命名的 JSONL 段文件与 stderr（`runtime.ts:74-82`）；`warn` 级记录在默认 `info` 收集等级下会被持久化，进入 `lore logs --trace-id`（`packages/cli/src/log/command.ts:103-109`）与 feedback 默认 evidence（`packages/cli/src/feedback/logs.ts:25-51`）；`debug-records-not-found` 标签在 `feedback/logs.ts:38-44`。
- text stderr 先例：`packages/cli/src/hook/host-hook.ts:141-142` 的 degraded 单行提示；`CliStderrLogSink` 经 `runtime/logger.ts` 输出 `[warn] message` 形式。
- 隔离 HOME 进程 fixture 先例：`packages/cli/src/install/git-test-support.ts:26-48` 同时设置 `HOME` 与 `USERPROFILE`（Windows 必需）等环境变量；现有 `packages/cli/integration/support/process.ts` 的 `runProcess()` 不支持 env 覆盖，需要扩展。

### Requirement 到当前源的证据映射

| Delta requirement | 当前代码/测试来源 |
| --- | --- |
| cli-invocation-notices: envelope `diagnostics.notices` | `packages/cli/src/output/protocol.ts:41-43,77-82,95-100`（现无该字段）；schema 先例 `add-cli-error-details` 的 `error-details.ts` |
| cli-invocation-notices: text 呈现 | `packages/cli/src/output/render.ts:36-88`；stderr 先例 `hook/host-hook.ts:141-142` |
| diagnostic-logging: MODIFIED debug 开关 requirement | `openspec/changes/add-diagnostic-logging/specs/diagnostic-logging/spec.md` "Debug mode controls detailed local collection independently from stderr presentation"；实现 `runtime.ts:36-44`、`registry.ts:165-172` |
| diagnostic-logging: ADDED 回退证据 requirement | `runtime.ts:74-82`（emitter）、`log/command.ts:103-109`（读取）、`feedback/logs.ts:25-51`（evidence 选择） |

## Goals / Non-Goals

**Goals:**

- 无效 persistent `logging.level` 的 invocation：fail-open 行为保留，但调用方在 text/JSON 两个通道都得到完整事实（setting、收到值、允许 enum、生效 level、来源）。
- `--debug` 与无效 persistent 配置并存时同时呈现"override 生效 `debug`"与"persistent 配置未生效"。
- 回退事实作为同 trace 的 `warn` 级本机证据落盘，`lore logs` 与 feedback draft 可解释。
- 正常配置零新增输出；无 notice 时 envelope 逐字节同形；`protocolVersion` 保持 2。

**Non-Goals（延后工作）:**

- Backend daemon 自身 fail-open 的通知化（非 per-invocation；其 config 错误结构化由 Issue #229 系列负责）。
- evidence 状态/missingEvidence 词汇统一（Issue #224 负责；本变更不新增词汇）。
- `kind` 枚举超出 `configuration` 的其他 notice 类别、config 自动改写、`config doctor` 类命令。
- `--log-level`（stderr 呈现等级）的行为变化。

## Decisions

### D1: 检测点在 `configuredLevel`，config 包提供非抛错的解析结果

把 `loadLoggingSettings()` 的"值级校验"结果结构化：`@lorelum/config` 新增 `resolveLoggingSettings()`，返回判别联合——`{ status: "valid", level }` 或 `{ status: "invalid", received, allowedValues, source }`（`source` 为 config 文件绝对路径，来自现有 `resolveLorelumPaths`）。既有 throwing API 与默认值语义不变，`status: "valid"` 且 key 缺失时仍返回默认 `info`；YAML/IO 层失败（无法归因到 `logging.level` 的值）继续走既有 fail-open，不产生 notice——因为此时没有"用户明确写入的值"可指认，与 Issue #230 场景（值明确但非法）不同。

`configuredLevel()` 改为总是调用 `resolveLoggingSettings()`（含 `--debug` 时），返回 `{ level, fallback? }`：`--debug` 时 `level = "debug"`、fallback 事实仍保留；否则 `invalid` 时 `level = "info"`、fallback 携带结构化事实。

- 替代方案（否决）：在 CLI 侧 catch `ConfigError` 后重新读文件反推被拒值——绕过 owning validator，违反"事实在已知边界产生"原则，且与 #229 的结构化 config 诊断方向冲突。

### D2: notice 对象复用 error-details 词汇并新增 `effective`/`source`

`packages/cli/src/output/notices.ts` 定义 `InvocationNotice`：`kind`（首版仅 `"configuration"`）、`subject`、`reason`（复用 `cli-error-details` 的 reason 枚举，本场景用 `invalid-value`）、可选 `received`、可选 `expected`（enum/integer-range/type 三变体同形）、可选 `effective`（本次实际生效值）、可选 `source`。`createInvocationNotice()` 工厂强制预算（数量、`subject`/`received`/`source`/enum 长度上限，按 Unicode code point 确定性截断），与 `createErrorDetail` 同构；producer 只能经工厂构造。

- 替代方案（否决）：直接复用 `ErrorDetail` 类型不新增字段，把 effective/source 塞进 `hint`——机器读取方无法稳定区分生效值与提示语，违背"notice 可机器读取"的目标。

### D3: `notices` 挂在 `ProtocolDiagnostics`，envelope 组装时注入

`ProtocolDiagnostics` 增加可选 `notices?: readonly InvocationNotice[]`；`protocolResponseSchema` 两处 `diagnostics` 定义同步扩展（可选、非空数组、entry schema `additionalProperties: false`）。`createSuccessEnvelope`/`createFailureEnvelope` 的 `diagnostics` 参数自然携带；无 notice 时字段整体省略，保证逐字节同形。

`createProcessLogRuntime` 返回值增加 `notices: readonly InvocationNotice[]`（0 或 1 条）；`main.ts` 在 envelope 组装处传入 `{ traceId, notices }`。这使 success 与 failure envelope 无差别获得同一事实，且 notice 与 `traceId` 同居一处，呼应"命令现场与 `lore logs`/feedback 用同一条证据"。

- 替代方案（否决）：顶层 `warnings` 或仅 success 顶层 `notices`——与 sibling 契约词汇分家，且失败现场（恰是排障场景）拿不到事实；已在 proposal 阶段排除。

### D4: text 呈现为 runtime 创建后立即输出的一行 stderr 提示

检测到回退时，在 `createProcessLogRuntime` 内（envelope 尚未产生、命令尚未执行）直接向 stderr 写一行，格式对齐 issue 示例：`warning: logging.level "noisy" is invalid; using "info" for this invocation.`；`--debug` 并存时：`warning: logging.level "noisy" is invalid; using "debug" for this invocation (--debug overrides persistent config).`（最终文案在实现时定稿，spec 只约束事实完整性）。JSON 模式下该行同样只进 stderr，stdout 单行 JSON 合同不受影响；text 主结果与 exit code 不变。Hook 路径共享此行为（host stdout ABI 不变，stderr 有限提示与既有 degraded 先例一致）。

- 替代方案（否决）：由 renderer 在输出阶段统一渲染——text/JSON 双通道会引入渲染顺序耦合，且长命令下提示延后；检测点直写更简单且与证据记录同时机。

### D5: 证据记录是同 emitter 的一条 `warn` 级 LogRecord

检测到回退时通过 runtime 的 diagnostics emitter 写 `warn` 记录，message 稳定为 `logging.level-fallback`，context 携带 `{ setting, received, effective, source }`。因为 `warn ≥ info` 过滤阈值：默认等级下必然持久化，进入 `lore logs --trace-id` 与 feedback 默认 evidence；`--debug` 时同样落盘。`feedback/logs.ts` 与 `log/command.ts` 零改动——证据解释力来自记录本身，不新增 `missingEvidence` 词汇（Issue #224 边界）。日志目标不可写时由既有 sink 降级语义处理：notice/stderr 仍在，记录缺失。

### D6: process fixture 扩展 `runProcess()` 支持 env 覆盖

`packages/cli/integration/support/process.ts` 的 `runProcess()` 增加 `env` 选项（合并而非替换进程必需变量），fixture 按 `git-test-support.ts` 先例同时设置 `HOME` 与 `USERPROFILE` 指向 mkdtemp 目录，写入 `config.yaml` 后以 `bun packages/cli/src/main.ts` 为入口跑完整链路：text、`--json`、取 `traceId` 后 `feedback draft --include-logs debug`、`--debug` 组合。日志不可写降级路径在 Windows 上无可靠的目录权限语义，用 `RunOptions.logDirectory`/`persist` test seam 在 source-level 单测覆盖，process fixture 不假装覆盖该平台分支（并在任务中注明）。

源级（进程内）单测不依赖 env：CI 实测表明进程内修改 `HOME` 无法在所有平台上改变 Bun 的 `os.homedir()` 解析（Linux 失败、Windows 恰好通过），因此 `createProcessLogRuntime` 与 `RunOptions` 提供 `configOptions` test seam 直通 `resolveLoggingSettings(options)`，与既有 `logDirectory`/`traceId` seam 同风格；env 覆盖只用于子进程 fixture（issue #230 的复现步骤本身即以子进程 `HOME=<isolated-home>` 表达，该通道已由 issue 在 macOS 上实证）。

## Risks / Trade-offs

- [与 `feat/cli-error-details` 的合并冲突] 两者都修改 `protocol.ts` 的 envelope schema 邻接区域 → 词汇与工厂模式刻意同构以缩小冲突面；合并顺序无论先后，各自 schema 扩展互不依赖（`error.details` vs `diagnostics.notices`），rebase 成本低。
- [`--debug` 下新增 config 读取可能在 config 文件损坏时引入新行为] D1 把"值级无效"与"YAML/IO 失败"分离，后者维持既有 fail-open 不产生 notice，`--debug` 下新增的只是一次本已存在的读取路径，不改变等级结果。
- [notice 写 stderr 的时机早于命令输出，极简 pipe 消费者可能视为噪声] 只在回退 invocation 出现一次；正常配置零输出（spec scenario 固化"逐字节同形"）。
- [Windows 下降级路径无法用进程级 fixture 验证] 明确记录验证边界：进程 fixture 覆盖主链路，降级路径由 source-level 单测覆盖；不伪造平台覆盖声明（对齐仓库既有"验证边界"实践）。
- [`kind`/`reason` 封闭枚举限制未来扩展] 扩展必须先改契约（spec 已写明），这是刻意的兼容闸门而不是缺陷。

## Migration Plan

纯增量演进：无 notice 的调用输出不变，无数据迁移、无配置迁移；回滚只需 revert 代码。严格校验固定 schema 副本的 consumer 需改用随 CLI 导出的 schema——该迁移路径沿 `add-cli-error-details` 已确立的文档口径。
