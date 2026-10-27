# Host Hooks

`lore hook codex`、`lore hook cursor`、`lore hook workbuddy` 与 `lore hook zcode` 是 Lorelum CLI 与各宿主 Plugin 之间的版本化集成 ABI。它们从 stdin 读取宿主 Hook payload，并在 stdout 输出一行宿主 Hook envelope；它们不输出普通 Lorelum CLI JSON envelope。四个命令共享同一 Pack Catalog 读取与渲染实现（`packages/cli/src/hook/catalog-store.ts` 与 `pack-catalog.ts`），仅命令名、宿主 envelope 形状、stderr 诊断前缀和宿主边界不同。

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook codex
printf '%s\n' '{"hook_event_name":"sessionStart"}' | lore hook cursor
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook workbuddy
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook zcode
```

成功时，Codex、WorkBuddy 与 ZCode 的 stdout 是包含 `hookSpecificOutput.hookEventName` 和受限 `additionalContext` 的对象；Cursor 的 stdout 是单行 JSON 对象，顶层直接含字符串字段 `additional_context`，不使用 `hookSpecificOutput` 包装。Catalog 包含已安装 Pack 的名称、可选 description 和非空 `appliesTo`，不注入版本或 `packRoot`；它只是 Pack-level 的检索路由提示，不是完整 Practice 内容，也不包含 resource 文件清单或内容。需要按当前 Practice source 读取资源时，从 `lore get` 对应 Store source 获取可读 root；明确浏览一个 Pack 时用 `lore pack list <name>`。Store root 是可变的 `current` view，后续 mutation 后可能解析到新 bytes 或消失；ProjectContext 的 `project-layer-N` 是逻辑来源而非文件路径。不要推导 Store 内部路径。

每个命令通过宿主原生事件提供 Pack Catalog；具体触发时机由宿主决定，matcher 只过滤已经发生的事件，不会创造启动、恢复或 compact 事件。Claude Code、Codex、WorkBuddy 的 compact SessionStart 还会恢复本会话已读候选，见下节。ZCode 只在 startup/resume 执行 SessionStart；Cursor 不在 compact 后重跑 sessionStart。CLI 不自动 query/get Practice、启动 Backend、下载模型、构建 index 或修改 Store。

Hook payload 无效、事件不支持或 Store 读取失败时，命令会向 stderr 写诊断（前缀统一为 `lore hook <hostKey> degraded: `），并在 stdout 输出：

```json
{ "continue": true }
```

这样宿主可以继续运行，不把 Lorelum 的本地问题当作会话阻塞。该 Hook 执行路径以退出码 `0` 返回；无效的 CLI 参数仍按普通 CLI 用法错误处理。

需要隔离 Store 时，使用全局选项：

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | lore hook zcode --store-root /absolute/path/to/isolated-store
```

## Main compact 候选恢复

Claude Code、Codex、WorkBuddy 的 `SessionStart` 在 `source=compact` 且会话身份有效时，复用公共候选 reader/renderer 并在原 `hookSpecificOutput.additionalContext` 返回 Catalog 与候选。恢复正文总计最多 4000 字符，候选最多 1800，先为候选预留空间再用既有 Catalog renderer 裁剪目录；不切断候选 JSON 条目。无候选或候选读取故障保留完整预算的 Catalog，不启动 Backend。startup/resume/clear/fork 不新增 Main 候选，更新通知资格与时机不变。

ZCode、Cursor 没有 compact 后的上下文入口，不注册额外 Hook、不用其他事件伪装恢复；记录阅读仍可工作。各宿主功能边界见[用户功能对比](https://lorelum.com/zh/docs/agent-setup#宿主功能对比)。

## 自动版本提醒

原生 Codex、Claude Code、WorkBuddy、ZCode 的 `SessionStart` 若含有效 `session_id` 且 `source` 为 `startup` 或 `resume`，可在成功读取 Catalog 后调用本地 update sidecar。Cursor 的原生 `sessionStart` 沿用字符串 `session_id` 优先、否则 `conversation_id` 的身份规则。缺失身份、其他来源、compact 和所有工具/子 Agent Hook 保持原路径。sidecar 只读用户级状态并按需启动独立 worker，不能在 Hook 中等待发行网络。

已就绪的提醒作为 Catalog 之外的独立段落附到原宿主 context 字符串，不增加宿主未知 JSON 字段。Catalog 保留 4000 字符预算，提醒最多 400 字符，加分隔最多 4402 字符。更新配置/状态失败只略过提醒，不丢成功 Catalog，不增加 stderr 更新警告；Catalog 自身失败仍按原降级。该 ABI 不提供送达确认，不能据此声称人类已阅读。

## omp extension bridge

`lore hook omp` 供 omp 的 TypeScript extension 调用，接收 Lorelum bridge 请求而非宿主原生 Hook envelope：

```sh
printf '%s\n' '{"event":"catalog"}' | lore hook omp
```

成功 stdout 为单行 `{"additionalContext":"<Catalog>"}`。Catalog 复用共享检索与渲染，最多 4000 字符，字段和数据边界与上述 SessionStart Catalog 相同；不会自动 query/get 或启动模型/Backend。

Catalog 请求可带 `agentKind: "main" | "sub"`，省略保持 main 语义。主 Agent 始终有 Catalog；子请求显式传 `sub`，由 CLI 独立读取 `~/.lorelum/config.yaml` 的布尔项 `agent.subagentPackCatalog`（默认 false）。缺省/false 正常返回 `{}` 且不读取 Store，不是故障；true 复用既有 renderer，只额外提供 Pack 目录 metadata，不含完整 Pack 或 Practice 正文。extension 不直接读配置文件。下一次子 Agent Catalog bridge 调用读取设置；新子 Agent 或下一次会话/compact 刷新采用新值，同一生命周期普通请求仍复用快照，无需重启 Backend。开关不影响 read-hints。

明确 Main 的新建／恢复／实际会话切换刷新可发送 `{"event":"catalog","agentKind":"main","sessionId":"<实际会话 ID>","checkUpdates":true}`。CLI 只在主身份、有效 ID 与 true 都满足时访问自动 sidecar，可在既有 `additionalContext` 之外返回可选 `updateNotice` 字符串（最多 400 字符）。旧请求保持 Catalog-only，sub 或无效更新字段不触发更新，也不损害原本有效的 Catalog。extension 使用当前 Main 的 sessionManager ID，不使用子 Agent 来源 Main 的 ID；相同 ID 的 compact/tree/branch 刷新不获得新资格。

`updateNotice` 只在当前 generation 的一次自然模型请求中临时提供，不进入逐请求复用的 Catalog metadata 快照或持久 transcript；并发 context 只消费一次，失效/取消清空，晚到结果不注入其他会话。新 extension 的扩展 main 请求若收到 exit 0、合法单行精确 `{}`，最多一次退回旧 catalog 请求形状，兼容旧 CLI 的严格字段白名单；不将 `{}` 判定为确定旧版本。超时、取消、非零退出或畸形响应不回退，不逐模型请求重试。旧 extension 调用新 CLI 不会意外消费提醒。

坏 JSON、不支持 event 或 Store 读取失败时输出单行 `{}`，以退出码 0 结束，诊断写 stderr，前缀为 `lore hook omp degraded: `。有效空 Store 返回明确的空 Catalog，不把错误当作没有 Pack。非法 argv 保持普通 CLI 用法错误；`--store-root` 和 `--debug` 沿用既有参数规则。

extension 在启动、重新加载、会话切换、branch/tree 导航和 compact 完成后只使快照失效，下一次 `context` callback 读取一次；每次普通模型请求临时复用快照，不重复查询。Catalog 只加入当前请求的 user 消息，不写入 transcript。子进程有十秒期限，失效与 shutdown 取消旧请求。子 Agent 无 Catalog 不触发 Skill 自动 pack list；独立材料发现需求仍可按需处理。

Main 的前台或后台压缩提交后，extension 捕获当前实际 session ID，下一 context 并行读取 Catalog 与本会话 read-hints。后台摘要准备不触发恢复；普通请求复用快照，不写 transcript、不追加提示副本。再次 compact、会话切换或关闭沿用 generation/abort 隔离，丢弃旧读取的晚到结果。startup/resume 不新增 Main 候选。

另有两类请求，共用上述非阻塞失败与单行 JSON 规则：

- `{"event":"shell","sessionId":"<实际 omp session ID>","command":"lore get <id>"}`：按 `agent.shellSessionInjection` 返回 `{"command":"<带会话身份前缀的命令>"}`；不匹配或不适用时为 `{}`。默认只匹配外层文本中的独立 `lore`，`all-shell` 覆盖全部 Bash。保留工具其余输入与宿主审批；身份前缀仅属于该命令，不修改全局环境。
- `{"event":"read-hints","sessionId":"<目标 omp session ID>"}`：协议不变；子 Agent 传源头 Main ID，Main compact 恢复传自己的实际 ID。读取已有 Backend 候选，返回 `{"additionalContext":"<有界候选 metadata>"}`；无候选为 `{}`。复用 renderer 的 1800 字符预算与历史候选警告，不启动 Backend 或读取正文。

task/eval 的实际派发通过原生 child registry ID 交接源头 Main session；所有嵌套子 Agent 继承该 Main 身份，直接父 Agent 身份仅用于核对，不把 `parentId` 当 session ID，也不依赖共享事件总线。默认子 Agent 只有 Main 成功 get 的摘要；自身 get 仍归自身 session，不自动并入 Main。候选与 Catalog 开关独立。无可靠 Main 身份不得猜候选，但显式 true 时仍能取得 Catalog。并行、嵌套、会话切换、冲突与过期读取不得混入其他会话候选。

安装与用户操作见[omp 用户指南](https://lorelum.com/zh/docs/omp)，源码验收见[Plugin 开发指南](../development/plugins.md#omp-checkout-install)。

## 共用的会话关联

`lore get` 成功后的候选报告由 CLI 发往已经运行的 Backend，Backend 负责把可关联的读取保存在通用会话目录；宿主 Hook 只映射事件、传递会话身份或读取有界候选提示。无法关联或 Backend 不可达时可漏记，`get` 的结果与退出码不变。Backend 的[公共会话模块](../../packages/backend/src/modules/sessions/README.md)拥有显式身份与活动窗口后备，不在某个宿主 Plugin 里另存清单。

`agent.shellSessionInjection` 是 Agent 共用的会话身份注入策略，不属于 Codex 协议。支持 shell 命令改写的宿主在对应 Hook 或 extension bridge 调用时读取它：默认 `lore-only` 只匹配外层命令文本中的独立 `lore` 字样，`all-shell` 涵盖该宿主每次有效的 shell tool 调用。它不解析脚本，也不控制非 shell tool、Pack Catalog 或子 Agent 提示；无效配置在消费它的集成边界以非阻塞 no-op 降级。没有对应 adapter 的宿主不会仅凭配置字段而改变行为。

## 宿主差异

- Codex Plugin 在 `hooks.json` 中内联调用 `lore hook codex`，并提供 PowerShell 的 `commandWindows` 变体与 `additionalContextLimit`。
- Codex 的 `PreToolUse` 只处理 `Bash` tool，保留其他输入字段，在符合共享策略时返回 `updatedInput` 与宿主要求的 `permissionDecision: "allow"`；macOS/Linux 使用 Unix `export`，原生 Windows PowerShell 使用 `$env:`。两种模式都仍启动 Codex Pre Hook 进程。Codex `SubagentStart` 根据同会话的 Backend 已读候选注入有界元数据，不自动读取正文；通用的候选存储和 CLI 成功 `get` 报告由 Backend/CLI 拥有，不是 Codex Hook 的私有状态。
- Cursor Plugin 以事件名 `sessionStart`（camelCase）与顶层 `additional_context` envelope 调用 `lore hook cursor`；宿主对该事件是 fire-and-forget，`{ "continue": true }` 降级输出为无害 no-op。Cursor 的 `preToolUse` 只处理 `Shell` tool（终端工具的宿主名），返回扁平 `updated_input` 字段（snake_case，非嵌套 `hookSpecificOutput`），不带 `permission` 决定；会话 ID 读取 `session_id` 并在缺失时回退 `conversation_id`。Windows 上 Hook 命令经 PowerShell 执行且 `lore.cmd` 可按名解析，命令保持裸 `lore hook cursor`，宿主默认 fail-open，无需输出过滤包装。Cursor 的 `subagentStart` 响应不支持注入 context，该事件不注册 Hook 并返回空 no-op。
- WorkBuddy Plugin 使用宿主原生 `command` 形式；其 hooks schema 没有 `commandWindows` 与 `additionalContextLimit` 字段（未知键被宿主剥离，不得携带）。其 `hooks.json` 由宿主自动发现，manifest 中的 `hooks` 字段反而是 inline 对象或精确文件路径语义，不得使用。WorkBuddy 对 SessionStart matcher 按 `RegExp(matcher).test(source)` 求值，声明非锚定列表 `startup|resume|clear|compact`。Windows 上 Hook 命令经 Git Bash 执行，命令携带 `|| lore.cmd` 回退。WorkBuddy 的 `PreToolUse` 只处理 `Bash` tool，全平台返回 Unix `export` 前缀的 `updatedInput`（其 Bash 工具在 Windows 上也走 Git Bash），且不带 `permissionDecision`——宿主的 `allow` 会绕过权限系统。WorkBuddy 派发 `SubagentStart` 但丢弃 Hook stdout，该事件不注册 Hook 并返回空 no-op。
- ZCode 不支持 `commandWindows` 与 `additionalContextLimit`；其 Plugin 使用宿主原生的 `process` Hook，以 argv 形式直接运行 `lore hook zcode`，不经过 shell、Git Bash 或平台包装脚本。上下文预算由 CLI 渲染器的 4000 字符上限保证，与 Codex 共享同一实现。ZCode 的 `PreToolUse` 只处理 `Bash` tool：全平台返回前置 Unix `export` 的 `updatedInput`（Bash tool 的执行 shell 由宿主自行解析并在会话上下文告知——Windows 上默认自动检测 Git Bash），并且不返回 `permissionDecision`——ZCode 会把 Hook 的 `allow` 决定应用为对原本需要用户确认的调用的放行，而 `updatedInput` 的应用不需要该字段。ZCode 的输出 schema 在所有事件上接受顶层 `continue`，旧 CLI 的降级 envelope 是无害 no-op，因此 Plugin 无需输出过滤包装。ZCode 没有子 Agent 启动事件：不注册 `SubagentStart` Hook，也不把 SessionStart Catalog 当作已读候选提示。
- omp extension bridge 的 shell 请求按宿主 shell 语法加会话身份前缀：macOS/Linux 使用 Unix `export`，原生 Windows 使用 PowerShell 的 `$env:`（与 Codex 的单 Bash tool 规则一致）；Bash tool 在 Windows 经 Git Bash 执行的宿主（WorkBuddy、ZCode）则保持 Unix `export`。
