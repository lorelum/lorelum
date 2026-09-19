# Design: add-workbuddy-host

## Context

WorkBuddy 桌面端（Windows/macOS）内嵌 CodeBuddy Code CLI 作为 agent 运行时，插件体系与其完全同源：manifest 目录白名单为 `.codebuddy-plugin` / `.workbuddy-plugin` / `.claude-plugin`（写路径固定 `.codebuddy-plugin`），Hook 事件集为 Claude Code 超集，Hook stdout envelope 解析为 Claude Code schema（顶层 `continue/stopReason/suppressOutput/systemMessage` + `hookSpecificOutput.additionalContext` 等）。以上均已在 issue #205 中静态分析与最小插件实测确认。仓库内 codex 宿主使用 command 字符串型 Hook（含 Windows PowerShell 变体），zcode 宿主使用 `process` 型 Hook；WorkBuddy Hook schema 与 codex 同型（`{"type":"command","command":...,"timeout":N}`），且环境变量 `CODEBUDDY_PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` 双注入。

CLI 侧 raw Hook ABI 已按宿主参数化（`host-hook.ts` 的 `parseHostHookInvocation` / `runHostHook` 以 `HostHookName` 分派），新增宿主是封闭联合的扩展而非新机制。

## Goals / Non-Goals

**Goals:**

- WorkBuddy 用户获得与 codex/zcode 一致的体验：SessionStart 注入 metadata-only Catalog，Skill 指引 `lore` 检索，`/lore` 为显式入口。
- CLI 侧 `lore hook workbuddy` 复用同一 Catalog 检索/渲染语义与降级契约，行为与其他宿主逐字对齐。
- marketplace、layout 测试、维护者与用户文档全部落位，宿主 registration 相互独立。

**Non-Goals:**

- 不引入本地 MCP/stdio 面；不使用 WorkBuddy 的 SkillHub / open.workbuddy.cn 商店通道。
- 不实现 git 远端 marketplace 的自动更新检测验证（作为发布后人工验证项）。
- 不改动既有 codex/zcode 宿主的 artifact 与合同。

## Decisions

1. **Hook 配置镜像 codex 形态**（command 字符串 + `commandWindows` PowerShell 变体 + fallback `{"continue":true}` + `additionalContextLimit`）。备选是 zcode 的 `process` 型——但 WorkBuddy Hook schema 只接受 codex 型字段（`type/process` 非其事件 schema），且实测 `command` 型已在 Windows 桌面端触发。matcher 采用非锚定列表 `startup|resume|clear|compact`——WorkBuddy 对 SessionStart matcher 的解析是按 `|` 切分后逐 token 精确匹配，锚定正则形式在真机（5.5.6）上永不匹配（实测）；codex/zcode 的事件集合保持不变。
2. **`HostHookName` 追加 `"workbuddy"`**，`hostLabel` 返回 `"Workbuddy"`；诊断前缀遵循既有 `lore hook <host> degraded:` 模式。薄包装 `workbuddy.ts` 与 `codex.ts`/`zcode.ts` 同构，仅宿主常量不同。
3. **manifest 使用 `.codebuddy-plugin/plugin.json`**，字段沿用实测被接受的最小集：`name/version/description/author/homepage/license/repository/keywords` + `commands`/`skills` 指针；Hook 声明仅保留 `hooks/hooks.json` 自动发现路径（manifest 内不写 `hooks` 字段——Claude 系 schema 的 `hooks` 字段语义是"内联对象或精确文件路径"，WorkBuddy 会自动加载插件的 `hooks/hooks.json`，与 ZCode 的自动发现陷阱同理，避免双路径）。备选的字段集（`interface` 块等）为 codex 专有 UI 扩展，无证据表明 WorkBuddy 消费，故不引入。
4. **marketplace 注册**：仓库根 `.codebuddy-plugin/marketplace.json`，`{name:"lorelum-plugins", plugins:[{name:"lorelum", source:"./plugins/workbuddy/lorelum", version 与 manifest 一致, ...}]}`，与 zcode 根 `marketplace.json` 同角色同版本纪律。三份 registration（Codex/WorkBuddy/ZCode）互不引用对方 artifact。
5. **Skill 宿主化副本**以 zcode 版为底（含 injected Catalog 假设），宿主名词替换为 WorkBuddy；须通过 `docs/development/skill-guidance-fixtures.md` 的全部场景。`references/semantic-query-recovery.md` 按 zcode 版派生（标题与措辞随宿主调整）。`commands/lore.md` 直接复用 zcode 版内容（front-matter 的 `skills: lorelum` 引用与宿主无关）。
6. **版本纪律**：manifest、marketplace entry、`plugin-layout.test.ts` 断言统一为当前 release 版本 `0.1.0-alpha.3`（与 codex/zcode 同步演进）。

## Risks / Trade-offs

- [WorkBuddy 桌面端对 `commandWindows` PowerShell 变体的实际选择未逐项实测] → `command`（POSIX 串）单字段已被实测触发；双字段只是 codex 同源运行时的既有兼容面，若宿主忽略 `commandWindows` 则行为回落到已实测路径。CI 无法覆盖真实桌面端，列为发布后人工 smoke 项。
- [headless `-p` 模式不展开插件斜杠命令] → `/lore` 主要面向桌面端交互形态；即使宿主忽略该组件，Skill 入口仍完整可用，属于惰性降级。
- [`hookSpecificOutput.additionalContext` 的长度上限未在 WorkBuddy 文档化] → 沿用 codex 的 `additionalContextLimit: 5000` 有界渲染；Catalog 渲染器本身已有界。
- [三份根级 registration 文件并存增加漂移面] → `plugin-layout.test.ts` 扩展 workbuddy 身份/版本断言，与 codex/zcode 同一测试封锁漂移。

## Migration Plan

纯增量：新宿主 artifact 与 CLI 联合类型扩展，不改既有宿主行为。回滚 = 删除 `plugins/workbuddy/`、根 `.codebuddy-plugin/marketplace.json` 与 `workbuddy` 相关 CLI 分发/测试/文档；spec deltas 尚未 archive，不涉及已接受合同回滚。

## Open Questions

无遗留——issue #205 的 4 个开放问题已在 proposal.md 中决策并给出依据。
