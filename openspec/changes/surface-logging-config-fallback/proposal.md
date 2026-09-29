# Proposal: surface-logging-config-fallback

## Why

`logging.level` 是用户明确表达的诊断意图：当 `~/.lorelum/config.yaml` 写入无效值（例如 `noisy`）时，CLI logging 初始化 fail open 到 `info`（`packages/cli/src/log/runtime.ts` 的 `configuredLevel` 捕获所有异常后静默返回默认值）。业务命令正确继续是刻意设计，但当前实现不告诉调用者配置未生效：用户会以为 `debug` 已开启，直到查看 trace 或生成 feedback draft 时才发现没有预期的 debug 记录，且只能看到"没有日志"，无法定位根因是启动时已忽略配置（Issue #230）。

本变更新增产品行为——把一个已存在的静默回退变成可见、可机器读取、可被本机证据链解释的运行事实；不改变任何既有成功/失败语义、error code、exit code 或 fail-open 策略本身。

## What Changes

- 当 persistent `logging.level` 无效时，本次 invocation 在 JSON envelope 的 `diagnostics.notices`（可选数组）中携带一条结构化 notice：setting（`logging.level`）、收到的非秘密值、允许的 enum、实际生效 level（默认 `info`）与 config 来源。
- text 模式在同一次调用的 stderr 输出一条不打断主结果的简短说明；`--json` stdout 仍为合法单行 JSON，notice 不混入 stdout prose。
- `--debug` 存在时仍读取 persistent config：effective level 保持 `debug`（one-shot 优先级不变），notice 同时如实说明"persistent 配置未生效"与"本次实际生效 `debug`"两个事实；当前实现里 `--debug` 完全短路 config 读取、连发现无效配置的机会都没有，这一点会被修正。
- logging runtime 在日志目录可写时，把该 fallback 作为与本次 trace 关联的 `warn` 级本机诊断记录落盘，使 `lore logs --trace-id` 与 `lore feedback draft` 能解释"为什么本次没有预期级别的记录"。日志不可写的降级路径仍保留 notice（envelope 与 stderr），仅证据记录缺失。
- notice 只在发生 fallback 的 invocation 出现：正常 config 不产生 notice、不增加常驻输出；没有 notice 时 envelope 与既有形状逐字节一致。
- 不自动改写用户 config，不要求权限命令、重置目录或阅读内部日志实现；用户按 notice 说明改回合法 level 即可。
- 新增隔离 HOME 的 process fixture，覆盖 text、JSON、trace 关联、`--debug` override 与日志不可写降级五条路径。
- Backend daemon 自身的 fail-open 回退（`packages/backend/src/runtime/daemon.ts`）不在本变更范围：它不是 per-invocation surface，其 config 错误的结构化表达由 Issue #229 系列负责。

## Capabilities

### New Capabilities

- `cli-invocation-notices`: 公共 `lore` envelope 中 invocation 级结构化 notice 的合同——`diagnostics.notices` 的 schema 约束、产生边界、text 呈现、协议兼容策略与预算限制。

### Modified Capabilities

- `diagnostic-logging`: invalid persistent `logging.level` 不得静默生效；fallback 必须作为本机诊断事实被记录并通知；`--debug` 覆盖与 persistent 配置未生效是必须同时呈现的两个事实。

## Impact

- `packages/config`: `logging` settings 的加载需要能返回被拒绝值与允许 enum 的结构化事实（当前 `loadLoggingSettings` 对无效值抛出不携带细节的 `ConfigError`），保持默认值与既有错误路径不变。
- `packages/cli`: `log/runtime.ts`（回退检测与 notice 产生）、`main.ts`（notice 传入 envelope）、`output/protocol.ts`（`diagnostics.notices` schema）、`output/render.ts`（text stderr 呈现）及 colocated tests；feedback/logs 读取路径预期不改——证据记录作为普通 `warn` LogRecord 走既有 evidence 链。
- 协议兼容：`diagnostics.notices` 是 `protocolVersion: 2` 内的可选演进。依据既有判例（v1 内新增可选 `error.recovery` 未 bump 版本；新增必填 `diagnostics` 才 bump 到 v2），本变更不改变 `protocolVersion`。
- 与在途分支 `feat/cli-error-details`（`add-cli-error-details` change）同触 `output/protocol.ts` 邻接区域：notice 词汇与 `ErrorDetail` 的 `kind/subject/reason/received/expected` 对齐并新增 `effective/source`，合并顺序需协调。
- 文档：`docs/cli/README.md` envelope 说明、`docs/development/diagnostic-logging.md` 与站点双语 troubleshooting/logging 页面按用户可见行为同步。
- 不新增依赖、网络面、MCP surface 或 config 字段。
