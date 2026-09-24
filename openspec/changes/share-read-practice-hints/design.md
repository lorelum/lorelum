## Context

把这项能力做成 **跨 Agent host 可复用、best-effort 的“本会话已读 Practice 提示”**。宿主只把 Hook 字段映射到 CLI 内部事件；路由层仅接受 shell tool，其他 tool 自动跳过。Pre/Post 划出会话与时间窗口，`lore get` 在自己真正成功读取时记录 Practice；不从 AI 拼出的 shell 命令猜测执行了什么。第一阶段不做锁、epoch、数据库、通用 Agent memory、完整 Practice 注入，也不做 compact 后恢复。

本文件是 #214 的重新设计草案，尚未实现；#215、#216 原 Issue 的“只记录主 Agent”与“严格归属”条件比用户本轮确认的 best-effort 语义更强。本次 PR 只引用它们并说明差异，不误写成完全完成其原验收条件。

## Goals / Non-Goals

- 当前 Codex Plugin [仅配置 `SessionStart`](../../../plugins/codex/lorelum/hooks/hooks.json)，恢复 Pack Catalog；[Hook ABI](../../../packages/cli/src/hook/host-hook.ts) 仅接受启动事件，没有会话候选状态。
- [`lore get` 的成功路径](../../../packages/cli/src/get/get-command.ts) 已在 CLI 内拿到 Practice 的 ID、标题与 `applies_when`，无需改变默认输出或额外运行一次 `get`。
- Codex 官方 [Hooks 文档](https://developers.openai.com/codex/hooks) 说明 `PreToolUse`/`PostToolUse` 具有 `session_id`、`cwd`、`tool_use_id`，`SubagentStart` 的 Hook 使用父会话 ID。这里的 `cwd` 是会话目录；脚本内 `cd` 后实际执行 `lore get` 的目录由 CLI 进程取得。Hook 只能观察外层工具调用，无法单靠其命令文本可靠识别脚本内部的 `lore get`。

用户需要的是：主 Agent 正常检索、读取后，启动子 Agent 时自动给它 ID 和简短适用提示；不强迫 Agent 更换 CLI 调用写法。产品语义仍是“本会话观察到的已读候选”，不是强一致的父 Agent 已读清单。

## Decisions

### 一次完整运行

1. 宿主适配器把原生事件字段映射成 `{hostKey, event, sessionId, toolUseId, cwd, toolKind}`；通用路由仅在 `toolKind` 为 shell 时操作活动标记，非 shell 立即跳过。Codex 当前将 `tool_name: "Bash"` 映射为 shell，`PreToolUse` 留下 `session_id`、`tool_use_id`、会话 `cwd` 与开始时间。不能只筛选看起来包含 `lore` 的外层命令，因为 `lore get` 也可能藏在脚本里；Hook 不改写原命令。
2. 外层命令无论是 `lore get A`、`lore get A | ...`，还是 `sh script.sh`，实际执行到 `lore get` 且成功时，CLI 在成功路径取得 ID、content digest、title、`applies_when`、Pack 名称及 `process.cwd()`。它寻找当前时间内活动、工作目录对应同一工作区的标记，并把这条简短候选追加到匹配会话。多个 `get` 就各记一条；失败的 `get` 不记录。这里不依赖 stdout 的格式、是否被重定向，也不要求 `--json`。
3. 外层工具结束时，Codex `PostToolUse` 根据相同 `tool_use_id` 关闭活动标记。SubagentStart 通过同一个 `session_id` 读取会话候选，按 ID 去重并截取能放进预算的条目；提示写明“本会话曾读过，可能相关；需要时自行 `lore get <id>`”。空清单不注入。

小合同示意（内部接口，不作为公共 CLI 命令）：

```ts
type ReadHint = { id: string; digest: string; title: string; appliesWhen?: string; packs: string[] };
type ToolEvent = { hostKey: string; event: "pre" | "post"; sessionId: string; toolUseId: string; cwd: string; toolKind: "shell" | "other" };
routeToolEvent(event: ToolEvent): Promise<void>; // other: no-op
recordSuccessfulGet(cwd: string, hint: ReadHint): Promise<void>;
readRecentHints(hostKey: string, sessionId: string, maxCharacters: number): Promise<ReadHint[]>;
```

用轻量活动标记与每会话一份追加候选文件即可。执行目录是匹配线索：同一 worktree 下的子目录可归到其会话工作目录；时间限定标记只在 Pre 与 Post 之间有效。若同一路径多个窗口重叠，取开始时间最近的匹配窗口；可能误归属或漏记，这是提示用途可接受的限制，不为此引入锁、会话代次或复杂分配器。窗口标记短暂持有工作目录，本阶段会话文件不保存路径；未来若要按工作区查看，再另行设计存储和归属语义。文件只保存候选 ID、digest、title、适用条件和 Pack 名称，不存正文、用户 prompt、shell 命令或来源路径清单。候选文件解析时按 ID 去重、按注入预算截短。文件 I/O 异常不改变 `get` 返回结果或子 Agent 创建。状态位于 CLI 与 Hook 都可访问的用户私有临时目录，独立于 Pack Store；Codex 的常见 workspace-write sandbox 不允许 `get` 向用户主目录写候选，真实宿主试跑确认改为临时目录后能够记录。只读 sandbox 可能不允许写入，此时不产生提示。

## Risks / Trade-offs

- 路径加时间区间是近似关联，不是严格因果归属。通常一个 worktree 对应一个会话；同路径并行会话可能误归属或漏记，在脚本里切到别的工作区、Hook 漏触发等情况可能漏记。候选只用来提示下一次 `lore get`，不承载权限或任务决策。双语用户文档说明此限制。
- 同一 `session_id` 的子 Agent 自己读取后，后续子 Agent 也可能看到该候选。因此文案只称“本会话已读”，不承诺“仅主 Agent 已读”。
- `PostToolUse` 若未运行，活动标记可能暂留；统一执行的长命令也可能到后续 poll 才收到 Post。以简单的时间界限清理陈旧标记，不让它永久代表一个运行中的工具；因此超长脚本可能漏记。并行写入偶发漏记按提示缺失处理，不为此增加数据库或锁。
- Pre/Post 只覆盖 shell tool，即使该命令未运行 `lore`，因此每次都增加两个很短的 Hook 调用。其他 tool 路由层自动跳过。这是当前方案真实的性能代价，在一次宿主 smoke 中记录其量级；不为了省这点开销又退回靠文本猜测命令。
- 文件是小型临时提示，不承诺跨设备同步或永久保留；已有旧文件的清理按实际体量决定，不把迁移机制列为首版前置任务。

### 已讨论且不采纳的方案

| 方案 | 不采纳原因 |
| --- | --- |
| 在 `PostToolUse` 解析外层 shell 命令或 `tool_response`，仅识别直接 `lore get` | 管道、组合命令、脚本、输出重定向很常见；该方案会系统性漏掉真正执行的 `get`。 |
| 强制 Agent 用 `lore get --json` | 仅方便 Hook 解析输出，不解决嵌套 shell 脚本和重定向；还改变普通读取习惯。 |
| 在 `PreToolUse` 改写 Bash 命令注入会话环境变量 | 会改动实际命令输入，而且 Codex 的 `updatedInput` 与允许权限决定绑定；为提示功能承担的侵入性过大。 |
| 只凭 `cwd` 建一个全局“当前会话”文件 | 同一路径开多个对话时无法区分；Pre/Post 活动窗口能以很小成本增加时间线索。 |
| 第一版就建 SQLite、锁、epoch、全量恢复与一致性状态机 | 解决的是尚未观察到的边缘冲突；候选提示允许漏记，不值得让主功能延期。 |

手动把 Practice ID 附在委托消息里仍可作为 Hook 不可用时的退路，不是本方案的默认交接方式。

## Verification and rollout

实施时只做一次真实 Codex smoke：主 Agent 在普通命令与脚本中各执行一次 `lore get`，再启动子 Agent；确认 Pre/Post 活动窗口实际形成、CLI 成功读取落到相同会话、子 Agent 看得到 ID 与简短提示。`cwd` 从会话目录变成工作区子目录时也做一个简单样例，避免只验证根目录。Hook 不可用时按现有 Skill 主动读取并在委托消息里传 ID，不引入替代的会话猜测链路。

实现阶段只需覆盖一次成功 get、脚本内多次 get、没有匹配窗口时不写、去重/预算和一次真实子 Agent 可见性。#217 的 compact 后恢复、按工作区聚合、其他宿主适配，以及精细的生命周期管理均延后；需要新的真实使用理由再启动。
