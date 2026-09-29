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

## 宿主差异

- Codex Plugin 在 `hooks.json` 中内联调用 `lore hook codex`，并提供 PowerShell 的 `commandWindows` 变体与 `additionalContextLimit`。
- Codex 的 `PreToolUse` 只处理 `Bash` tool。CLI 在每次调用时读取用户级 `codex.shellSessionInjection`；缺省 `lore-only` 只对 `tool_input.command` 中出现独立 `lore` 字样的文本返回 `updatedInput`，显式 `all-shell` 对每次有效的 Bash 调用返回改写。这里不解析 shell 或脚本文件；无效配置返回非阻塞 no-op，`SessionStart` 与 `SubagentStart` 不受此设置影响。两种模式都仍启动 Pre Hook 进程。
- Cursor Plugin 以事件名 `sessionStart`（camelCase）与顶层 `additional_context` envelope 调用 `lore hook cursor`；宿主对该事件是 fire-and-forget，`{ "continue": true }` 降级输出为无害 no-op。
- WorkBuddy Plugin 与 Codex 同型：`command` 字符串 + `commandWindows` PowerShell 变体 + fallback + `additionalContextLimit`；其 `hooks.json` 由宿主自动发现，manifest 中的 `hooks` 字段反而是 inline 对象或精确文件路径语义，不得使用。WorkBuddy 对 SessionStart matcher 按 `|` 切分后逐 token 精确匹配，matcher 必须使用非锚定列表形式。
- ZCode 不支持 `commandWindows` 与 `additionalContextLimit`；其 Plugin 使用宿主原生的 `process` Hook，以 argv 形式直接运行 `lore hook zcode`，不经过 shell、Git Bash 或平台包装脚本。上下文预算由 CLI 渲染器的 4000 字符上限保证，与 Codex 共享同一实现。
