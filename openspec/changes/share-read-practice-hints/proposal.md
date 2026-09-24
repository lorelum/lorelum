## Why

主 Agent 在任务中读过的 Practice，可能正好是子 Agent 的检索起点。现有 Codex 集成只注入 Installed Pack Catalog；子 Agent 不知道本次对话读过哪些 Practice。先做一个低成本、可丢失的自动提示，不把它升级成任务记忆、采纳记录或一致性系统。这是新产品行为，尚未实现或接受。

## What Changes

- 跨宿主的 CLI 侧提供候选记录和 shell-tool 路由：非 shell tool 直接跳过；宿主只映射事件、会话 ID、工具调用 ID、工作目录与 shell tool 名称。首个适配器是 Codex，`PreToolUse` 标记活动窗口，`PostToolUse` 关闭它；不解析 shell 命令，也不改写其输入。
- `lore get` 成功读到 Practice 时，用自身的实际执行目录和当前活动窗口尽可能归属会话，记录 ID、标题和适用条件。普通 `lore get` 不需要增加 `--json` 或其他参数；直接调用、管道与脚本使用同一条记录路径。
- Codex `SubagentStart` 从同一对话读取最近的候选项，去重并按预算注入短提示。子 Agent 认为相关时再自行 `lore get`，不自动读取正文。
- 第一版明确接受没有活动窗口时的漏记和同路径并行会话的有限误归属或漏记；子 Agent 的读取可能进入同一会话清单。提示称“本会话已读候选”，不称“父 Agent 采纳的 Practice”。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：在保持 CLI-first 和 metadata-only Hook 边界的同时，增加跨宿主候选记录与 shell-tool 路由，首个 Codex 适配器提供 `SubagentStart` 提示；其他宿主的 SessionStart Catalog 行为不变。

## Impact

预计涉及 `packages/cli/src/hook/`、`get` 成功读取路径、少量 CLI 内部候选文件逻辑，以及 `plugins/codex/lorelum/hooks/hooks.json` 和双语用户指南。候选状态不进入 Pack LocalStore、Engine 或 Plugin 私有实现；不增加数据库、daemon 或本地 MCP。本次同时实现 #214、#215、#216 的最小可用路径，但“只记录主 Agent、严格可靠归属”等原 Issue 条件改为 best-effort 语义，PR 明确写出差异而不冒称完全关闭 Issue；#217 的 compact 恢复不在本次范围。
