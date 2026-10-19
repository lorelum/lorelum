## Context

动机与范围见 proposal.md；产品行为见 product.md。基线为 main `b9f172f`（包含 native batching #286）。既有 query/index 语义、私有文件及发布/恢复合同是约束，不因 AGENTS.md 新规则自动作废。

Observed：

- `TraceDetailLogEmitter → SinkLogEmitter → JsonlFileSink` 的隔离探针，一条记录有 4 次 stringify、2 次 context 遍历；CLI 同时发出两套 started/completed 记录。
- `collectTraceLogs` 两次调用 `readManagedLogs`；2 条落地记录被解析 4 次。direct/global 窗口独立，不能用最近的全局窗口代替 direct。
- logging/query/method loader 组合读取同一配置 3 次。查询入口先校验 CLI input，再读取 query 设置；logging 在 CLI 启动时按既有规则回落。
- `reconcileEffectivePractices` 先验证 candidate，再组装 previous/merged，组装又验证同一 source；`state-writer` 另有提交审计。
- `runtimeRecordSchema` 的大小 refine 与 `writeRecord` 分别 stringify。release native 子进程成功后 `build.ts:31` 又完整 hash 生产者刚验证的 candidate。
- Fumadocs 的 collection schema 在内容转换时执行；生成 frontmatter 通过 macro/server source 加入 helper，不引入新的 authored 字段；`pickFrontmatter` 再完整 parse。

上述计数用于职责证据，不是新性能百分比。

## Goals / Non-Goals

**Goals:** 已有责任清晰归位，在受控调用内复用结果，完成调用方迁移，保留消费者可见的正常结果与真实失败恢复。

**Non-Goals:** 不新增依赖、磁盘 schema、后台任务、持久校验标记、跨请求缓存、重试或新网络 surface；不重做 native batching/排名。不把本轮扩成取消全部 HTTP/JSON/Store 审计。

## Decisions

### 1. 规范日志记录只在入口创建，sink 不再猜测输入来源

保留 `LogEmitter.emit(LogEventInput)` 作为事件入口；`LogSink.write` 收窄为 `LogRecord`，包括 Memory、fanout、JSONL、Backend private sink 和 CLI stderr sink。`SinkLogEmitter` 或 `LocalLogger` 创建规范记录，sink 只编码/写入。迁移所有直接传 raw event 给 sink 的测试与调用者，调用前显式 `createLogRecord(event)`；删除 sink 内重复 create/normalize，不留双路径。

`TraceDetailLogEmitter` 为过滤和关联只提取所需 correlation/level，不创建一个随后丢弃的完整 record；实际 redaction/record construction 仍在下游唯一入口。`LocalLogger.write` 不在 `createLogRecord` 前重复 sanitize 新消息 context；保留 logger context 捕获与隔离。

保留 `createLogRecord` 的现有 transport bound、显式 maxBytes 与错误序列化行为；`serializeLogRecord(record: LogRecord)` 只编码规范记录。因此正常文件路径允许“生产者计算 bounded record + sink 编码”两个不同责任，不为追求一次 stringify 另造缓存或 serialized wrapper。CLI stderr 先用既有等级规则判断是否启用，再序列化；暴露 `Logger.isEnabled(level)` 并让 `log` 复用该判断，不增加状态。

普通 CLI 保留 `cli.command.started/completed` 的单一路径，删除相同阶段的新 logger 重复记录；失败的 error/stack 记录保留，因为它不是 completed summary 的重复品。Hook ABI、debug trace 传播、source/context、文件权限、fsync、留存和 best-effort 语义不变。

代表链由 `raw event → TraceDetail 选择 → SinkLogEmitter 创建 bounded LogRecord → sink 编码/写入` 取代逐层转换。相关源码：log/src/{record,sink,logger}.ts、两类 JSONL sink、cli/runtime/{logger,diagnostics}.ts、cli/main.ts。行为依据：log/index.test.ts、record.test.ts、JSONL 权限/失败测试、CLI main 与诊断测试。

### 2. Trace 文件只读一次，独立保存两个窗口

扩展已有 `readManagedLogs`，允许内部调用者通过可选 record visitor 观察已解析、已验证的记录；visitor 不改变原返回值的过滤、limit、missing 或 truncated。共享现有默认 limit，不重复定义数值规则。

`collectTraceLogs` 用一次无 trace filter 的扫描取得全局窗口，同时在 visitor 内为目标 trace 保存独立有界窗口。分别排序/截断，保留现有 anonymous relation closure、去重和 missing/truncation 汇总，删除第二次文件读取及只为两份读取结果合并的 helper。visitor 是本次同步扫描的观察接口，不是通用 query framework、索引或后台状态。

关键验收：direct trace 早于全局窗口仍存在；另一 trace 同 relation 不能混入；损坏/轮转/尾行和窗口边界保持。

### 3. 配置文档的所有者是单次 invocation

在 config/document/load.ts 定义普通 `ConfigDocument` 与 `ConfigReader = () => Promise<ConfigDocument>`，不是已验证 section 的标记。保留 `loadConfig(options)` 的文件/结构边界。

`createProcessLogRuntime` 创建局部按需 reader，首次消费时执行 loadConfig 并在该 invocation 内复用同一 Promise；下一次 `run` 重新创建。`configuredLevel(debug, reader)` 在 debug 时继续不读文件。将 reader 通过 `CliRuntime → createProgram → CommandInvocation.readConfig` 明确传入，不建立模块全局 cache。

`loadLoggingSettings`、`loadQuerySettings`、`loadSemanticRetrievalSettings` 接受可选 reader 参数，默认仍从原 options 读取，各自保留 ConfigError 映射和 section 规则。QueryCommandServices 的设置 callback 接收可选 ConfigReader；registry 将其转交现有 loader。query/index handler 在已有 input validation 之后才消费 reader；显式方法跳过无关 method section。不能把三个 section 合并成必须全部通过的大 schema。

示意组装（省略无关参数）：

```ts
let document: Promise<ConfigDocument> | undefined;
const readConfig: ConfigReader = () => (document ??= loadConfig());
// logging 可先消费；query 仍在参数验证后调用对应 loader。
await loadQuerySettings({}, readConfig);
await loadSemanticRetrievalSettings({}, readConfig);
```

保留 standalone loader 和 source/test runtime 的注入用途，不引入第二套配置优先级。配置变化的跨调用边界见 delta spec；不扩展为其他进程/daemon 的共享快照。

project config 在私有构造过程中只复制/冻结一次；Registry catalog 的 source 在真正输入时隔离并冻结，后续更新 default/remove 复用既有 immutable source。删除 safeInteger 后重复 integer 以及相同 catch 分支，保留原错误值和可编辑文件的读取验证。

### 4. 安装合并只验证一次输入，不改变 writer 或模型入口保证

本轮不引入 `trusted` flag、VerifiedCandidate 或新 public merge API。`assertValidSource` 仍在公开模型合并/重建入口检查输入；私有 `buildEffectivePractices` 只组装已在同次调用内验证过的 sources。previous/retained/merged 均来自同一已验证输入，无 await、内容转换或新的外部来源；不必在第二次组装时再 canonicalize。

迁移所有调用私有 assembler 的模型入口，保持 source path/Pack/ID、冲突、revision delta、已有不一致 source 拒绝。candidate builder 的验证、writer `assertStateIsCoherent`、projection/SQLite 恢复保持。与“直接删除 merge 入口验证”的方案相比，收益稍小，但不改变入口契约，也不靠 marker 增加维护负担。

### 5. Runtime record 与构建的已有结果交接

将 runtime record 的结构 schema 与大小检查分开。导出的完整 runtimeRecordSchema 仍拒绝超过上限的值，readRecord 保留完整恢复验证；writeRecord 使用相同结构 schema，serialize 解析结果一次、检查该字符串 byte limit，再沿原私有目录/temp/rename 路径写入。embedding 默认值写入私有 JSON 的展开形式，保持读取语义并避免写出展开后超限、无法读回的记录；文件 schema、上限与原子性不变，不缓存 serialized record。

release 保留 `runNativeBuild` 子进程及其失败语义。成功后用已有 `readNativeArtifactManifest(nativeDirectory)` 读取小型、固定结构 manifest，替代对该 producer 已验证 source 的再次 `verifyNativeArtifact`。编译仍注入同一 manifest，复制后的 staging 完整 verify 与 match 必须保留，所有 license/files/checksum/workflow 验证不动。现存 candidate 的 validArtifact 是复用快路径，不删除。此方案复用已有接口，不需要 IPC、JSON 输出开关或新持久结果文件。

### 6. 博客只有 authored content 边界执行 schema

`pickFrontmatter` 接受 collection 已验证的 BlogFrontmatter，仅投影 route 所需字段，去掉完整 parse。LSP 确认 collection 与 source 泛型已保留准确的 BlogFrontmatter output；只修正投影入参类型，不另加 adapter、断言或重验，也不直接下发含 helper 的 page.data。字段默认值来自上游 schema，日期仍是已验证字符串，没有重解析需要。

保留 frontmatter schema 与内容契约测试；投影测试验证 helper 不进入 payload、可选字段及数据保真。把只在此下游制造非法 frontmatter 的拒绝断言移回真实 authored 输入边界，不重新钉死重复验证。

### 7. 待用户决定，实施时不夹带

| ID | 本轮保留 | 需要决定的行为 |
| --- | --- | --- |
| D1 | HTTP controller 与 client 完整 response schema | 将后置保证收敛到一端会改变内部 producer 违约时的检测位置/HTTP 失败形式；identity/HMAC 与关联检查独立保留 |
| D2 | CLI 全局 assertJsonValue | 删除或合并会影响任意内部 handler 返回非 JSON 值时的拒绝行为；不增加按命令 trusted 标记来绕过 |
| D3 | Client 入参预检、keyword 提前领域解析 | 删除可能改变错误时点/优先级、是否发生连接或读取配置 |
| D4 | SQLite writer 入口完整 canonical 审计 | 与 merge 有重叠，但提交边界的输入责任需另行收窄；不修改本轮的正常/恢复写入保证 |
| D5 | Shared config/catalog 的祖先 symlink 规则 | 允许新的路径组织是可见行为变化，须明确目标文件与用户管理配置的边界 |
| D6 | 日志每次路径巡检、sync 与 retention 扫描策略 | 涉及已接受的私有性/替换失败及耐久/留存语义，不因性能预估删除 |

## Risks / Trade-offs

- 日志类型迁移漏掉直接 sink 调用：用 LSP references 迁移全部生产与测试 caller，整包 typecheck + 行为验证，不做兼容 overload。
- 配置快照使调用中编辑稍后生效：明确到下一 invocation，保留错误优先级和无关 section 隔离；此差异在 PR 单列。
- 单次 trace scan 改变窗口：用 older direct/crowded global、交叉 trace/shared relation 与损坏文件场景覆盖，不仅比较记录数量。
- native source 在 producer 返回后被其他进程改动：最终 staging verify+manifest match 继续拒绝，不因源端省一次 rehash 就发布坏副本。
- 不能用次数推断收益：baseline/changed 完整构建，固定输入与参数，真实 query/两种 index build 测量并验证结果；无显著收益也如实记录。

## Migration Plan

先冻结接口，按文件所有权并行迁移 logging、CLI/config、Engine、site 与 runtime/build；主线程整合跨模块边界。每项验证指定唯一负责人，不重复已有效的包内检查。同步两项 current spec 与实际受影响文档；保留当前 change 作为实现/证据记录，不在本轮归档。

无数据迁移。回退是回退代码，不操作用户 canonical Store、模型或配置。完成后删除临时计数脚本/fixture/worktree；完整 bundle 与原始本地统计按用户验收用途保留，不提交敏感运行数据。

维护演练：新增普通日志只在事件入口记录、sink 不增加 schema；新增 query section 由该消费者验证，不改变 keyword 所不使用的字段；一次 sink 写入失败沿原禁用与 stderr 提示收敛，不改变原命令结果。
