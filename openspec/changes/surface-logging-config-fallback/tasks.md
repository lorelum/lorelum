# Tasks: surface-logging-config-fallback

## 1. Config 包：结构化 logging 设置解析

- [x] 1.1 在 `@lorelum/config` 实现 `resolveLoggingSettings()` 判别联合（`valid` 携带 level、`invalid` 携带 `received`/`allowedValues`/`source`；key 缺失时返回默认 `info` 的 `valid`；YAML/IO 层失败继续抛既有错误），保持 `loadLoggingSettings()` throwing API 与默认值语义不变；以 colocated tests 覆盖 `noisy`、缺失 key、合法值与文件损坏四类输入，其中 `noisy` fixture 必须断言结构化事实（setting、收到值、允许 enum、config 路径）逐字段可得。
- [x] 1.2 运行 `bun run --filter @lorelum/config test` 与 `bun run typecheck`，确认既有 `logging.test.ts` 的 `noisy` 拒绝用例不受影响。（备注：`@lorelum/config` 无 `test` script，按仓库约定以 `bun test packages/config` 执行，30/30 通过；typecheck 通过。）

## 2. CLI logging runtime：回退检测、notice 与证据记录

- [x] 2.1 在 `packages/cli/src/output/notices.ts` 实现 `InvocationNotice` 类型、封闭 `kind`/`reason` 枚举与 `createInvocationNotice()` 预算工厂（数量/长度上限、按 Unicode code point 确定性截断、空可选字符串丢弃），词汇与 `cli-error-details` 的 `kind/subject/reason/received/expected` 对齐并新增 `effective`/`source`；以 colocated tests 验证预算、截断确定性与 freeze 语义。
- [x] 2.2 重写 `configuredLevel()` 为总是调用 `resolveLoggingSettings()`（含 `--debug` 时），返回 `{ level, fallback? }`：`--debug` 时 level 为 `debug` 且保留 fallback 事实；值级 `invalid` 时 level 回退 `info`；YAML/IO 失败维持既有静默 fail-open。以单元测试固化"`--debug` 不再短路 config 读取"这一行为变化。
- [x] 2.3 在 `createProcessLogRuntime` 中：检测到回退时立即向 stderr 写一行人可读提示（含 setting、收到值、允许值、实际生效 level；`--debug` 并存时同时说明 override 生效与 persistent 未生效），通过 diagnostics emitter 写一条 `warn` 级 `logging.level-fallback` LogRecord（context 携带 setting/received/effective/source），并在返回值上暴露 `notices` 数组；以 `RunOptions` test seams（stderr writer、logDirectory、traceId）单元验证 stderr 行、JSONL 记录与 notice 三者事实一致。
- [x] 2.4 以 source-level 单测覆盖降级路径：`persist: false` / 不可写 `logDirectory` 时 notice 与 stderr 提示仍在、证据记录缺失且主结果不变（Windows 无目录权限语义，此路径不做进程级 fixture，注明验证边界）。

## 3. Envelope 协议：schema 与组装

- [x] 3.1 扩展 `packages/cli/src/output/protocol.ts`：`ProtocolDiagnostics` 增加可选 `notices`，`protocolResponseSchema` 的 success/failure 两处 `diagnostics` 定义同步收紧（可选、非空数组、entry 与 `expected` 变体 `additionalProperties: false`、封闭枚举拒绝）；`protocolVersion` 保持 2；以 protocol 单测验证 schema 拒绝空数组、未知 `kind`/`reason`、未知属性。
- [x] 3.2 让 `main.ts` 在 success 与 failure envelope 组装处把 runtime 的 `{ traceId, notices }` 一并传入（无 notice 时字段整体省略）；以单测断言：无 notice 的既有命令 envelope 与变更前逐字节同形，带 notice 的 envelope 通过 `protocolResponseSchema` 校验且 stdout 仍为单行 JSON。
- [x] 3.3 运行 `bun run --filter lore test`（或 CLI 包等价 focused test）与 `bun run typecheck`，确认全量 CLI 单测通过。

## 4. 隔离 HOME 的 process fixture

- [x] 4.1 扩展 `packages/cli/integration/support/process.ts` 的 `runProcess()` 支持 `env` 合并覆盖（保留进程必需变量），参照 `git-test-support.ts` 先例同时设置 `HOME` 与 `USERPROFILE` 指向 mkdtemp 目录；以最小 fixture 验证隔离生效（命令观察到 isolated home 的 `~/.lorelum`）。
- [x] 4.2 固化 Issue #230 的完整链路 fixture（复现步骤 1–5）：`logging.level: noisy` 下运行 `pack list` 的 text 与 `--json` 变体，断言 stderr 提示、`diagnostics.notices[0]` 的全部字段与 exit code；取 `diagnostics.traceId` 后运行 `feedback draft --trace-id <id> --include-logs debug`，断言证据包含 `warn` 级回退记录并能区分"未开启 debug"与"配置被回退"；再固化 `--debug` 组合（effective 为 `debug` 且双事实齐备）与正常 config 零 notice 两个对照场景。
- [x] 4.3 运行 CLI integration 套件（隔离 Store/cache root，不触碰真实 `~/.lorelum`），记录通过证据。（证据：`bun run test:integration` 两次运行均 exit 0，checker 复跑亦 exit 0；期间修复了两处在干净 main @ ba0edcc 上同样失败的历史测试断言——`process.integration.ts` 过期的 `(protocol 1)` 期望与 `get-query.ts` 对含随机 traceId 输出的逐字节相等比较——已按最小修复处理，PR 描述需明确列出。）

## 5. 文档同步

- [x] 5.1 更新 `docs/cli/README.md` envelope 说明（`diagnostics.notices` 的位置、字段与兼容策略）与 `docs/development/diagnostic-logging.md`（回退通知与证据记录语义），不重复用户侧步骤。
- [x] 5.2 按用户可见行为变化同步站点双语 troubleshooting/logging 页面（英文与中文成对更新），并修复跨 `docs`/站点边界的链接。

## 6. 验证与收尾

- [x] 6.1 运行 `bun test`、`bun run typecheck`、`bun run lint` 与 `bun run fmt`，全部通过。（证据：`bun test` 1034 pass / 27 skip / 1 fail——唯一失败是 `scripts/ci/typecheck.test.ts` 在 Windows 上的路径分隔符断言，已在干净 main @ ba0edcc 复现，属 pre-existing 平台缺陷，与本变更无关；`bun run typecheck` 通过；`bun run lint` 0 error（33 个 pre-existing warning）；`oxfmt --check` 对全部 23 个变更文件通过。备注：本机 `core.autocrlf=true` 下 `bun run fmt` 会重写 883 个无关文件的行尾，已全部 `git restore`，最终 modified 集恰为变更文件清单。）
- [x] 6.2 运行 `openspec validate surface-logging-config-fallback --strict` 通过；核对 spec scenario 与测试一一对应（特别是"逐字节同形"、"`--debug` 双事实"、"降级仍通知"三个场景），整理验证证据供 PR 使用。（场景→测试映射：逐字节同形=protocol.test.ts "composeDiagnostics keeps the legacy shape"+main.test.ts "keeps envelope diagnostics byte-identical"+integration logging-fallback.ts healthy 对照；--debug 双事实=runtime.test.ts "--debug override..."+integration "--debug"段；降级仍通知=runtime.test.ts "persistence disabled"/"unavailable log directory"；envelope 承载=protocol.test.ts "carries invocation notices..."+main.test.ts 两个 run() 级测试；schema 拒绝=protocol.test.ts "rejects malformed notice diagnostics"；完整链路=process.integration.ts 的 verifyLoggingFallbackScenario，`bun run test:integration` exit 0×3。）
