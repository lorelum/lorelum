# Design: add-cursor-host-integration

## Context

issue #208 记录了对 Cursor 官方文档的契约调研与本机 Windows 环境证据。与实现直接相关的观测事实：

- Cursor 加载两种 Plugin 格式；开放标准 Agent Plugins（根 `plugin.json`）只承载 skills 与 MCP servers，无法承载 hooks。Cursor Plugin（`.cursor-plugin/plugin.json`）承载 skills、commands、rules、agents、hooks、mcp、variables。产品边界禁止本地 MCP，因此只能选 Cursor Plugin 格式。
- Cursor `sessionStart` Hook：stdin 事件名为 `hook_event_name: "sessionStart"`（camelCase；官方 `workspaceOpen` 示例证明 `hook_event_name` 值与 `hooks.json` 键逐字一致）；输出契约是顶层 `{ "env": ..., "additional_context": ... }`，`additional_context` 进入会话初始 system context。该 hook 为 fire-and-forget：agent loop 不等待，`continue: false` 也不阻塞会话创建；schema 接受 `continue`/`user_message` 但调用方不强制。
- Plugin hooks 从 `hooks/hooks.json` 发现；per-script 选项为 `command`/`type`/`timeout`/`loop_limit`/`failClosed`/`matcher`，全局 `version` 在 Configuration 一节列为必填（用 `1`），但 Plugins reference 的 plugin hook 示例省略了它。
- 多插件仓库注册文件为仓库根 `.cursor-plugin/marketplace.json`；解析时先找 `<source>/.cursor-plugin/plugin.json`，与 entry 合并且 manifest 优先。
- 本机 Windows 证据：`lore.cmd` shim 在用户 PATH，cmd/PowerShell 可解析；Git Bash 裸 `lore` 不可解析。Cursor 在 Windows 如何执行 hook `command` 字符串未文档化。

现有实现（改动点的 current source）：

- `packages/cli/src/hook/host-hook.ts:14` — `HostHookName = "codex" | "zcode"`。
- `packages/cli/src/hook/host-hook.ts:16,121` — `HostHookEvent = "SessionStart"`，`createHostHookResponse` 以 `input.hook_event_name !== "SessionStart"` 判事件。
- `packages/cli/src/hook/host-hook.ts:22-28,129-147` — `HostHookResponse` 只有 `hookSpecificOutput` + `continue`，`buildHostHookResponse` 输出 Claude 风格 envelope。
- `packages/cli/src/hook/codex.ts`、`packages/cli/src/hook/zcode.ts` — 同构薄包装；`main.ts` 按 host 分派。
- `plugins/zcode/lorelum/hooks/hooks.json` — `type: "process"` + `command: "lore"` + `args`，PATH 依赖。
- `plugins/codex/lorelum/hooks/hooks.json` — command 字符串 + `commandWindows`，PATH 依赖，外层失败降级包装。
- `plugins/scripts/plugin-layout.test.ts` — 断言产品 ID、source root 形状、ZCode 版本一致、`.claude-plugin/marketplace.json` 不存在。

## Goals / Non-Goals

**Goals:**

- 新增 `cursor` 宿主：CLI Hook ABI、Plugin artifact、仓库根注册、配置测试，全部落在 `plugins/<hostKey>/lorelum/` 既有边界内。
- Cursor envelope 与事件名成为 per-host 翻译的一部分，codex/zcode 行为零变化。
- 把 Cursor sessionStart 的注入时机不确定性写进 spec：可见才复用，缺失则按 generic 路径 list 一次。

**Non-Goals:**

- 不引入任何 MCP 面、stdio transport、MCP tools；不使用 Cursor 的 `mcpServers` 与 variables。
- 不让插件携带可执行脚本；不使用 `${CURSOR_PLUGIN_ROOT}`。
- 不实现公开 Cursor Marketplace 的提交动作（人工步骤）；本变更只交付双轨所需的仓库内材料。
- 不合并三宿主的 hooks/manifest 为可移植协议；不新增 rules/agents 等未使用的 Cursor 组件。

## Decisions

### 1. 格式取 Cursor Plugin，manifest 放 `.cursor-plugin/plugin.json`

Agent Plugins 标准无 hooks 能力；补齐 Hook 只能引入 MCP，与 No local MCP 边界冲突。Cursor Plugin 格式只需 `name`，其余字段与现有宿主 manifest 同型（`version`、`description`、`license`、`repository`、`keywords`）。

### 2. CLI 侧：per-host 事件名与 envelope 分支，共享核心保持单一

`HostHookName` 扩为 `"codex" | "zcode" | "cursor"`。共享核心改为按 host 解析两件事：

- 支持的事件字面量：codex/zcode 为 `"SessionStart"`，cursor 为 `"sessionStart"`；不匹配即按现有「不支持事件」路径抛错降级。
- 响应形状：codex/zcode 输出 `{ hookSpecificOutput: { hookEventName, additionalContext } }`；cursor 输出 `{ additional_context: <catalog> }`（顶层，不使用 `hookSpecificOutput`，不输出 `env`——Lorelum 不需要会话级环境变量）。

`cursor.ts` 作为第三份同构薄包装（parse/run/createResponse/buildResponse），`main.ts` 增加分派，`index.ts` 导出。Catalog 渲染继续复用 `renderPackCatalog`。降级输出统一保持单行 `{"continue":true}` + 退出码 0 + 诊断在 stderr：该输出对 codex/zcode 是既有契约，对 Cursor 是 schema 接受且无副作用的 no-op（fire-and-forget），三宿主降级纪律保持一致，便于测试与审计。

### 3. Hook 命令：PATH 裸 `lore`，无插件内脚本

`hooks.json` 写 `"command": "lore hook cursor"`（单字段 shell 字符串；Cursor 无 `commandWindows` 等价字段）。依据决策 ②：codex/zcode 均为 PATH 裸名依赖，插件目录不携带运行时脚本。不加 Codex 式防御包装：Cursor `failClosed` 默认 `false` 且 `sessionStart` 为 fire-and-forget，`lore` 缺失时 hook 失败为无害事件；是否补包装以 Windows 真机实测结论为准（见 Deferred）。`hooks.json` 含全局 `"version": 1`，由配置测试断言，以锁定对「Configuration 必填 vs reference 示例省略」矛盾的选择。

### 4. Skill：Cursor 版本文案按「可见才复用」翻译

`skills/lorelum/SKILL.md` 副本把「ZCode 收到 SessionStart Hook 注入的 Catalog」改写为条件语义：上下文可见则复用、不可见则按 generic 路径执行一次 `lore pack list --details`。其余检索纪律（semantic-first、recovery、keyword 仅显式、lease、resource 解析）与 fixture 场景保持一致。`commands/lore.md` 保留 `/lore` 入口；`$ARGUMENTS` 替换未验证，文件内注明依据，若真机确认不可用则后续移除（人工验收项）。

### 5. 注册：仓库根 `.cursor-plugin/marketplace.json`，entry version 与 manifest 锁定

`name: "lorelum-plugins"`、单一 `lorelum` 条目、`source: "./plugins/cursor/lorelum"`、entry `version` === manifest `version`。与 ZCode 根 `marketplace.json`、Codex `.agents/plugins/marketplace.json` 相互独立；`plugins/scripts/plugin-layout.test.ts` 扩展三宿主断言（含「任一 registration 不得声明其他宿主 artifact」）。

## Risks / Trade-offs

- [Cursor 对 `command` 的 Windows 执行方式未文档化] → 裸 `lore` 在 cmd/PowerShell 下解析为 `lore.cmd`，经 shell 即可用；若 Cursor 绕过 shell 直接 CreateProcess 则失败。以人工验收项收口，失败时的补救（`.cmd` 包装或宿主侧 fallback 输出）不改变本变更的 spec 契约，只改 `hooks.json` 一个字段。
- [`sessionStart` 注入时机不可靠] → 已用条件分支语义消解：Skill 对「可见」做判定而不是假定；最坏情况是首次检索多一次 `lore pack list --details`，属可接受成本。
- [`{"continue":true}` 对 Cursor 是未强制字段] → 文档明确它是 no-op；不依赖它表达任何语义。
- [双 registration 版本漂移] → 配置测试同时读 manifest 与 marketplace entry 并断言相等。

## Migration Plan

1. OpenSpec change 评审通过后，按 tasks.md 顺序实施：CLI ABI → artifact 与注册 → 文档。
2. 全程不触碰 codex/zcode artifact 内容与其 Hook 响应形状；`plugin-layout.test.ts` 旧断言原样保留。
3. 真机验证（Windows/Cursor 桌面端）作为人工验收清单随 PR 交接；PR 说明必须单列「待人工验收」，不宣称已完成。

## Deferred

- 公开 Cursor Marketplace 的实际提交与审核跟进（人工；仓库内先交付本地安装说明与提交所需材料清单）。
- `commands/lore.md` 的 `$ARGUMENTS`、Cursor CLI 对 plugin hooks/skills 的支持、Windows `command` 执行方式：均列入人工验收清单，结论不影响本变更的 spec 契约。
- Codex 式宿主侧防御包装：待 Windows 实测后决定，改动面为 `hooks.json` 单字段。
