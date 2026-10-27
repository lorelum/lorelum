## Context

结论：复用两种行为，而非拼接两个 Issue 的补丁：已有 validator 报告安全的 typed config failure；消费方直接传播，或显式提供默认值，用同一个普通函数取得实际采用值与原失败。query/backend/embedding/logging 是适配案例，通用逻辑不识别它们的名字。通过现有 message、CLI/Hook stderr 和本机日志呈现，不建设新公共诊断协议。产品路径见 [requirements.md](requirements.md)。

### 已核对的现状

下列路径在 `eba4c6dc5fcf21b138fdc44ccfe2700b1f455ab9` 复核，所涉源文件与前次证据基线间无变动；#251 仅用于理解整合背景，不作为实施合同。#259 的维护者决定明确拒绝默认重复 details，要求 #229 按 message-only 重新评估；[CLI 合同](../../../docs/cli/README.md) 规定 envelope v2、code + actionable message、可选 resource 与 trace。[已有错误消息变更](../unify-cli-error-messages/specs/cli-error-messages/spec.md) 含过时的 recovery 保留表述，本方案以实际 CLI/resource 合同为准，不顺带同步或归档该 change。

| 边界 | 当前事实与证据 | 本次迁移 |
| --- | --- | --- |
| YAML | `packages/config/src/document/load.ts:7-58` 的 `ConfigError` 不携带事实；读取、大小、root 与 parser 失败合成通用错误；finally 关闭文件 | 保存类型化的安全类别和来源；只取 parser mark，不保留原异常/snippet |
| Query | `packages/cli/src/query/settings.ts:35-112` 已说明 key/整数范围/方法枚举，但丢失具体文档原因并硬编码默认文件名 | 复用同一约束，补来源与失败类别；不改变覆盖和消费范围 |
| Backend | `packages/backend/src/config/load.ts:26-105` 校验每个来源，precedence 为 defaults < YAML < env < overrides；`embedding.ts:12-70` 严格 schema，有嵌套路径和大小约束 | 从校验边界保留第一项可行动失败、实际约束和来源，仍 terminal |
| CLI/Hook logging | `packages/config/src/logging.ts:8-41` 只识别 level；`packages/cli/src/log/runtime.ts:43-57,92-150` debug 提前返回，其他异常静默 info；已有 invocation `ConfigReader` Promise 快照 | 总是解析 persistent 设置，返回 fallback/effective 关系；保存并呈现一次 |
| CLI 结果 | `packages/cli/src/main.ts:121-238` 成功在 command 内渲染后 flush，catch 先 flush 再渲染；`output/render.ts:67-117` 统一安全单行消息，普通上限 400 | flush 接收 terminal config fact，只做同因抑制；复用最终消息安全函数 |
| daemon | `packages/backend/src/runtime/daemon.ts:47-58` 独立静默回退 info 后构造 sink；`runtime/supervisor.ts` 的 detached spawn 忽略 stdout/stderr | 复用 resolver，只写 source=backend 的真实 startup 记录，不承诺子进程现场输出 |
| 本机读取 | `packages/log/src/logger.ts`、`sink.ts` 已有普通 warning、隔离 sink 失败；`packages/cli/src/feedback/logs.ts:24-55` 读取已存记录并保留 debug 缺失标记 | 复用，不添加日志 event union、evidence state 或新的 reader 解释层 |

已核对的行为测试：`packages/config/src/{document/load,logging}.test.ts`、CLI `query/settings.test.ts`、Backend `config/{load,embedding}.test.ts`。这些证明现有规则与边界，不证明本提案的新现场提示已经实现。

## Goals / Non-Goals

- 保留一个源头事实：YAML 拥有文档错误，消费方拥有字段规则，logging resolver 拥有最终等级。公开文案可以独立变化，但不能反向成为事实源。
- 只覆盖 query、backend、embedding、logging 以及它们读取的共享 YAML；不统一 agent/updates/Registry/project 配置，不调整 native/model 错误与重复验证，不改反馈证据词汇。
- 不自动修配置，不新增缓存、全局状态、DI 容器、通用诊断事件、公共 schema/flag 或远程接口。内部 typed facts 不属于公共机器协议。
- 已读取 `agentic-coding.implementation.justify-added-checks` 与 `validate-at-the-owning-boundary`：本次只丰富现有 validator 已知的诊断，不增加 query validation gate、重复 safeParse 或输出校验；内部调用/本机 HTTP 不构成重复业务校验理由。保留外部输入和真实安全边界，不扩展其他 validation ownership 重构。

## Decisions

### 1. 配置事实归 `@lorelum/config`，校验规则仍归消费方

新增 `packages/config/src/failure.ts`，导出最小内部类型与纯事实格式化函数。它不读文件、不依赖 CLI/Backend/Engine，不持有状态，不做第二次 schema 校验。

```ts
type ConfigSource =
  | { kind: "file"; path: string }
  | { kind: "environment"; variable: string }
  | { kind: "override"; label: string }
  | { kind: "resolved"; label: string };
type ConfigRule =
  | { kind: "integer"; minimum: number; maximum: number }
  | { kind: "positive-decimal-integer-without-leading-zeros" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "shape"; expected: "object" | "boolean" | "string" }
  | { kind: "non-empty-absolute-path" }
  | { kind: "https-url-without-credentials-or-fragment" }
  | { kind: "max-bytes"; maximum: number };
type ConfigFailure =
  | { kind: "document"; source: Extract<ConfigSource, {kind: "file"}>;
      reason: "yaml-syntax";
      location?: { line: number; column: number } }
  | { kind: "document"; source: Extract<ConfigSource, {kind: "file"}>;
      reason: "unreadable" | "not-file" | "too-large" | "root-shape" }
  | { kind: "setting"; source: ConfigSource; subject: string;
      reason: "type" | "range" | "enum" | "unknown-key" | "format" | "size";
      rule?: ConfigRule;
      receivedType?: "string" | "number" | "boolean" | "null" | "array" | "object";
      receivedScalar?: string | number | boolean };
function formatConfigFailure(failure: ConfigFailure): string;
```

`subject` 是 owning validator 的 section/已知 path；`unrecognized_keys` 提供的未知字段名也属于可行动的定位事实，例如 `backend.requestTimeotMs`，保留该 key/path，不回显其对应值或整个对象。公开输出经过既有单行转义与总预算截断；不新增秘密扫描或 key 注册表，也不因用户控制的 key 理论上可能夹带文本就抹掉普通拼写错误目标。`receivedScalar` 只有 owner 明确认定为非秘密且有纠错价值时才填，第一阶段限 query/Backend 数值；logging level 不回显非法字符串，避免把误填的凭据带进提示或日志，也不引入 token 筛选或秘密扫描。类型错误通常只报 received type，logging level 同时保留允许枚举。URL/path 配置只报规则，不回显可能嵌 credential 的原值。不传数组、对象、整份文档或 parser snippet，不得扩成任意上下文大包。

`formatConfigFailure` 负责配置事实的自然语言表达和固定修正方向，不负责终端转义/预算、日志写入或协议选择。把事实转成一次 message 是必要的共享语义，不是重建 CLI renderer；Backend 可直接使用它而不依赖 CLI。

`ConfigError` 增加可选 `failure`：文档/本阶段 logging 错误填入事实；初始化权限等不具备可分类配置事实的失败继续使用安全通用消息，不伪造事实。构造时只接受安全 failure，不接受原 parser/Zod Error 作为 cause，也不保留其 message、stack 或 snippet。`loadConfig` 在对应边界构造新 ConfigError，保留现有 ENOENT、空文件、JSON_SCHEMA、大小限制和 finally close。`YAMLException.mark.line/column` 转为一基位置；不解析 exception.reason/message，不另加 CST parser 或文件扫描。

source 的 label 由 owning consumer 提供，不在通用类型中枚举 backend/embedding。选择内部类型而不是直接拼文案，是因为传播与降级都需要保留同一事实；选择普通类型和函数而不是框架，是因为没有独立事件生命周期或策略注册需求。

### 2. 约束只有一个真源，消费方决定 terminal

- Query 在 `query/settings.ts` 保留两个整数规则和 engine method catalog。将现有 min/max 提为本模块常量，原 integer 校验和 failure.rule 使用同一常量；不另写消息专用范围表。保持已声明的 override/keyword 行为和 invocation `ConfigReader`。
- `loadSemanticRetrievalSettings` 的 index status/build/rebuild 和 Pack install indexSync 调用者一起迁移，但不改失败所有权。`install-command.ts` canonical commit 后既有 `indexSync.failed`（及其 regression test）保持，不能因共享 loader 更准确就抛到 main/回滚 Pack；成功路径 flush 仍呈现独立 logging fallback。
- Backend 在 `config/model.ts` 的 timeout schema、`config/embedding.ts` 的嵌套 schema 定义旁集中现有数值边界，再同时用于 schema 与 failure.rule。嵌套字段定位来自 Zod issues 的 path；选第一项可行动 issue。用本模块 schema 的 shape/嵌套 shape 校对已知路径，不维护第二份 key 正则/枚举表；unknown-key 的 subject 来自 `unrecognized_keys` 实际返回的字段名及 owning path，而非自行遍历用户对象。union/refinement 不支持精确规则时，回到 section + 实际 format/size 规则，不猜 expected 值。
- Backend 的 environment 数字格式仍在 `loadBackendConfig` 入口以现有 `/^[1-9][0-9]*$/` 验证；记录确切变量名与“无前导零的正十进制整数”规则，不能只显示数值范围而使 `001`/`1e3` 看似合法。随后范围由同一个 timeout 约束决定。每个已提供来源仍独立有效才合并，不因后面覆盖就接受坏来源。
- embedding serialized bytes 超限区分“源输入”与“补默认路径后的 resolved embedding”：后者不能错误标注为 YAML 中某个 key 的原始值。保留现有 2048-byte 限制，不新增序列化扫描。

消费方通过 `formatConfigFailure` 生成安全 message 并保持原 `CliError`/`BackendError` code。为同因去重，query 的 CliError 保留安全 ConfigError cause；BackendError 用已有 ErrorOptions.cause 保留安全 ConfigError；`backend/error.ts:backendCliError` 和 CliError 增加可选 ErrorOptions（保留 resource 第三个参数）继续保留该 cause。仅本机对象传递，Backend HTTP body/error schema 不增加字段；其他异常仍由 allowlist 与 generic message 处理。

Backend `loadBackendConfig` 仍独立读取，不为去重引入新的共享快照或缓存；控制端持有的 launch settings/embedding 快照仍按原流程写 record，daemon 消费已接受快照。纯 `resolveBackendSettings` 从 runtime record 解析的错误使用 resolved backend 来源，不谎称当前 YAML。显式初始化 `control-commands.ts` 捕获到有事实的 ConfigError 时同样保留安全 cause；无事实时继续安全泛化，不把初始化权限失败猜成 YAML syntax。已有文件不改写，缺失文件仍由原显式 start 初始化。

### 3. 通用 fallback 只恢复明确的配置失败，logging 是薄适配

新增 `packages/config/src/fallback.ts`，仅依赖安全 ConfigError，导出：

```ts
type ConfigResolution<T> =
  | { kind: "configured"; value: T }
  | { kind: "fallback"; value: T; error: ConfigError };
function resolveConfigWithFallback<T>(
  load: () => Promise<T>, fallbackValue: T,
): Promise<ConfigResolution<T>>;
```

函数只调用 `load` 一次，成功直接返回原 value；捕获 `ConfigError` 时返回调用方传入的 fallbackValue 与原安全 error，其他异常原样抛出。它不读配置、不校验结果、不重试、不选择默认值、不写日志，也不识别 section/Issue。消费方选择直接调用严格 loader 以传播错误，或调用该函数明确接受降级；返回的 value 是实际采用值，消费方据此发布事实，不能只宣称“已回退”而省略采用什么。

通用单测使用合成的 `display.pageSize` 与 override source（不是新增生产 section）：同一 fixture loader 抛 ConfigError，直接调用保留错误；提供默认值 `20` 后返回 `{kind:"fallback",value:20,error}`，成功 `10` 原样返回，普通 TypeError 原样抛出。无需修改 primitive 或添加 section 分支来通过该测试。

在现有 `packages/config/src/logging.ts` 中增加：

```ts
type LoggingResolution =
  | { kind: "configured"; persistentLevel: LoggingLevel; effectiveLevel: LoggingLevel }
  | { kind: "fallback"; fallbackLevel: "info"; effectiveLevel: "info" | "debug";
      cause: { kind: "config"; error: ConfigError } | { kind: "unavailable" } };
function resolveLoggingSettings(options: LoadConfigOptions & {
  readConfig?: ConfigReader; debug?: boolean;
}): Promise<LoggingResolution>;
```

保留 `loadLoggingSettings` 为严格、只负责 logging section 的读取入口。logging adapter 调用 `resolveConfigWithFallback(() => loadLoggingSettings(...), DEFAULT_LOGGING_SETTINGS)`，由返回 value 得到 persistent level，再应用 debug。loggingLevels 仍是唯一 enum；缺失 logging/level（包括 `logging: {}`）合法，错误 section shape、错误 level 类型/值在原 validator 产生 fact，不增加校验阶段。ConfigError 分支返回 `cause.kind=config` 与原安全 error，debug 最终提升为 debug。

未知异常不由通用 primitive 吞掉。仅 logging adapter 最外层保留已有可用性策略：该读取发生未知失败时仍选择 info（单次 debug 则为 debug），返回 `cause.kind=unavailable`；现场和本机记录只说明“logging settings could not be applied”及 fallback/effective，不赋予来源、key、YAML 类别、行列或原异常文本。此分支不是配置事实，不能参与文档同因去重；其他消费者不自动继承此兜底。

CLI/Hook 的 `createProcessLogRuntime` 将 resolver 结果用于原 logger 与 diagnostics construction，删除 `configuredLevel` 的 early debug 和 catch-info 静默分支。daemon 用相同 resolver（无 CLI debug 参数），删除 `.catch(() => "info")`。不把 daemon/request debug 放入用户配置，也不让 daemon 继承启动 CLI 的 trace。

fallback 只有 info 或 debug，二者自然允许 warning；直接用现有普通 `log.warn("logging.level-fallback", context)` 即可。daemon 用现有 `TraceDetailLogEmitter` 记录同一 message/event 对应的普通 warning，component/source=backend，context 带 instanceId 和 typed fact。无需 force-write、绕过日志过滤或扩大 event union。fallback 本机 context 不需要复用公开文本的 400 字符限制，但不夹带原异常和凭据。

### 4. 一次现场提示在 flush 决定，同因 terminal 优先

CLI 新增 `log/config-fallback.ts`，只负责 fallback 的现场文案与同因判断；不存全局 set。将 `output/render.ts` 的 `safeErrorMessage` 提到 `output/safe-message.ts`，保留普通 400、protocol mismatch 2048 的既有调用；fallback 复用普通安全预算。先放 subject、规则、修正方向和 effective，再放来源与可选 received，避免长值挤掉行动信息。换行、ESC、双向控制符和超长路径按同一逻辑处理。

`ProcessLogRuntime` 增加下列窄接口；loggingResolution 与 flush 已提示标记都仅属于一次 `run()`，不持久化：

```ts
flush(options?: { terminalConfigFailure?: ConfigFailure }): Promise<void>;
```

日志 runtime 构造后，fallback 本机 warning 写入一次；已分类 cause 保留其安全 failure，无分类 config error 使用安全通用配置文案，unavailable cause 只报告已知的可用性结果。flush 关闭 fileSink 后，按需写现场 warning，再沿用原 sinkFailureNotice。重复 flush 不重复两类提示，但不改 sink 自身生命周期。成功路径可以在 stdout 渲染之后提示；不承诺 stdout/stderr 的跨流顺序，始终保持 stdout 纯净。catch 在 flush 前从原 error 的安全 ConfigError cause 提取 terminal fact，再渲染原失败。

同因只匹配双方均为 document failure，规范化 file path、reason 与可靠行列相同；不按 message/code 泛化、不匹配 setting failure、不吞掉未知异常。Backend 的独立读取也可如此匹配，但这不是跨读取文档版本一致性承诺；不重读、不加 hash/指纹。query 因同一 YAML 失败时压掉重复现场 warning；`usage.invalid`、`pack.not-installed`、Backend 另一 setting 失败均保留独立 fallback 提示。本机 fallback 记录不因现场去重删除。

Hook 在既有 finally flush，不传 terminal fact（它的业务结果是原 no-op/continue，不是普通 CLI terminal envelope）；保留一次配置 fallback 与宿主原有 degraded 提示的不同含义，不重复追加 YAML exception。

daemon 在 sink 安全预检成功后写一次 Backend startup warning；其 detached stdio 继续忽略，没有 CLI/Hook 的现场提示责任。预检不安全仍按原 `backend.state-invalid` 拒绝，不能为了保存 fallback 记录放宽它。预检后写入失败按原禁用逻辑处理，不新增 stderr forwarding、状态文件或 readiness 字段。

### 5. 一条完整组装路径

现状：`main.run` 创建 process log runtime，runtime 的 ConfigReader memoize 共享文档；`createProgram` 把它交给 query loader；loader 抛 CliError，`toVisibleCliError` 受命令 allowlist 控制，catch flush，再 `renderResult` 返回 text/JSON。Backend control 使用 supervisor 独立加载配置并组装启动资源；daemon 独立加载 logging。文件句柄、sink 与 runtime 资源分别由现有 loader finally、process flush 和 Backend shutdown 拥有。

目标保留这条链，新增的协作示意如下（只省略现有命令构建和记录字段）：

```ts
// log/runtime.ts：已有 invocation reader 仍唯一拥有自己的 Promise 文档。
const readConfig: ConfigReader = () => document ??= loadConfig();
const logging = await resolveLoggingSettings({ readConfig, debug: options.debug });
const log = createLogger({ source, level: logging.effectiveLevel,
  context: { traceId }, sinks: fileSink ? [fileSink] : [] });
if (logging.kind === "fallback") log.warn("logging.level-fallback", {
  ...(logging.cause.kind === "config" && logging.cause.error.failure !== undefined
    ? { failure: logging.cause.error.failure } : {}),
  cause: logging.cause.kind, fallbackLevel: logging.fallbackLevel,
  effectiveLevel: logging.effectiveLevel,
});
// 返回原 runtime，并在 flush 内读 logging、同因 fact 与本地 once 标记。

// main.ts：成功沿用 createProgram 的渲染；失败传入原 error 的安全 cause。
try {
  await program.parseAsync(args, { from: "user" });
  await processRuntime?.flush();
} catch (error) {
  const visible = toVisibleCliError(error, visibleErrorCodes, command);
  const terminalConfigFailure = visible.code === "runtime.unexpected"
    ? undefined : configurationFailureFrom(error);
  await processRuntime?.flush({ terminalConfigFailure });
  renderResult(format === "json" ? stdout : stderr, format, {
    kind: "failure", command, code: visible.code, message: visible.message,
    resource: visible.resource, diagnostics: { traceId },
  });
}
```

`configurationFailureFrom` 属于 CLI `runtime/config-failure.ts`：只沿已知 CliError/BackendError 包装检查安全 ConfigError cause，类型窄化后返回 fact，不递归遍历任意错误树或解析 stack。若 allowlist 将原错误泛化为 unexpected，不对外暗示隐藏原因已经呈现。

### 6. 兼容与替代方案

不选默认 details/notices：与 message 重复、没有展示真实 machine consumer，却引入严格旧 schema 迁移和 Agent 上下文成本；#259 已给出明确反证。代价是程序不能从本次 failure/success envelope 直接读取 setting/reason，本提案明确不承诺原 Issues 的这一能力。

不选只修各处 message：无法说明 logging 成功但回退，也无法可靠同因去重；不选通用 notice 框架：本阶段只有一个需要非阻塞呈现的配置事实。不新增 opt-in flag，占位接口不能代替具体 consumer 需求。

保留严格 loader 与通用 fallback 函数的分离，是 validator 报告事实、消费者选择后果；logging adapter 只拥有 level/debug 与既有 availability 策略。CLI 与 daemon 装配差异只在 stderr、trace/instance 和 sink 所有权，不复制校验或 fallback 算法。

### 7. 维护演练

- 修改 timeout 范围：消费方同一约束常量驱动 schema 与 ConfigRule，改对应行为测试；CLI renderer、logging resolver 不变。不为修改数字维护两份规则表。
- 同一配置失败由另一个消费方选择默认值：复用 `resolveConfigWithFallback(load, explicitDefault)`，消费方发布返回 value 与 error；无需新增 section 模式、默认值注册表或复制 catch 算法。只在单测 fixture 演练，不把新生产配置放进范围。
- malformed YAML 同时影响日志与 query：loader 生成安全文档 fact，query 包装保留它，catch 将 fact 交给 flush 抑制同因 warning；文件 finally 关闭、日志照常 flush，原 query code/exit 不变。若 sink 同时失败，只多出原 sink 失败行，不新增恢复资源。

## Risks / Trade-offs

- [人类消息非机器接口] → 保留 error.code 与现有本机日志入口；不把 prose 固定为测试逐字协议。真实 consumer 出现后，按所需动作和字段重新设计最小接口。
- [独立 Backend 读取期间文件可能变化] → 同因抑制只针对相同已知文档事实，不声称全进程共享快照；不为此增缓存/锁/指纹。
- [长 source/value 挤占安全消息] → 原终端预算与转义函数不变，必要定位/规则/修正方向优先，完整安全事实留在本机日志。
- [stderr 被重定向后用户可能不看提示] → JSON schema 不扩展；这是采用现有 stderr 语义的显式代价，不能据此自动恢复被拒绝的 notice 协议。

## Migration Plan

1. 先补安全文档 fact、源头规则映射与 focused regression tests；迁移 query/Backend cause 保留和 message，移除被替代的 invalid helper 文案拼接及 embedding 已知 key 正则。原规则与错误码不变。
2. 引入通用 fallback 函数与薄 logging adapter，CLI/Hook/daemon 一起切换，删除原散落的 silent fallback catch；接入一次 warning 和现场同因抑制。保留原严格 loader、sink 安全检查和 shutdown/flush 资源所有权，不借机重构其他消费方。
3. 增加 process acceptance 并同步实际支持的站点中英文配置/排障说明、维护者配置文档。无需数据迁移或用户操作；回退实现只影响诊断丰富程度，不改变用户文件或已有日志可读性。

行为验收按 requirements 的 1–11：先 unit 验证通用传播/fallback、loader/validator/level，再在隔离 HOME、Store/cache/log 路径走真实 CLI text/JSON、Hook 原 ABI 与日志读回。daemon 验收用已有隔离 runtime harness，验证真实启动配置回退和 source/instance 记录，不需模型下载，不触碰共享实例。正常路径和 sink 拒绝分别验证；不以静态 JSON 或只测 formatter 代替真实命令，不用不可能的内部 mock 输出为新增 guards 辩护。

结构验收独立检查：规则是否仅一份、无 CLI 反向依赖、failure 不含原 parser/Zod exception、cause 传递有限、无新公共字段/全局状态、旧 silent 分支与重复规则是否删除、stdout/trace/debug 和资源 cleanup 的所有者是否保持。结构审查不使用源码字符串/类名断言代替判断。
