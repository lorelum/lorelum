## Context

omp 插件通过 extension API 编排 Catalog 生命周期，Lorelum CLI 负责读取和渲染 Pack metadata。沿用 portable Skill 的 query/get/recovery 行为。动机见 [proposal.md](./proposal.md)，用户路径见 [product.md](./product.md)，证据见 [research.md](./research.md)。pi 不属于本次实施范围。

现有宿主通过 marketplace/manifest 发现插件，JSON Hook 传递事件与响应，CLI 负责 Catalog 和已读候选，Skill 负责 query/get。omp 的进程内 TypeScript callback 使用不同事件与返回值，需要单独的宿主 adapter。

### 事实、要求与建议

- **Observed**：两个实际宿主都加载了相同的 pi namespace import 与 startup probe；同一个 payload 在 pi 带 reason，在 omp 不带 reason。pi local package 与 omp 独立 marketplace 的安装、自动加载也已验证。
- **Required**：保持 CLI-first；只在 material moment 做 targeted semantic query；使用前完整 get；不可把 preparing 当空结果或自动 keyword fallback。
- **Proposed**：omp extension 在模型请求前提供临时 Catalog，生命周期边界使 Catalog 失效，下一次请求再从 CLI 刷新。增加 omp CLI bridge，不改现有宿主协议。
- **Required**：成功 get 记录关联实际 omp session；所有 task/eval 子 Agent（包括嵌套）获得源头 Main 成功读取的候选，不改变各子自身 get 归属。子 Agent Catalog 默认关闭，可显式开启。
- **Deferred**：pi 支持、其他未验证平台。宿主身份、权限与上下文由原生接口提供，不调用私有宿主代码。

## Goals / Non-Goals

**Goals:**

- 安装一次就获得 Skill 与 Catalog，不要求手工复制 Skill 或编辑两份宿主配置。
- 不同会话与 compact 之后不复用错误的 Catalog，不把 Catalog 写成永久会话消息。
- 按 omp 的插件接口与类型实现，并在真实宿主中验证安装和运行行为。

**Non-Goals:**

- 不提供 MCP、新的模型工具、自己的 package manager、Model/Store runtime、Pack 自动安装或更新。
- 不修改宿主的 bash/task 实现，不改变权限或 trust，不给整个宿主进程设置 `LORELUM_HOST_*`。
- 不把候选当成完整 Practice 或已采用证明，不复制读取存储，不改变已有宿主的 shell/Hook envelope。
- 不实现 pi artifact，不发布 npm 包或改动 release workflow。

## Decisions

### 1. 宿主分发与产品身份

建议目录：

```text
plugins/omp/lorelum/
  package.json
  extensions/catalog.ts
  skills/lorelum/SKILL.md
  skills/lorelum/references/...
.omp-plugin/marketplace.json
```

生产 Skill 是完整目录，不使用越出 package 的 symlink。沿用既有允许宿主 copy 的约定；行为依据 `skills/lorelum/`，host copy 的 fixtures 约束 query/get/recovery 语义。


omp 使用 `package.json.omp.extensions`，`omp.name` 为 `lorelum`，实际 Skill 放在常规 `skills/`，而不是假设 omp 能消费任意 `pi.skills` 指针。

`.omp-plugin/marketplace.json` 的关键片段：

```json
{
  "name": "lorelum-plugins",
  "owner": { "name": "Lorelum" },
  "plugins": [{
    "name": "lorelum",
    "source": "./plugins/omp/lorelum"
  }]
}
```

entry 与 package 的 version 同步，供宿主检测更新。omp selector 为宿主本地的 `lorelum@lorelum-plugins`。不能复制 Codex 的 `{source:"local",path:...}` 对象：omp 的相对目录 source 是字符串。不能只用现有 `.claude-plugin/marketplace.json`：omp 确实会读取它，但那会选择 Claude artifact，而非这里的 TypeScript adapter。

不使用双 manifest 包或运行时兼容探测：pi 支持不在本阶段内，单独的 omp package 即可满足分发与接口要求。

### 2. CLI 拥有一个 Catalog renderer，extension 只负责事件和消息

新增版本化 extension bridge：

```ts
// 拟定的 Lorelum CLI/extension 集成协议；不是宿主原生 Hook JSON。
type OmpHookRequest =
  | { event: "catalog"; agentKind?: "main" | "sub" }
  | { event: "shell"; sessionId: string; command: string }
  | { event: "read-hints"; sessionId: string };
type OmpHookResponse = { additionalContext?: string; command?: string };

// CLI 内部入口；省略日志选项，业务服务不暴露给插件。
runOmpHook(options: {
  stdin: TextInput;
  stdout: OutputWriter;
  stderr: OutputWriter;
  services?: CatalogServices;
  storeRoot?: string;
}): Promise<0>;
```

调用：`lore hook omp`，stdin 为 `{"event":"catalog"}`。成功返回 `{"additionalContext":"Lorelum Installed Pack Catalog\n..."}`；故障/不支持输入返回 `{}`，退出码 0，诊断只写 stderr。CLI 参数错误仍沿普通 CLI 用法错误处理。

这段 bridge 是私有集成 ABI，和 Codex `hookSpecificOutput`、Cursor `additional_context` 都不同。extension callback 本身不消费 stdin/stdout；宿主没有一个可照搬的 native JSON envelope。现有 [Hook requirement](./specs/agent-integration/spec.md) 因此明确只把原生 shell Hook 归入原始宿主 envelope。

CLI 从已有 list service 和 Store resolver 获取 Catalog，调用同一个 `renderPackCatalog`，保持去重、排序、字段与 4000 字符预算。`catalog-store.ts` 集中 Store 读取及默认服务，`pack-catalog.ts` 保持纯渲染；各宿主 adapter 只组装自己的响应。

`agentKind` 省略等同 `main`，保留旧调用语义。Main 始终取得 Catalog；extension 将子请求显式标为 `sub`。CLI 在 `agent-settings.ts` 沿既有配置 loader 约定独立读取 `~/.lorelum/config.yaml` 的布尔项 `agent.subagentPackCatalog`，默认 `false`；独立 loader 不使新设置的错误影响既有 shell-only 宿主。私有 omp service 可注入设置读取，不扩充通用 HostHookServices 或建立新配置框架。false 时在读取 Store 前返回正常 `{}`，true 时复用 renderer。extension 接受 `{}` 为禁用结果，不报警、不直接读取配置。缺失 Main 身份不妨碍显式开启的 Catalog，但不允许猜候选；`read-hints` 协议保持不变。

设置在下一次 sub Catalog bridge 调用读取，而不是每条模型请求重新读取。新子 Agent 或下一次会话/compact 刷新采用新值，同一生命周期普通请求复用快照；重新加载可触发刷新，无需重启 Backend。关闭开关不关闭已读摘要。

`src/hook/omp.ts` 拥有协议，沿用共享参数解析、Catalog 读取、shell 设置与候选 renderer。Backend 的 `hostKey` 增加 `omp`，复用现有记录服务；不改变 Engine 和 query/get 返回合同。

### 3. 生命周期只失效；首次模型请求刷新；每次请求临时注入

每个 extension 实例持有 Catalog 快照、刷新标记、进行中的读取与取消控制。生成号隔离失效前后的结果，消息身份集合只识别自己注入的消息，诊断标记限制重复提示；shutdown 关闭该实例，晚到的 callback 不再启动读取。没有文件状态、定时刷新或跨宿主 session registry。

| 边界 | omp 原生事件 | 行为 |
| --- | --- | --- |
| startup/reload/new/resume/fork | `session_start`；后续 `session_switch`，fork 也可能是 `session_branch` | 清除旧 Catalog，标记待刷新 |
| compact 完成 | `session_compact` | 标记待刷新，包括进行中任务的下一次请求 |
| tree/branch 导航 | `session_tree` / `session_branch` | 标记待刷新 |
| 每次模型请求 | `context` | 待刷新时调用一次 CLI；只把有用 Catalog 放进本次请求 |

事件失效是幂等赋值，所以 fork 连续触发两个通知也不会重复起 CLI。真正的读取推迟到 `context`，避免用户只打开宿主但没有任务时触发检索工作，也覆盖 compact 后继续原任务而没有新 `before_agent_start` 的情形。

刷新前移除旧值；成功只接受有界字符串，失败保持没有 Catalog，不将失败写成“无 Pack”。禁用的子 Catalog `{}` 是正常结果。一次刷新机会只启动一个 CLI subprocess；普通请求复用临时快照，失败也不逐请求重试。重新加载、切换或 compact 提供下一次刷新机会。Skill 不因子 Agent 缺少 Catalog 自动 `pack list` 或初始化目录；独立工程决策确需材料发现时仍允许按需发现。

直接在 `context` 结果中前置 user metadata 消息，不调用持久化消息 API。omp 把普通 custom message 转为 developer，因此不能用它承载 Pack description；既有 system prompt 和真实用户消息保持不变。

关键宿主接口示意，省略 subprocess 错误处理与其余生命周期注册：

```ts
// 使用 omp 原生 ExtensionAPI/AgentMessage 类型。
api.on("context", async (event, ctx) => {
  const catalog = await readCatalogIfInvalidated(ctx.cwd);
  if (!catalog) return;
  return { messages: [catalog.requestMessage, ...event.messages] };
});
```

`requestMessage` 使用 omp 原生 user message 类型，包含 Catalog text 和刷新时的 timestamp。原 transcript 不包含这条请求级消息，不按文本 marker 删除任何用户输入；如处理 handler 重入，只识别自己生成的消息对象，保留用户的同内容消息和其他 extension 消息。

选择 `context` 而非改 system prompt，不替换 omp policy。普通模型请求复用快照、不启动新 CLI；重放/恢复没有永久旧 Catalog，compact 后下一次请求自动补回。

### 4. subprocess 明确归属当前 cwd，不改变整个宿主的环境

omp runtime 支持 Node child_process；入口以 argv 运行 `lore hook omp`，`shell:false`、cwd 取 callback 的 `ctx.cwd`，通过 stdin 写请求，stdout 只作 JSON 解析。进程期限沿用现有 Hook 的 10 秒预算；到期终止这次 metadata 读取并让主任务继续。stderr 输出有界诊断，不把 Pack Catalog 或宿主账户配置写入日志。

omp 的公开 context callback 没有 AbortSignal。使用本 extension 自己的 AbortController，在生命周期失效和 shutdown 时终止旧 CLI 请求；不导入宿主私有取消实现，不调用 `ctx.abort()`。普通运行中用户取消的 subprocess 清理由 10 秒上限约束，不声称有未公开的即时取消通知。

Windows 按 CLI 的 `.cmd` 安装形态，通过系统 shell 启动固定 `lore.cmd hook omp`，JSON 只走 stdin；取消时终止 shim 进程树。该分支需独立实机验收，macOS 结果不构成 Windows 支持依据。

CLI 缺失、版本不支持、非零退出、JSON 损坏或超时均不阻塞原任务；交互界面提示一次“Lorelum Catalog 未注入；检查 CLI 并重新加载”，headless 写 stderr。子 Catalog 返回 `{}` 则正常保持禁用，不诊断。不会先探测 model/index、启动 Backend 或自动改 keyword。

### 5. 成功读取关联与子 Agent 已读候选

`tool_call` 只处理原生 `bash`。extension 把 `ctx.sessionManager.getSessionId()` 和本次 command 交给 `shell` bridge；CLI 按既有 `agent.shellSessionInjection` 设置判定是否改写，默认 `lore-only`，显式 `all-shell` 才覆盖全部 Bash。返回的 command 只给本次工具输入，保留其余参数，不返回 allow/block，不改变宿主审批。环境前缀使用 shell 引号，`LORELUM_HOST_KEY=omp`，会话 ID 不使用 Agent registry ID。macOS/Linux 用 POSIX shell；Windows 未经实机验收不声明支持。

成功 get 继续由 CLI 现有报告路径写入 `~/.lorelum/sessions/omp/<session-id>/practice-reads.jsonl`；失败 get 不产生候选。插件不发 get、post-tool 成功报告或直接读该文件。`read-hints` bridge 校验 session，再调用既有可选 Backend client 和 `renderReadHints`，不启动 Backend；没有候选返回 `{}`，故障降级且不阻塞任务。

task 与 eval 的实际子会话都会重新执行 extension factory；各自的 `api.events` 不共享。插件仅在模块内保留宿主身份关联：原生 `before_subagent_spawn.spawnKey` 在真实派发时对应 child registry ID；Main 派发捕获自己的 session，子 Agent 再派发则传递已领取的源头 Main session，而非替换为直接父 session。子会话在 `session_start` 用自己的 `ctx.agent.id` 领取快照，`ctx.agent.parentId` 仍核对直接父 Agent，不作为 session ID。这保留碰撞拒绝、生命周期清理和父会话切换后的快照隔离，所有嵌套层级始终取同一源头 Main 候选。

每个子 extension 在首次 `context` 调用通过不变的 `read-hints` bridge 获取一次源头 Main 的成功读取摘要，用原生 user metadata 消息临时加入请求。保留原始 prompt、system prompt、其他消息与候选警告；不持久写 transcript、不把完整 Pack 或 Practice 塞给子 Agent、不自动发模型 turn。子 Agent 自己成功 get 归自己的 session，不自动并入 Main。生命周期失效与 shutdown 取消读取、丢弃晚到结果，清理所属身份关联；compact 后可重新提供候选，不逐请求读取或重试失败。无 Main 身份、关联不明确、Backend 未运行、CLI 缺失或超时均不注入候选，不猜测其他会话。候选读取与 Catalog 配置独立，默认只有该摘要，显式 true 才额外取 Pack Catalog。

模块内关联只服务同一正常 omp 进程的真实 task/eval 链。若同一进程存在身份冲突，必须拒绝不明确的关联而不是覆盖另一父会话。它不是新 Backend registry、跨进程 RPC、全局环境或文件持久状态。

关键交接是 `catalog(agentKind?) → additionalContext?`、`shell(sessionId, command) → command?` 和 `read-hints(originMainSessionId) → additionalContext?`。extension 只编排原生生命周期、工具输入和请求消息；CLI 拥有设置、身份校验与 metadata 渲染；Backend 拥有读取候选存储。

## Risks / Trade-offs

- **宿主升级改变接口**：omp 原生类型检查与真实宿主 smoke 分开；兼容声明以实际验收版本为准。alias 存在不替代行为验收。
- **Catalog 同会话内的 Pack 变更有滞后**：这是会话快照，重新加载/compact 刷新；Skill 需要准确内容或 resource locator 时仍 query/get/pack list。不增加 watcher。
- **临时消息可能被其他 extension 过滤**：检验最终 provider 请求中可见性；不添加第二套持久注入，不把子 Agent 默认无 Catalog 当成自动补目录的理由。
- **Windows cmd bridge 差异**：独立实机验证，不由 macOS probe 推定。未通过的平台不声明已支持。

## Migration Plan

没有已有 omp Lorelum 用户状态需要迁移。按 CLI bridge、原生 artifact、实机验收顺序实现；集成负责人验证共享 renderer 与现有宿主回归一次，不重复已完成的有效检查。

插件指南要求 CLI 含对应 bridge；CLI 和插件分别升级，不自动安装/更新对方。卸载仅移除宿主 artifact 和 registration，不卸载 lore、不删除 Pack/Backend 数据。更新保持 marketplace 与 package version 一致；回滚使用宿主原生 uninstall 或先前版本，不引入兼容 shim。

验收清单见 [tasks.md](./tasks.md)。真实主 Agent 路径须包含 Catalog 可见、semantic query、完整 get、compact 与失败恢复。平台声明只覆盖已验证的平台；无法执行的平台分别记录，不将 macOS 验证推定为 Windows 验证。
