# Proposal: add-claude-code-host

## Why

Claude Code（Anthropic 的 agentic coding 工具，覆盖终端 CLI、VS Code/JetBrains 扩展、桌面应用与浏览器）是 issue lorelum/lorelum#233 立项的下一个宿主：当前 Claude Code 集成只有站点 `agent-setup` 页的手动复制 Skill 指引，没有 Plugin artifact、没有 marketplace 注册、没有 Installed Pack Catalog 注入。宿主契约已通过官方文档调研与本机实测确认（记录于 `.tmp/claude-plugin-compatibility.md`）：SessionStart 事件名、stdin JSON 输入与 `hookSpecificOutput.additionalContext` 输出 envelope 同本仓库 `lore hook` 现有 ABI 逐字同形（该 envelope 的源头即 Claude 契约），接入成本低于此前任何宿主；失败语义原生非阻塞，满足 issue 的 non-blocking 启动验收。

本变更引入新的产品行为（新宿主 Plugin 与 Catalog 注入），不是对既有行为的记录。

## What Changes

- 新增 hostKey `claude`：新增 `plugins/claude/lorelum/` 宿主 Plugin（`.claude-plugin/plugin.json` manifest、SessionStart Hook、宿主化 Skill 副本、图标与 README；不带 `commands/`）。
- CLI 新增 `lore hook claude` raw Hook ABI：扩展 `HostHookName` 封闭联合，新增 per-host 薄包装与集成场景测试；envelope 复用同一 `hookSpecificOutput` 语义与 `{"continue":true}` 降级契约。
- 仓库根新增 `.claude-plugin/marketplace.json`（Claude Code 原生 marketplace，名称 `lorelum-plugins`，含必填 `owner` 字段，仅含单一 `lorelum` 条目，entry version 与 manifest 一致）。
- 扩展 `plugins/scripts/plugin-layout.test.ts` 覆盖 claude 的身份/布局/版本一致性断言，并移除「`.claude-plugin/marketplace.json` 不存在」的过渡期守卫断言；更新 `plugins/README.md` 宿主表与 `docs/development/plugin-conventions.md`、`docs/development/plugins.md` 中 hostKey 枚举、Hook 命令理据与验证命令。
- 新增用户文档英中双语 `apps/site/content/docs/claude.mdx` / `claude.zh.mdx`（安装、首次使用、更新、移除、恢复），`agent-setup` 英中两页的 Claude Code 行由手动复制 Skill 改为 Plugin 安装，并更新导航 meta。
- **（评审扩展，Refs #254）按 `share-read-practice-hints` 已确立的共用 CLI/Backend 合同，为 Claude Code 接入会话已读 Practice 候选两环**：`Bash`/`PowerShell` 的 `PreToolUse` 经 `updatedInput` 前置注入 `LORELUM_HOST_KEY`/`LORELUM_HOST_SESSION_ID`（不带 `permissionDecision`，不改批准语义）；`SubagentStart` 注入有界候选提示。Backend `hostKeySchema` 枚举纳入 `claude`；`plugins/claude/lorelum/hooks/hooks.json` 增补两个事件条目；Claude Code 与 Codex 共同消费 `agent.shellSessionInjection`。

### 开放问题的决策（issue #233）

1. **Catalog adapter 条件成立**：SessionStart lifecycle Hook 存在、经验证非阻塞、envelope 同构 → 按 zcode/workbuddy 路径提供 Claude catalog adapter：有界、metadata-only 的 Installed Pack Catalog 注入，不自动执行 `lore query`/`lore get`。
2. **Hook 命令形态**：shell 字符串 `lore hook claude || lore.cmd hook claude`，`timeout: 10`。依据：Windows 安装器只把 `lore.cmd` shim 放上 PATH（release 内 `lore.exe` 不在 PATH）；Claude 的 exec form（`args` 数组）在 Windows 明确不能 spawn `.cmd`/`.bat`；shell form 在 Windows 走 Git Bash，本机实测裸 `lore` 不可解析而 `lore.cmd` 可执行，POSIX 侧首项命中真实符号链接后短路。不采用 codex 的 if/else 包装：Claude 原生将任何 Hook 失败降级为非阻塞提示（`continue:false` 在 SessionStart 上不被允许），CLI 内部 `{"continue":true}` 降级已覆盖运行期故障，`||` 仅兜「lore 无法启动」的残余场景并保留可见信号；`commandWindows`/`additionalContextLimit` 不是 Claude hooks schema 字段，不引入。
3. **matcher 含 `fork`**：`startup|resume|clear|compact|fork`。Claude 原生支持 `fork` 分叉会话，分叉同样丢失已注入上下文，与 `compact` 同理；Claude matcher 为精确 token 匹配，无需 WorkBuddy 式非锚定调整。
4. **`commands/` 不随带**：官方将 `commands/` 定位为旧形态（新插件用 `skills/`）；单入口 `/lorelum:lorelum` 已覆盖显式调用，随带 `/lorelum:lore` 会形成双入口。manifest 不写路径指针（`skills/`、`hooks/hooks.json` 按约定目录自动发现），也不写 `hooks` 字段（避免 Claude 系 schema 的 manifest 双路径陷阱）。
5. **marketplace 含 `owner` 字段**：Claude marketplace schema 必填 `owner`（`{"name": "Lorelum", "url": "https://lorelum.com"}`），是五份 registration 中唯一要求 owner 的宿主；安装时 manifest version 覆盖 entry version，仍按仓库纪律保持两者一致。
6. **（评审扩展）身份改写按工具名而非平台选择语法**：Claude Code 在 Windows 可能以 `PowerShell` 工具（而非 `Bash`）执行 shell 命令（无 Git Bash 时不注册 Bash 工具），matcher 取官方示例的精确 token 交替 `Bash|PowerShell`；`Bash` 恒用 Unix `export` 语法（Windows 上该工具经 Git Bash 执行），`PowerShell` 恒用 `$env:` 语法。这与 Codex 按平台选择的分歧源于两宿主工具集差异。
7. **（评审扩展）`updatedInput` 不携带 `permissionDecision`**：官方文档明确 `permissionDecision: "allow"` 会跳过权限确认，且宿主 deny/ask 规则无论如何仍被评估；仅返回 `updatedInput` 时宿主按改写后的输入走正常权限流。据此 Claude 的改写响应不带 decision，满足 #254「不改变原命令批准语义」的硬约束；真机验收若发现 `updatedInput` 必须搭配 decision 才生效，则按 #254 的后备顺序降级（公共会话窗口或漏记），不引入 `allow`。
8. **（评审扩展）PreToolUse/SubagentStart 的 Hook 命令采用 codex 式 if 包装**：这两个事件按每次工具调用/每次子 Agent 触发，CLI 缺失时裸命令会产生高频非阻塞报错噪音；包装在 CLI 不可用时输出 `{}` 静默失败开放。SessionStart 维持原有裸 `||` 形态不变（每会话一次，保留「CLI 未装」的可见信号，且已通过真机冒烟）。

## Capabilities

### New Capabilities

（无——本变更不引入新 capability，仅扩展现有宿主集成契约。）

### Modified Capabilities

- `agent-integration`: Catalog-aware targeted retrieval 增加 Claude Code 复用 Hook-injected Catalog 的场景；Host Hook ABI 的宿主联合类型纳入 `claude`，并增加 `lore hook claude` 的 envelope 与降级场景；新增「Claude Code 会话身份传递不改变原命令权限」与「Claude Code 子 Agent 获得可选候选提示」两条需求（对齐 `share-read-practice-hints` 的 Codex 侧需求范式）。
- `plugin-distribution`: Single public Plugin identity 的 hostKey 枚举纳入 Claude Code 侧（根 `.claude-plugin/marketplace.json`，`lorelum@lorelum-plugins`，版本一致性），宿主 registration 独立性扩至五份。

## Impact

- `packages/cli/src/hook/`：`host-hook.ts`（`HostHookName` 联合、`hostLabel`）、新增 `claude.ts` / `claude.test.ts`；`packages/cli/src/main.ts` 注册 raw Hook 分发与 `claudeHookServices` 覆盖项；`packages/cli/integration/scenarios/hook-claude.ts` 与 `process.integration.ts` 挂接。
- `packages/backend/src/modules/sessions/model.ts`：`hostKeySchema` 枚举追加 `"claude"`（会话候选目录边界 `~/.lorelum/sessions/claude/<原始 sessionId>/`），配套测试更新。
- `plugins/claude/lorelum/hooks/hooks.json`：增补 `PreToolUse`（matcher `Bash|PowerShell`）与 `SubagentStart` 条目；`plugins/claude/lorelum/scripts/hooks-config.test.ts` 扩展。
- `plugins/`：新增 `plugins/claude/lorelum/` 全套；`plugins/scripts/plugin-layout.test.ts`、`plugins/README.md`。
- 仓库根：新增 `.claude-plugin/marketplace.json`。
- 文档：`docs/development/plugin-conventions.md`、`docs/development/plugins.md`、`apps/site/content/docs/`（新增 2 页 + 2 个导航 meta + `agent-setup` 英中改写；`claude.mdx`/`claude.zh.mdx` 增补候选提示与 `agent.shellSessionInjection` 说明）。
- 无依赖变更；公开 CLI 命令面仅按既有 Hook ABI 模式追加 `hook claude`，不改动既有命令合同。
