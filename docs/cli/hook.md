# Host Hooks (Codex / Cursor / WorkBuddy / ZCode / Pi)

`lore hook codex`、`lore hook cursor`、`lore hook workbuddy`、`lore hook zcode` 与 `lore hook pi` 是 Lorelum CLI 与各宿主 Plugin 或 Extension 之间的版本化集成 ABI。它们从 stdin 读取宿主 Hook payload，并在 stdout 输出一行宿主 Hook envelope；它们不输出普通 Lorelum CLI JSON envelope。这些命令共享同一 Pack Catalog 检索与渲染实现（`packages/cli/src/hook/host-hook.ts` 与 `pack-catalog.ts`），仅命令名、宿主 envelope 形状、stderr 诊断前缀和宿主边界不同。

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook codex
printf '%s\n' '{"hook_event_name":"sessionStart"}' | lore hook cursor
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook workbuddy
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook zcode
printf '%s\n' '{"hook_event_name":"session_start"}' | lore hook pi
printf '%s\n' '{"hook_event_name":"session_compact"}' | lore hook pi
```

成功时，Codex、WorkBuddy 与 ZCode 的 stdout 是包含 `hookSpecificOutput.hookEventName` 和受限 `additionalContext` 的对象；Cursor 的 stdout 是单行 JSON 对象，顶层直接含字符串字段 `additional_context`，不使用 `hookSpecificOutput` 包装。Pi 的 stdout 是单行 `{ "additionalContext": "<Catalog>" }`：它是 Lorelum Pi Extension 与 CLI 之间的适配合同，由 Extension 显式解析后投影到 Pi API，不是 Pi 自带的 shell Hook response schema。Catalog 包含已安装 Pack 的名称、可选 description 和非空 `appliesTo`，不注入版本或 `packRoot`；它只是 Pack-level 的检索路由提示，不是完整 Practice 内容，也不包含 resource 文件清单或内容。需要按当前 Practice source 读取资源时，从 `lore get` 对应 Store source 获取可读 root；明确浏览一个 Pack 时用 `lore pack list <name>`。Store root 是可变的 `current` view，后续 mutation 后可能解析到新 bytes 或消失；ProjectContext 的 `project-layer-N` 是逻辑来源而非文件路径。不要推导 Store 内部路径。

每个命令以其宿主的原生生命周期事件提供 Pack Catalog：Codex、WorkBuddy 与 ZCode 为 `SessionStart`，Cursor 为 `sessionStart`，Pi 为 `session_start` 与成功压缩后的 `session_compact`；Codex、WorkBuddy 与 Cursor 另外处理各自的工具/子 Agent 事件（`PreToolUse`/`preToolUse`、`SubagentStart`/`subagentStart`、`PostToolUse`/`postToolUse`）以传递会话身份或注入已读候选提示，不支持或不适用的输入一律返回空对象 no-op。生命周期来源（例如 `compact`）由各宿主 Plugin 的 `hooks.json` matcher 或 Pi Extension 决定，CLI 不推断启动、恢复、清理或 compact 时机。它们不会主动 query/get Practice、启动 Backend、下载模型、构建 index 或修改 Store。

Hook payload 无效、事件不支持或 Store 读取失败时，命令会向 stderr 写诊断（前缀统一为 `lore hook <hostKey> degraded: `），并在 stdout 输出宿主的空 no-op：Codex、WorkBuddy、ZCode、Cursor 为单行

```json
{ "continue": true }
```

Pi 为单行 `{}`。这样宿主可以继续运行，不把 Lorelum 的本地问题当作会话阻塞。该 Hook 执行路径以退出码 `0` 返回；无效的 CLI 参数仍按普通 CLI 用法错误处理。

需要隔离 Store 时，使用全局选项：

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' \
  | lore hook zcode --store-root /absolute/path/to/isolated-store
printf '%s\n' '{"hook_event_name":"session_start"}' \
  | lore hook pi --store-root /absolute/path/to/isolated-store
```

## 共用的会话关联

`lore get` 成功后的候选报告由 CLI 发往已经运行的 Backend，Backend 负责把可关联的读取保存在通用会话目录；宿主 Hook 只映射事件、传递会话身份或读取有界候选提示。无法关联或 Backend 不可达时可漏记，`get` 的结果与退出码不变。Backend 的[公共会话模块](../../packages/backend/src/modules/sessions/README.md)拥有显式身份与活动窗口后备，不在某个宿主 Plugin 里另存清单。

`agent.shellSessionInjection` 是 Agent 共用的会话身份注入策略，不属于 Codex 协议。支持 shell 命令改写的宿主在调用对应 Hook 时读取它：默认 `lore-only` 只匹配外层命令文本中的独立 `lore` 字样，`all-shell` 涵盖该宿主每次有效的 shell tool 调用。它不解析脚本，也不控制非 shell tool、SessionStart Catalog 或子 Agent 提示；无效配置在消费它的 Hook 中以非阻塞 no-op 降级。没有对应 Hook 的宿主不会仅凭配置字段而改变行为。

## 宿主差异

- Codex Plugin 在 `hooks.json` 中内联调用 `lore hook codex`，并提供 PowerShell 的 `commandWindows` 变体与 `additionalContextLimit`。
- Codex 的 `PreToolUse` 只处理 `Bash` tool，保留其他输入字段，在符合共享策略时返回 `updatedInput` 与宿主要求的 `permissionDecision: "allow"`；macOS/Linux 使用 Unix `export`，原生 Windows PowerShell 使用 `$env:`。两种模式都仍启动 Codex Pre Hook 进程。Codex `SubagentStart` 根据同会话的 Backend 已读候选注入有界元数据，不自动读取正文；通用的候选存储和 CLI 成功 `get` 报告由 Backend/CLI 拥有，不是 Codex Hook 的私有状态。
- Cursor Plugin 以事件名 `sessionStart`（camelCase）与顶层 `additional_context` envelope 调用 `lore hook cursor`；宿主对该事件是 fire-and-forget，`{ "continue": true }` 降级输出为无害 no-op。Cursor 的 `preToolUse` 只处理 `Shell` tool（终端工具的宿主名），返回扁平 `updated_input` 字段（snake_case，非嵌套 `hookSpecificOutput`），不带 `permission` 决定；会话 ID 读取 `session_id` 并在缺失时回退 `conversation_id`。Windows 上 Hook 命令经 PowerShell 执行且 `lore.cmd` 可按名解析，命令保持裸 `lore hook cursor`，宿主默认 fail-open，无需输出过滤包装。Cursor 的 `subagentStart` 响应不支持注入 context，该事件不注册 Hook 并返回空 no-op。
- WorkBuddy Plugin 使用宿主原生 `command` 形式；其 hooks schema 没有 `commandWindows` 与 `additionalContextLimit` 字段（未知键被宿主剥离，不得携带）。其 `hooks.json` 由宿主自动发现，manifest 中的 `hooks` 字段反而是 inline 对象或精确文件路径语义，不得使用。WorkBuddy 对 SessionStart matcher 按 `RegExp(matcher).test(source)` 求值，声明非锚定列表 `startup|resume|clear|compact`。Windows 上 Hook 命令经 Git Bash 执行，命令携带 `|| lore.cmd` 回退。WorkBuddy 的 `PreToolUse` 只处理 `Bash` tool，全平台返回 Unix `export` 前缀的 `updatedInput`（其 Bash 工具在 Windows 上也走 Git Bash），且不带 `permissionDecision`——宿主的 `allow` 会绕过权限系统。WorkBuddy 派发 `SubagentStart` 但丢弃 Hook stdout，该事件不注册 Hook 并返回空 no-op。
- ZCode 不支持 `commandWindows` 与 `additionalContextLimit`；其 Plugin 使用宿主原生的 `process` Hook，以 argv 形式直接运行 `lore hook zcode`，不经过 shell、Git Bash 或平台包装脚本。上下文预算由 CLI 渲染器的 4000 字符上限保证，与 Codex 共享同一实现。ZCode 的 `PreToolUse` 只处理 `Bash` tool：全平台返回前置 Unix `export` 的 `updatedInput`（Bash tool 的执行 shell 由宿主自行解析并在会话上下文告知——Windows 上默认自动检测 Git Bash），并且不返回 `permissionDecision`——ZCode 会把 Hook 的 `allow` 决定应用为对原本需要用户确认的调用的放行，而 `updatedInput` 的应用不需要该字段。ZCode 的输出 schema 在所有事件上接受顶层 `continue`，旧 CLI 的降级 envelope 是无害 no-op，因此 Plugin 无需输出过滤包装。ZCode 没有子 Agent 启动事件：不注册 `SubagentStart` Hook，也不把 SessionStart Catalog 当作已读候选提示。
- Pi 由原生 Extension（而非 shell Hook 配置）调用 `lore hook pi`，事件名为 snake_case 的 `session_start` 与 `session_compact`，成功输出单行 `{ "additionalContext": "<Catalog>" }`，降级输出单行 `{}`；该 envelope 是 Lorelum Extension 与 CLI 的适配合同，不是 Pi 自带的 shell Hook response schema。Catalog 预算由共享渲染器的 4000 字符上限保证，与 Codex/ZCode 同一实现。Extension 以独立子进程调用 CLI（stdin 传固定 payload），不像其他宿主那样由宿主注入会话身份，也不参与 Session Tracking，不向 Backend 注册 host 枚举、不启动 Backend、不自动 query/get。
