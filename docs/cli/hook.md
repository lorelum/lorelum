# Host Hooks (Codex / Cursor / WorkBuddy / ZCode)

`lore hook codex`、`lore hook cursor`、`lore hook workbuddy` 与 `lore hook zcode` 是 Lorelum CLI 与各宿主 Plugin 之间的版本化集成 ABI。它们从 stdin 读取宿主 Hook payload，并在 stdout 输出一行宿主 Hook envelope；它们不输出普通 Lorelum CLI JSON envelope。四个命令共享同一 Pack Catalog 检索与渲染实现（`packages/cli/src/hook/host-hook.ts` 与 `pack-catalog.ts`），仅命令名、宿主 envelope 形状、stderr 诊断前缀和宿主边界不同。

```sh
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook codex
printf '%s\n' '{"hook_event_name":"sessionStart"}' | lore hook cursor
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook workbuddy
printf '%s\n' '{"hook_event_name":"SessionStart"}' | lore hook zcode
```

成功时，Codex、WorkBuddy 与 ZCode 的 stdout 是包含 `hookSpecificOutput.hookEventName` 和受限 `additionalContext` 的对象；Cursor 的 stdout 是单行 JSON 对象，顶层直接含字符串字段 `additional_context`，不使用 `hookSpecificOutput` 包装。Catalog 包含已安装 Pack 的名称、版本、可选 description、`appliesTo` 与当前 `packRoot`；它只是 Pack-level 的检索路由提示，不是完整 Practice 内容，也不包含 resource 文件清单或内容。`packRoot` 是可直接读取的 `current` view，而不是内部 digest 路径；后续 mutation 后它可能解析到新 bytes 或消失。需要按当前 source 使用资源时运行 `lore get` 或 `lore pack list` 刷新，不要推导 Store 内部路径。

每个命令只支持其宿主的原生启动事件：Codex、WorkBuddy 与 ZCode 为 `SessionStart`，Cursor 为 `sessionStart`。生命周期来源（例如 `compact`）由各宿主 Plugin 的 `hooks.json` matcher 决定，CLI 不推断启动、恢复、清理或 compact 时机。它们不会主动 query/get Practice、启动 Backend、下载模型、构建 index 或修改 Store。

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

## 共用的会话关联

`lore get` 成功后的候选报告由 CLI 发往已经运行的 Backend，Backend 负责把可关联的读取保存在通用会话目录；宿主 Hook 只映射事件、传递会话身份或读取有界候选提示。无法关联或 Backend 不可达时可漏记，`get` 的结果与退出码不变。Backend 的[公共会话模块](../../packages/backend/src/modules/sessions/README.md)拥有显式身份与活动窗口后备，不在某个宿主 Plugin 里另存清单。

`agent.shellSessionInjection` 是 Agent 共用的会话身份注入策略，不属于 Codex 协议。支持 shell 命令改写的宿主在调用对应 Hook 时读取它：默认 `lore-only` 只匹配外层命令文本中的独立 `lore` 字样，`all-shell` 涵盖该宿主每次有效的 shell tool 调用。它不解析脚本，也不控制非 shell tool、SessionStart Catalog 或子 Agent 提示；无效配置在消费它的 Hook 中以非阻塞 no-op 降级。目前只有 Codex 实现了这条改写路径，其他宿主不因共用配置存在而改变行为。

## 宿主差异

- Codex Plugin 在 `hooks.json` 中内联调用 `lore hook codex`，并提供 PowerShell 的 `commandWindows` 变体与 `additionalContextLimit`。
- Codex 的 `PreToolUse` 只处理 `Bash` tool，保留其他输入字段，在符合共享策略时返回 `updatedInput` 与宿主要求的 `permissionDecision: "allow"`；macOS/Linux 使用 Unix `export`，原生 Windows PowerShell 使用 `$env:`。两种模式都仍启动 Codex Pre Hook 进程。Codex `SubagentStart` 根据同会话的 Backend 已读候选注入有界元数据，不自动读取正文；通用的候选存储和 CLI 成功 `get` 报告由 Backend/CLI 拥有，不是 Codex Hook 的私有状态。
- Cursor Plugin 以事件名 `sessionStart`（camelCase）与顶层 `additional_context` envelope 调用 `lore hook cursor`；宿主对该事件是 fire-and-forget，`{ "continue": true }` 降级输出为无害 no-op。
- WorkBuddy Plugin 与 Codex 同型：`command` 字符串 + `commandWindows` PowerShell 变体 + fallback + `additionalContextLimit`；其 `hooks.json` 由宿主自动发现，manifest 中的 `hooks` 字段反而是 inline 对象或精确文件路径语义，不得使用。WorkBuddy 对 SessionStart matcher 按 `|` 切分后逐 token 精确匹配，matcher 必须使用非锚定列表形式。
- ZCode 不支持 `commandWindows` 与 `additionalContextLimit`；其 Plugin 使用宿主原生的 `process` Hook，以 argv 形式直接运行 `lore hook zcode`，不经过 shell、Git Bash 或平台包装脚本。上下文预算由 CLI 渲染器的 4000 字符上限保证，与 Codex 共享同一实现。
