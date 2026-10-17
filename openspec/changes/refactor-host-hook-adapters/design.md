## Context

动机与范围见 [proposal.md](proposal.md)。本文件定义保持现有行为的内部重构设计。行为保真和代码边界的验收见 [acceptance.md](acceptance.md)，执行结果见 [verification.md](verification.md)。不创建 capability delta，不将本文件同步为 stable spec。

### 代码依据

本次分析基线为主线 `963963e`；以下链接固定到该版本，避免当前 worktree 缺少 omp 造成错误判断。

| 观察 | 代码依据 |
| --- | --- |
| 六份参数识别、日志、执行和 flush 分支先于普通 Commander 流程 | [main.ts:68–211](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/main.ts#L68-L211) |
| 宿主文件主要为别名和转发，实际协议判断集中在公共处理器 | [codex.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/hook/codex.ts)、[host-hook.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/hook/host-hook.ts) |
| Catalog、shell、候选提示已有可复用规则 | [catalog-store.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/hook/catalog-store.ts)、[shell-association.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/hook/shell-association.ts)、[practice-hints/backend.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/practice-hints/backend.ts) |
| Catalog 实际经过 ListService 和 Store cold open，而非简单读一份 JSON | [list/service.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/engine/src/list/service.ts)、[local-store.ts:146–155](https://github.com/lorelum/lorelum/blob/963963e/packages/engine/src/local-store/lifecycle/local-store.ts#L146-L155) |
| omp 是三类私有请求的 bridge，不是原生 Hook payload | [omp.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/cli/src/hook/omp.ts) |
| omp 生命周期状态属于原生扩展，候选持久化属于 Backend | [catalog.ts](https://github.com/lorelum/lorelum/blob/963963e/plugins/omp/lorelum/extensions/catalog.ts)、[session-handoff.ts](https://github.com/lorelum/lorelum/blob/963963e/plugins/omp/lorelum/extensions/session-handoff.ts)、[sessions/service.ts](https://github.com/lorelum/lorelum/blob/963963e/packages/backend/src/modules/sessions/service.ts) |

现行 stable specs 的具名宿主覆盖少于主线实现。此重构不以补全规范为名改变六宿主行为，也不采用已关闭 PR #269 的事件语义草案作为依据。

## Goals / Non-Goals

**Goals:**

- 每个宿主拥有自己的输入解释、事件支持范围、响应编码、权限字段和失败降级。
- 公共 runner 不认识原生事件、工具名或宿主 JSON 字段；公共能力不接收原始 payload。
- 参数只解析一次，日志创建与关闭只有一套流程；业务依赖在本次调用入口明确组装。
- 保留现行 CLI、Hook、omp bridge、设置及数据行为，清理转发层并迁移全部仓库调用者。

**Non-Goals:**

- 不增加统一任务生命周期、任务识别器、Orchestrator、自动 query/get、事件总线或 capability 注册平台。
- 不使缺少子 Agent 上下文通道的宿主获得模拟通道；不合并宿主会话和任务身份。
- 不改变 shell 注入默认设置、审批流程、Catalog 内容与预算、Backend 超时/恢复、omp 生命周期/取消策略。
- 不优化 Store cold open、不引入缓存、重试或新依赖。不声称本重构有未测量的性能收益。

## Decisions

### D1. 统一具体能力，不统一宿主生命周期

原生事件只在对应宿主模块解释。相同操作可由不同事件触发；同名事件也不假定有相同时序和控制权。禁止将 `SessionStart` 改名为 `task_started`、将 Stop 解释为交付前检查，或给未知宿主能力提供默认空实现来宣称支持。

原生事件的配置仍位于 `plugins/<host>/lorelum/`。adapter 只解释本次调用，不能凭事件名称创建跨事件任务状态。

### D2. 命名和类型分三层

1. 协议层保留原始字段及大小写：`SessionStart`、`sessionStart`、`updatedInput`、`updated_input` 不做全局大小写归一化。
2. 宿主模块内使用具体名称，如 `CodexPreToolUseInput`、`CursorSessionStartInput`、`OmpBridgeRequest`。不再将不同宿主 payload 都别名为 `HostHookInput`。
3. 共享操作按用途命名：`readCatalog`、`associateShell`、`readHintContext`。它们不含 `hook_event_name`、工具名或原生 envelope。

输入以 `unknown` 进入协议边界，宿主内解析为按事件区分的类型。解析器只执行操作需要的既有校验；不能因类型收紧而开始拒绝原先允许的额外字段、丢弃 tool_input 其他属性或改变缺字段 no-op。omp 的既有严格请求键校验与五宿主的宽松对象输入分别保留。

### D3. 目录和依赖方向

拟议目录，全部属于 CLI 内部实现：

```text
packages/cli/src/
  hook/
    command.ts                 # 一次解析 argv，选择宿主并组装依赖
    command.test.ts            # 公共参数与普通 CLI 回落
    runner.ts                  # stdin、JSON、stdout、异常出口
    runner.test.ts             # 通用读取、JSON 和异常出口
    types.ts                   # 最小 endpoint、IO 和调用参数类型
    endpoint.test-helper.ts    # 共享的生产组装调用辅助
    hosts/
      codex.ts                 # 真实协议 adapter，不再只是转发
      codex.test.ts
      claude.ts
      claude.test.ts
      cursor.ts
      cursor.test.ts
      workbuddy.ts
      workbuddy.test.ts
      zcode.ts
      zcode.test.ts
      omp.ts                   # 独立 bridge 协议
      omp.test.ts
      native-protocol.test.ts  # 多宿主共有的别名与原生降级契约
    services/
      catalog.ts               # Store 根解析、ListService 与已有 renderer 组合
      shell-association.ts     # 现有设置、命令检测和 quoting 规则
      read-hints.ts            # 按 session 读取并渲染候选
    pack-catalog.ts            # 保留共享纯 renderer
    agent-settings.ts          # 保留现有 config 读取语义
  backend/
    process-client.ts          # 从 model/commands.ts 移出的通用连接工厂
  practice-hints/
    backend.ts                 # 保留 get 报告等可选 Backend 请求规则
    render.ts
```

`main → hook/command → runner + host adapter → shared services → Engine / Backend client`。宿主 adapter 不反向导入 main；公共 services 不导入 hosts。`plugins/omp` 仍通过已发布 CLI bridge，不导入 CLI/Engine/Backend 的运行时代码。

不将 `practice-hints` 全部搬入 Hook：成功 get 的记录并非 Hook 专用。通用 Backend 连接工厂必须移到 `backend/process-client.ts`，避免提示能力依赖模型命令模块。

测试按被验证规则的所有者归位，而非按最外层调用入口归位。宿主输入、权限、响应及 fallback 测试与 `hosts/<host>.ts` 配对，即使通过公共 runner 执行也不移入公共层。多宿主共有的原生协议断言保留在 `hosts/native-protocol.test.ts`，不夹在 Codex 等单一宿主文件内，不由此定义统一生命周期。公共参数与错误路由集中在 `command.test.ts`，通用 transport 集中在 `runner.test.ts`；renderer、设置和共享算法的测试继续与实现配对。多个宿主使用的 `endpoint.test-helper.ts` 留在公共层，不建立只有一个实现和测试的宿主子目录。

### D4. 内部接口和组装

以下是拟议最小接口；`SessionRef` 复用现有 Backend client 类型，JSON 对象类型复用仓库可用的 JSON 类型定义，不创建另一套序列化框架。

```ts
interface CatalogReader {
  readCatalog(): Promise<string>;
}

interface ShellAssociator {
  associateShell(input: {
    session: SessionRef;
    command: string;
    syntax: "posix" | "powershell";
  }): Promise<string | undefined>;
}

interface ReadHintReader {
  readHintContext(session: SessionRef): Promise<string | undefined>;
}

interface HookEndpoint {
  readonly label: string;
  handle(payload: unknown, context: { readonly byteLength: number }): Promise<JsonObject>;
  fallback(payload: unknown): JsonObject;
}
```

- `CatalogReader` 创建时绑定本次解析后的 Store root；它复用 ListService 和现有 Catalog renderer，不改 Store 读取规则。
- `ShellAssociator` 读取既有 `lore-only/all-shell` 设置，复用命令检测和 quoting。语法由 adapter 根据宿主工具及平台选择。
- `ReadHintReader` 返回候选提示文本或没有内容，不执行 query/get。普通 Hook 保留 Backend 不可用时的空结果，omp 保留读取错误上报 bridge 的区别；通过两个明确的工厂入口组装，不能全局把异常都吞掉。
- endpoint 工厂按需接收窄依赖，不再从 `HostHookServices` 继承完整服务包。例如 Codex 接收三个操作加平台；omp 另外显式接收 `isSubagentCatalogEnabled(): Promise<boolean>`，该配置不进入通用 CatalogReader。
- 默认生产依赖在 command 组装一次；services/adapter 不再在方法内通过 `?? defaultServices` 查找全局默认对象。组装可以创建客户端工厂，但只有实际执行相应操作才连接 Backend 或访问 Store。
- transport 把原始 stdin 字节数作为 handle 的调用上下文交给 adapter，避免重新序列化后丢失现有 debug 日志中的 byteLength；label 与 HookIO.host 仅用于诊断，不承担事件映射。Catalog 依赖在 command 定义延迟 getter，禁用的 omp sub 请求不读取注入的 list/storageRoot getter，也不构造 Store 服务。
- `JsonObject` 只用于最终序列化边界，各 adapter 内保留具体 response 类型。Codex 的权限字段不是跨宿主可选字段，Cursor 类型不允许混入嵌套 envelope。

endpoint 工厂返回具体 handler 和 fallback 的闭包。`HookEndpoint` 不是生命周期接口，不设 `onTaskStart` 或 `onBeforeComplete`。不使用 BaseHook、模板方法继承或让 Claude adapter 继承 Codex adapter。真实重复的协议编码片段可用纯函数复用，但不能据此合并宿主协议所有权。

### D5. 完整调用链和结束规则

```text
宿主 hooks.json / omp subprocess
→ lore hook <host> [--store-root ...] [--debug]
→ main.run
→ parseHookInvocation（一次扫描，保留既有参数接受/拒绝规则）
→ 创建本次日志 runtime 和按需 service 工厂
→ 显式 host factory 映射，创建 endpoint
→ runner 读取 stdin 一次、JSON.parse 一次
→ endpoint.handle：宿主解析 → 共享操作 → 宿主响应编码
→ runner 写单行 JSON 到 stdout
→ finally flush 日志
→ 返回退出码，进程入口设置 process.exitCode
```

runner 只处理 transport，不识别原生事件或权限字段。JSON 解析失败时 fallback 接收 `undefined`；解析后操作失败时 fallback 接收该原始对象，让宿主按现行事件分类选择空响应。runner 将异常交给现有诊断机制，诊断不能进入 stdout。

`parseHookInvocation` 对不匹配、未知 host、非法选项保留原先进入普通 CLI 路径的行为，不借重构扩大参数支持。普通 Commander 命令及标准 envelope 不进入 Hook transport。

日志 runtime 的关闭放进一次 finally，避免每个宿主复制 flush；不顺带改变日志存储、事件名称、级别或增加遥测。此前发现的开始事件硬编码问题不在本次行为保真重构中顺带修正。

### D6. 六宿主事件和接口映射

| 宿主 | 原生入口 / bridge | 内部操作和映射 |
| --- | --- | --- |
| Codex | `SessionStart`；`PreToolUse` Bash；`SubagentStart` | Catalog 用嵌套 context envelope；工具改写按平台选 POSIX/PowerShell，并保留现行 `permissionDecision: allow`；子 Agent 读取父 session 候选 |
| Claude Code | `SessionStart`，配置含 fork；`PreToolUse` Bash/PowerShell；`SubagentStart` | Catalog/候选用嵌套 envelope；语法由工具名决定；updatedInput 不添加 permissionDecision |
| Cursor | `sessionStart`；`preToolUse` Shell | Catalog 返回顶层 `additional_context`；session_id 优先、conversation_id 备用；命令返回 `updated_input`；不假设首轮可见，不新增子 Agent 通道 |
| WorkBuddy | `SessionStart`；`PreToolUse` Bash | 嵌套 Catalog；POSIX 命令前缀，无 permissionDecision；不注册 stdout 被丢弃的 SubagentStart 提示路径 |
| ZCode | `SessionStart`；`PreToolUse` Bash | 保留 process 启动形式、POSIX 命令前缀和无 permissionDecision；没有新增子 Agent 提示 |
| omp | `{event: catalog/shell/read-hints}` | 独立请求 union；Catalog 返回 `additionalContext`，shell 返回 `command`；主 Agent 目录启用，sub 按既有设置决定，默认 `{}` 且不访问 Store；候选读取独立于该设置 |

宿主输入里的额外 tool_input 属性必须原样保留，只有 command 被替换。权限决定、shell 类型、session 字段优先级不能抽象成共享层的 host 分支。

unsupported event、工具不匹配、session 缺失、无 lore 命令和 malformed JSON 是不同情况，不统一成一种默认空响应：

- 五宿主 SessionStart 和畸形 JSON 保留 `continue: true` 降级。
- Codex/Claude/Cursor/WorkBuddy 已识别工具/子 Agent 事件的异常保留 `{}`；ZCode 异常仍保留现行 `continue: true`，不能被统一 runner 改写。
- 合法但不需处理的工具请求保留 `{}`，不改命令。
- omp disabled、无候选、非法请求均按现有 bridge 形状返回 `{}`，诊断条件保持现行区别。
- 具体 unsupported event 的 no-op/诊断分类以基线 adapter 测试与源码为准，不因宿主文件重组扩大事件接受集合。

### D7. 状态归属和能力缺失

| 状态 | 唯一拥有者 | 重构约束 |
| --- | --- | --- |
| 单次 argv、payload、日志、service 绑定 | CLI 调用 | 调用结束释放；不保存跨调用任务状态 |
| 目录文本构造 | 共享纯 renderer | 不缓存、不维护任务阶段 |
| omp 快照、pending、generation、取消及临时消息去重 | 原生 extension 实例 | 原有生命周期失效和时序保持，不搬进短进程 CLI |
| omp 原始 Main 来源与嵌套 child handoff | 原生 extension handoff | 保留身份校验、冲突拒绝与清理；child get 仍属于 child |
| session 关联、短期 shell 活动窗口 | Backend sessions | 近似关联不提升为任务身份或授权 |
| practice-reads.jsonl | Backend practice-hints | 不改格式、位置、保留和读取规则 |

omp 的 `session_compact` 先使快照失效，下一次 context 才调用 Catalog；五宿主的 SessionStart 则由宿主执行并消费响应。共享目录生成，不共享交付时序。omp Main/child 临时上下文继续使用 user 消息，保持权限层级和不持久化行为。

不建立支持所有生命周期的布尔大表。配置声明、handler 能处理、宿主实际消费是三个不同证据层次。只保留已经接通的处理路径；不支持时不注册假 Hook、不轮询、不推测、不执行默认生命周期方法。配置测试验证实际声明能被对应 adapter 处理，真实宿主验证证明内容被消费。

### D8. 迁移与删除规则

1. 在含 `963963e` 的实现基线上迁移，不从旧 worktree 复制缺失的 omp 功能。
2. 保留现行行为测试，删除仅断言内部文件名、转发关系或函数命名的测试，不重新固定实现细节。
3. 移动导出符号前用 LSP references 迁移所有仓库调用者，检查 `packages/cli/src/index.ts`。现有包是 private；无调用者的旧别名和转发出口删除，仍有用途的能力迁入明确模块。不保留 deprecated shim、同名转发层或两套入口。
4. 六宿主逐个迁移到真实 adapter；再移除中央 host 分支与旧 host-hook 实现。切换后的 main 只调用公共 Hook command，不并存旧入口。
5. 更新维护者代码导航与调用链说明。产品行为无变化，因此不改站点用户指南；若发现必须改变协议/默认值/权限，停止该部分，单独设计，不能把它藏进本重构。

## Risks / Trade-offs

- 分开 adapter 会重复少量外部协议形状；代价可接受，避免宿主互相耦合。共享真实操作，不追求所有 JSON 字段零重复。
- 类型收紧可能误改输入兼容性；以额外字段保留、session 优先级和 malformed/no-op 场景验证，不擅加新校验。
- runner 统一可能抹掉宿主异常差异；fallback 必须归宿主，并保留普通提示与 omp 的诊断差异。
- 私有导出调整仍可能遗漏仓库调用者；以 LSP 引用迁移、包级 typecheck 和行为测试闭环，不凭文本搜索猜测调用者。
- 主线完整宿主能力不等于在本机都能实测；实施验收记录必须区分源码 CLI、模拟扩展与真实宿主，不把测试通过当成平台支持。

## Deferred

统一任务生命周期、识别机制、自动投放和新的宿主能力均不属于后续实现的隐含任务。只有独立用户问题、真实宿主入口与另行授权才重新设计。没有需要实现者自行选择的事件命名、默认值或权限策略；与基线行为冲突时保留基线并提交明确差异，不自行扩展范围。
