# Proposal: add-workbuddy-host

## Why

WorkBuddy（腾讯云代码助手团队的 AI Agent 办公工作台）的插件运行时与内嵌的 CodeBuddy Code CLI 同源（桌面端 5.5.6 内嵌 CLI 2.137.1，已实测），其插件 manifest、Hook envelope 与 SessionStart 事件语义和现有宿主同构，但 Lorelum 尚未提供 WorkBuddy 集成：WorkBuddy 用户无法获得 Installed Pack Catalog 注入，也没有按 Skill 指引走 `lore` 检索的入口。宿主契约已在 issue lorelum/lorelum#205 中通过静态分析与最小插件实测确认，接入成本低且可复用现有 codex/zcode 宿主结构，现在具备按"新增宿主六步"完成验证的落地条件。

## What Changes

- 新增 hostKey `workbuddy`：新增 `plugins/workbuddy/lorelum/` 宿主 Plugin（`.codebuddy-plugin/plugin.json` manifest、SessionStart Hook、宿主化 Skill 副本、`/lore` 命令、图标与 README）。
- CLI 新增 `lore hook workbuddy` raw Hook ABI：扩展 `HostHookName` 封闭联合，新增 per-host 薄包装与集成场景测试；envelope 复用同一 `hookSpecificOutput` 语义与 `{"continue":true}` 降级契约。
- 仓库根新增 `.codebuddy-plugin/marketplace.json`（WorkBuddy 原生 marketplace，名称 `lorelum-plugins`，仅含单一 `lorelum` 条目，entry version 与 manifest 一致）。
- 扩展 `plugins/scripts/plugin-layout.test.ts` 覆盖 workbuddy 的身份/布局/版本一致性断言；更新 `plugins/README.md` 宿主表与 `docs/development/plugin-conventions.md` 中 hostKey 枚举及宿主示例。
- 新增用户文档英中双语 `apps/site/content/docs/workbuddy.mdx` / `workbuddy.zh.mdx`（安装、首次使用、更新、排障）与站点 agent logo。

### 开放问题的决策（issue #205）

1. **Hook 命令形态**：照 codex 用 shell 字符串命令 + 失败 fallback 输出（含 `commandWindows` PowerShell 变体与 `additionalContextLimit`）。依据：WorkBuddy Hook 运行时与 CodeBuddy CLI 同源，`{"type":"command"}` 形态已被最小插件实测触发（Windows 桌面端），且内置插件（sheetagent）使用同型声明。
2. **`commands/` 是否首版携带**：携带 `/lore` 命令。依据：WorkBuddy 桌面端内置插件以 `"commands": "./commands"` 指针分发命令（既有先例），manifest 指针已实测被插件加载器接受；headless `-p` 模式不展开插件斜杠命令属已知模式差异，桌面端交互形态未逐项复核——若宿主忽略该组件则 Skill 仍完整可用，风险为惰性而非故障。
3. **marketplace 分发载体**：仓库根 `.codebuddy-plugin/marketplace.json`（目录型）。用户可将仓库克隆/检出目录作为 marketplace 添加（官方 CLI 安装流 `plugin marketplace add` + `plugin install` 已实测走通）；git 远端直连形态遵循同一份清单文件，其实际添加与更新检测作为发布后人工验证项记录，不阻塞本变更。
4. **manifest 目录名**：仅使用 `.codebuddy-plugin`，不做 `.workbuddy-plugin` 双清单。依据：运行时白名单 `PLUGINS_METADATA_DIRS` 三格式均可读，但写路径固定为 `.codebuddy-plugin`，且本地全部已装插件（含内置）均使用该格式。

## Capabilities

### New Capabilities

（无——本变更不引入新 capability，仅扩展现有宿主集成契约。）

### Modified Capabilities

- `agent-integration`: Catalog-aware targeted retrieval 增加 WorkBuddy 复用 Hook-injected Catalog 的场景；Host Hook ABI 增加 `lore hook workbuddy` 的 envelope 与降级场景，宿主联合类型纳入 `workbuddy`。
- `plugin-distribution`: Single public Plugin identity 的 hostKey 枚举与 marketplace 布局纳入 WorkBuddy 侧（根 `.codebuddy-plugin/marketplace.json`，`lorelum@lorelum-plugins`，版本一致性），并保持各宿主 registration 相互独立。

## Impact

- `packages/cli/src/hook/`：`host-hook.ts`（`HostHookName` 联合、`hostLabel`）、新增 `workbuddy.ts` / `workbuddy.test.ts`；`packages/cli/src/main.ts` 注册 raw Hook 分发；`packages/cli/integration/scenarios/hook-workbuddy.ts` 与 `process.integration.ts` 挂接。
- `plugins/`：新增 `plugins/workbuddy/lorelum/` 全套；`plugins/scripts/plugin-layout.test.ts`、`plugins/README.md`。
- 仓库根：新增 `.codebuddy-plugin/marketplace.json`。
- 文档：`docs/development/plugin-conventions.md`、`apps/site/content/docs/`（新增 2 页 + 2 个导航 meta）。
- 无依赖变更；公开 CLI 命令面仅按既有 Hook ABI 模式追加 `hook workbuddy`，不改动既有命令合同。
