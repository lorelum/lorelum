# Design

## Context

动机见 [proposal.md](./proposal.md)，用户路径见 [product.md](./product.md)。本变更是新增产品行为，下面的现状证据不代表 Pi 集成已存在。

### Observed Evidence

- 当前 `plugins/` 没有 Pi artifact。`docs/development/plugin-conventions.md` 要求 `plugins/<hostKey>/lorelum/`、宿主原生安装/信任，以及 CLI 拥有共享 Catalog renderer。
- `packages/cli/src/hook/host-hook.ts` 包含既有 host union、事件/envelope 适配、共享 `listPackDetails`、Store resolver 和 fail-open；`main.ts` 在普通 CLI registry 前分发 raw Hook ABI。
- `pack-catalog.ts` 的默认预算为 4000 字符，normalize/dedupe/sort 元数据并保留截断提示；空 Store 不是错误。对应 `pack-catalog.test.ts`、`zcode.test.ts`、`cursor.test.ts` 已覆盖相关行为。
- `skills/lorelum/` 是 portable Skill core；`docs/development/skill-guidance-fixtures.md` 定义检索一致性，Plugin 内 Skill 可以适配 Catalog 条件。
- 本机 `@earendil-works/pi-coding-agent` 的 `package.json` 为 1.2.0。已完整核查 `docs/extensions.md`、`packages.md`，及研究者读取的 skills/compaction/sessions/cli/configuration/settings crossrefs。实际 `dist/core/extensions/types.d.ts` 定义 `session_start`、`session_compact`、`context`。
- Pi `dist/core/agent-session.js` 的内部恢复使用 `agent.continue()`，不重新触发准备用户 run 的 `before_agent_start`；`dist/core/extensions/runner.js:emitContext` 在每次模型请求前变换 conversation，并恢复系统提示及工具状态。
- Pi `dist/core/package-manager.js:installGit/collectPackageResources` 以仓库根安装依赖与发现资源，没有已验证的 Git 子目录安装参数。原生 local Package 则直接从指定目录加载资源。
- Pi `exec` 公开选项仅 cwd/timeout/signal，没有 stdin 参数，不能直接向现有 raw Hook ABI 传 payload。其现有超时实现不应被宣传为强硬墙钟保障。
- `scripts/ci/typecheck.ts` 仅覆盖 workspace/release 配置；新增 Plugin TS 不能仅声称根 typecheck 已覆盖，需接入独立配置。

## Goals / Non-Goals

**Goals:** 请求级幂等 Catalog 投影、生命周期级读取、共享 CLI 渲染、完整非阻塞错误路径，且不改变 Pi 正常 turn 调度或其他宿主协议。

**Non-Goals:** 不接管 Pi system prompt、模型 provider 或工具 loadout；不持久化额外消息/会话数据，不维护已读 Practice，不为子 Agent Extension 设计互操作事件。其他已有宿主的合同漂移不在本次整体清理。

## Decisions

### 1. 原生 local Pi Package，不改仓库根分发

源码根固定为 `plugins/pi/lorelum/`。内部 `package.json` 的产品名称为 `lorelum`，显式 `pi.extensions` 只列 `./extensions/lorelum.ts`，`pi.skills` 只列 `./skills/lorelum`。辅助实现、测试不得被目录自动发现为 Extension。宿主提供的 import 只以公开类型和 peer 使用，不 bundle，不新增运行时依赖。

第一版以 `git clone` 加 `pi install <absolute-checkout>/plugins/pi/lorelum` 为正常支持路径。local Package 不要求用户安装 monorepo 依赖，不把本地源码误称为 Git-managed Pi source。更新 checkout 后 `/reload`；不宣传 `pi update --extensions` 会替用户更新 local source。

替代方案：仓库根增加 `pi` 字段可支持整仓 Git 安装，但 Pi 会对根执行依赖安装，带入不属于集成运行时的 monorepo 安装责任；本次不采用。独立 npm 来源需要额外发布授权，延期。不存在的 Git 子目录 URI 不可使用。

### 2. 新增窄 `lore hook pi` ABI，复用 renderer

沿用 CLI raw Hook 的 stdin JSON/单行 stdout 机制，只支持本提案的两个事件：

```json
{"hook_event_name":"session_start"}
```

或 `session_compact`。成功：

```json
{"additionalContext":"Lorelum Installed Pack Catalog\n\n..."}
```

故障或未知事件 stdout 为 `{}`，stderr 为 `lore hook pi degraded: ...`，退出 0。CLI 参数错误仍保持普通用法错误，不把无效参数伪装为成功。Pi envelope 是 **Lorelum Extension 与 CLI 的适配合同**，不是 Pi 自带 shell Hook response schema；Extension 显式解析后用 Pi API 投影。

`HostHookName` 增加 `pi`，但不得加入 `PracticeHintHost` 或 Backend session host 枚举。薄 `hook/pi.ts` 与 `main.ts` 路由接入共享读取/renderer，支持现有 `--store-root` 和 `--debug`，不改变其他 host response。Store root 使用既有 resolver，Pi 不另读本机配置或推断 Store 路径。

替代方案：复用其他宿主 envelope 会造成错误协议依赖；Extension 解析 `pack list --details --json` 再复制 formatter 虽可工作，但违背 CLI 共享 renderer 的责任，均不采用。

### 3. 生命周期读取与请求投影分离

- factory 只注册事件，不启动进程、timer 或 watcher。
- `session_start` 用当前 `ctx.cwd` 请求 `session_start` Catalog，清除旧快照；覆盖 startup/reload/new/resume/fork。
- `session_compact` 成功通知时清除旧快照并请求 `session_compact` Catalog；通知 handler awaited，不发新用户消息，不触发额外 turn。失败/取消压缩不刷新，不自行重试压缩。
- `context` 只从内存快照创建一个 `role: custom`、`customType: lorelum:pack-catalog`、`display: false` 的消息，不执行进程/Store 读取。仅移除同一自有 `customType` 的旧投影，然后放在 conversation 前部；保留所有其他消息及 tool call/result 顺序。保持快照 timestamp/content 稳定，避免每次制造无意义差异。
- 不使用 `sendMessage`、`sendUserMessage` 或 `appendEntry` 持久化目录；压缩摘要是否保留它不影响下一次投影。普通 transient retry 同样经过 `context`。
- 同一 runtime 的 tree 分支导航不改变 Pack Store，因此复用目录；无须建立分支阅读状态。Pack 外部 mutation 的主动刷新入口是现有 `/reload`。

替代方案：仅 `before_agent_start` 或压缩后 `nextTurn` 队列会漏掉同一 run 内部 continuation/overflow retry；修改 system prompt 或 `context_with_system` 不必要地接管宿主提示和工具状态，因此不采用。

### 4. 小型 CLI 进程适配器，明确终止及输出边界

用 Node 标准进程 API 实现单一职责的 helper，以 stdin 发送固定 JSON payload，stdout/stderr 分离；Pi `exec` 缺少 stdin，因此不为调用而导入内部 Pi exec 实现。

普通平台用 argv 执行 `lore hook pi`，设置当前 cwd。Windows 优先使用可直接执行的 CLI；只有 executable 缺失时适配安装器的 `lore.cmd`，通过固定 Windows command 调用 shim。`install.ps1:334-336` 表明 shim 会启动版本目录的 `lore.exe`，因此超时/取消需终止本次 shim 子进程树，不能只停止外层 cmd；终止目标只能来自本次创建的进程 ID。所有 shell 部分为固定文本，payload 始终走 stdin；不拼接 prompt、Pack 元数据、用户路径或任意工具输入。非零退出/Store 故障不触发 executable fallback 或重试。

设计预算为 5000 ms，stdout 上限 16 KiB，stderr 留存上限 8 KiB，持续 drain 未留存输出。截止或取消时停止等待并终止子进程，覆盖退出/错误/超时竞争；session_shutdown 只清理本 runtime 尚在运行的调用。不新增常驻进程、重试队列或通用进程监督器。预算是产品设计值，不是性能测量。

解析必须检查成功退出、未取消、JSON 对象、非空 `additionalContext` 字符串和 4000 字符上限；`{}` 是 unavailable，不是 empty Store。畸形、超大内容与不匹配 envelope 不注入。保留简短诊断，交互生命周期失败提示一次原因和对应恢复动作；非交互不写协议 stdout。执行失败先清除缓存，不使用旧快照掩盖故障。

### 5. Skill 只适配发现条件，不改变检索语义

以 portable core 为基础，Pi copy 说明优先复用当前可见 Catalog，缺失时一次 `lore pack list --details`；显式命令为 `/skill:lorelum`。保留 semantic-first、`preparing`/error 的恢复、get 全文与同 trace 排障规则。不注册 Lorelum 自定义工具，不添加 session identity 或全 shell 改写。

维护者 docs 说明新 ABI 和验证方式；站点 Pi 双语页说明实际交付的本地 Package 工作流。Plugin README 只提供导航/开发材料，不再重复整个用户指南。

## Requirement Evidence and Verification

| 增量要求 | 现状/关联证据 | 新验收 |
| --- | --- | --- |
| CLI-first 扩展到 Extension | 当前 agent-integration CLI-first；plugin-conventions | 静态边界测试：无 Engine/Backend/Store import 或实现 |
| Pi 生命周期/压缩请求目录 | Pi types、agent-session、runner | 实际 Pi runtime/provider 捕获 startup/manual/threshold/overflow retry 请求，逐请求恰好一份 |
| shared Catalog ABI | host-hook.ts、pack-catalog.ts 和现有测试 | `pi.test.ts` 成功/空/畸形/未知事件/Store 故障、预算和路由测试 |
| 非阻塞降级 | 既有 Hook fail-open，Pi UI/非交互模式合同 | mocked process 回归测试和正常安装缺 CLI smoke，任务继续且 stdout 不污染 |
| Pi Skill | portable core 与 guidance fixtures | 新 Pi Skill 纳入 fixture 验证，无 keyword 自动 fallback |
| Package 身份/信任 | Pi packages/skills 文档及 installer；plugin-layout.test.ts | 正常 local install/remove 与资源发现、个人/项目 trust smoke |

这些新增 Pi 要求目前没有已存在的 Pi 实现或通过的运行测试；不能以相似宿主的测试替代。

## Risks / Trade-offs

- [local Package 需要保留 checkout，更新比单条 managed Git 安装多一步] → 明确给出完整安装/更新/移除路径；不引入未批准的 npm 发布或根分发改动。
- [Pi 其他版本的事件行为不同] → 以实际 1.2.0 公开类型和真实 runtime 验证，文档记录验证版本；不承诺全历史版本。
- [请求级目录不完全计入 Pi canonical token threshold] → 共享 4000 字符预算，验证 overflow retry，无正文注入；不声称零 cache/token 成本。
- [每次压缩成功多一个短 CLI 调用] → 显式截止与输出预算，失败后继续，不引入自动 retry。
- [其他 Extension 后续 context handler 删除目录] → 不抢占完整上下文，支持边界是正常加载本集成的 Pi runtime；不承诺兼容任意破坏性 handler。
- [平台 shim 与退出行为差异] → mocked 平台测试加正常 Windows/macOS/Linux 安装验证；未验证的平台在 PR 中明确披露，不以沙箱兼容扩充范围。

## Migration Plan

1. 提案评审通过后实现 ABI、Package 与测试；独立开发分支，禁止直接提交 main。
2. 以隔离 Store 验证 worktree source CLI，再构建包含匹配 native runtime 的完整候选 CLI完成语义使用路径。
3. 在正常 Pi 环境安装候选本地 Package，完成 `product.md` 用户路径与实际 runtime 自动压缩测试，记录验证而非发布。
4. 实施后更新用户双语页与维护者 ABI/安装边界资料；现有宿主不迁移或重新安装。
5. 回退使用 Pi 原生 `pi remove <source>`；CLI 与 Pack 数据不受影响。旧 CLI 与新 Package 配对时仅失去自动 Catalog，不阻断 Pi，升级 CLI 后 `/reload` 恢复。

## Deferred Work

已读 Practice Session Tracking、子 Agent creation 合同、managed Git 根分发和独立 npm 发布均须另行评估，不留隐藏配置或占位 adapter。本提案不启动这些工作。
