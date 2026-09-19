# Add Cursor host integration

## Why

Cursor 目前没有 Lorelum 官方 Plugin：README 只提供「Project Lorelum Skill」，没有 marketplace 注册、没有 SessionStart Hook，也没有站点安装页。Cursor 用户拿不到 Installed Pack Catalog 注入，只能手动复制 `skills/lorelum/` 并回落到 generic Skill 的「自行 list 一次」路径，与 codex/zcode 用户体验不一致。

对 Cursor 官方文档的契约调研（记录于 issue #208 与本机调研材料）确认：Cursor Plugins（`.cursor-plugin/plugin.json`）可以承载 skills、commands 与 hooks，能实现与 codex/zcode 同级的集成；同时 Hook envelope 与事件名和现有宿主不同，需要一条宿主专属 ABI 分支。

本变更新增受支持宿主 `cursor`，记录既有行为（CLI-first、Catalog metadata-only、失败降级）不变。

## What Changes

- 新增 hostKey `cursor`：source root `plugins/cursor/lorelum/`，仓库根 `.cursor-plugin/marketplace.json` 注册，marketplace 名称 `lorelum-plugins`、selector `lorelum@lorelum-plugins`（host-local）。
- 新增 `lore hook cursor` raw Hook ABI：接受 Cursor `sessionStart` 事件（camelCase），输出 Cursor 顶层 `{ "additional_context": ... }` envelope（不同于 codex/zcode 的 `hookSpecificOutput.additionalContext`）；任何输入、CLI 或 Store 故障降级为不阻塞会话的输出、退出码 0、诊断写 stderr。
- 在 `agent-integration` 中为 Cursor 写明 sessionStart 注入时机不可靠时的条件分支语义：Hook 已注入可用 Catalog 时 MUST 复用；Catalog 缺失或不可见时 Skill MUST 为当前任务执行一次 `lore pack list --details`（不得把 Cursor 归入「已注入、禁止重新 list」场景）。
- 新增 Cursor Plugin artifact：`.cursor-plugin/plugin.json`、`hooks/hooks.json`（`sessionStart`、PATH 裸 `lore`）、宿主化 `skills/lorelum/` 副本、`commands/lore.md`、配置测试。
- 新增中英文用户文档（安装、首次验证、更新、排障）与维护者宿主表更新；分发为双轨：公开 Cursor Marketplace 提交材料与仓库本地安装说明并行。

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `agent-integration`：将 Cursor 纳入受支持宿主；新增 Cursor sessionStart Hook ABI envelope、失败降级与 Catalog 注入条件分支场景；既有 CLI-first、Catalog metadata-only、No local MCP 边界不变。
- `plugin-distribution`：将 `hostKey` 枚举扩展为 `codex`、`zcode`、`cursor`；定义 Cursor 原生 marketplace 注册路径、版本一致性与三宿主注册相互独立要求。

## Impact

- 受影响：`packages/cli/src/hook/`（新 `cursor.ts`、`host-hook.ts` 扩展、`main.ts` 分派、`index.ts` 导出）、`plugins/cursor/lorelum/`（新增）、仓库根 `.cursor-plugin/marketplace.json`（新增）、`plugins/scripts/plugin-layout.test.ts`、站点 `cursor.mdx`/`cursor.zh.mdx` 与 `agent-setup` 中英文页、`meta.json` 导航、README 中英文宿主表、`docs/development/plugin-conventions.md`、`plugins/README.md`。
- 不改变：`lore` 查询/Store 语义、现有 Codex/ZCode 的 Plugin ID、selector、Hook envelope 与 ABI、CLI-first/no-local-MCP 边界、`packages/mcp` 非产品定位。
- 已确认决策（issue #208）：①带 SessionStart Hook 的完整 Plugin；②Hook 命令为 PATH 裸 `lore`，不随插件携带脚本；③分发双轨。公开 marketplace 提交动作本身是人工步骤，不在本变更的自动化交付物内。
