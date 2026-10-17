# Design: add-claude-code-host

## Context

**官方契约（Observed，2026-09 文档 + 本机实测，证据录于 `.tmp/claude-plugin-compatibility.md`）**：

- Claude Code Plugin 的 manifest 固定在插件根 `.claude-plugin/plugin.json`（该目录只允许这一个文件）；`skills/`（每技能一个含 `SKILL.md` 的子目录，`references/` 受支持）与 `hooks/hooks.json`（顶层 `hooks` 键 + 可选 `description`）按约定目录自动发现。插件内技能命名空间为 `/插件名:技能名` → `/lorelum:lorelum`。
- marketplace 文件固定在 marketplace 根的 `.claude-plugin/marketplace.json`：必填 `name`、`owner`（`owner.name` 必填）、`plugins`；条目 `source` 相对 marketplace 根（= 仓库根）解析，安装时 manifest `version` 覆盖条目 `version`。
- SessionStart 输入为 stdin JSON（`hook_event_name: "SessionStart"`、`source: startup|resume|clear|compact|fork`），输出 envelope 为 `{hookSpecificOutput: {hookEventName: "SessionStart", additionalContext}}`——与本仓库 `buildHostHookResponse` 现有输出逐字同形；`additionalContext` 与纯文本 stdout 合计上限 10,000 字符（宿主硬顶，无 per-hook 可调字段）。
- 失败语义原生非阻塞：exit 2 → 向用户展示 stderr、会话继续；其他非零 → 非阻塞错误提示、会话继续；`continue: false` 在 SessionStart 上不被允许。SessionStart hook 在启动时后台执行，Claude 首个回复等待其完成（非 fire-and-forget，注入时机可靠）。
- Windows 执行模型：shell form（`command` 字符串）走 Git Bash（无 Git Bash 时回退 PowerShell）；exec form（`args` 数组）直接 spawn，**明确不能 spawn `.cmd`/`.bat`**。本机（win32 26100 + Git Bash + lore 0.1.0-alpha.4）实测：裸 `lore` 在 Git Bash 不可解析（`command not found`），`lore.cmd` 可解析可执行；`install.ps1` 只把 `lore.cmd` shim 放入用户 PATH（release 目录内的 `lore.exe` 不在 PATH）；POSIX 侧 `install.sh` 用符号链接把 `~/.local/bin/lore` 指向真实二进制。
- 验证面（Observed）：本机无独立 `claude` CLI，但有正在使用的 Claude Desktop 2.9939.2.0（MSIX，`deploymentMode: "3p"` 本地代理认证）。桌面 Code 标签的**本地会话**与 CLI 共享 `~/.claude` 全套状态并运行同一引擎；插件管理器 UI（`+ → Plugins`）支持安装/三 scope/enable/disable/uninstall；插件浏览器仅本地与 SSH 会话可用（云会话、WSL 会话不支持插件）。
- **已读候选两环契约（Observed，2026-09-29 官方 hooks reference 全文 + `share-read-practice-hints` 已合入实现）**：Claude Code 存在 `SubagentStart` 事件（Agent 工具派生、恢复子 Agent、agent team 每条消息），stdin 为公共字段（含 `session_id`）+ `agent_id`/`agent_type`，输出经 `hookSpecificOutput.additionalContext` 注入子 Agent 上下文首条 prompt 之前；exit 2 仅在子 Agent 转录渲染非阻塞通知，不阻塞创建。`PreToolUse` 匹配内置工具名 `Bash`、`PowerShell` 等（matcher 精确 token 交替如 `Bash|PowerShell`，官方 Windows 示例即此组合）；`hookSpecificOutput.updatedInput` 整体替换工具输入，官方文档明确「宿主按 hook 返回的输入评估权限规则」，且 `permissionDecision: "allow"` 才会跳过权限确认、deny/ask 规则无论如何仍被评估。Windows 上无 Git Bash 时不注册 Bash 工具、PowerShell 为主 shell。#250 已为 Codex 落地同链路（`respondToCodexPracticeHint`、`agent.shellSessionInjection`、Backend `sessions/<hostKey>/<sessionId>/practice-reads.jsonl`），CLI/Backend 合同宿主无关，`hostKeySchema` 枚举当前为 `codex|cursor|workbuddy|zcode`。

**CLI 侧现状（Observed）**：`host-hook.ts` 已按 `HostHookName`（`codex | cursor | workbuddy | zcode`）参数化，per-host 薄包装 + `parseHostHookInvocation`/`runHostHook` + `hookSpecificOutput` envelope 构造齐备；新增宿主是封闭联合的扩展而非新机制。`plugins/scripts/plugin-layout.test.ts` 现有一条过渡期守卫断言 `.claude-plugin/marketplace.json` 不存在（standardize-host-plugin-layout 时代明确排除 Claude Code 的产物），本变更将其翻转为正向断言。`add-workbuddy-host` 为同型模板（其 delta 尚未 archive，见 Risks）。

## Goals / Non-Goals

**Goals**：

- Claude Code 用户获得与 codex/zcode/workbuddy 一致的体验：SessionStart 注入 metadata-only Catalog，Skill 指引 `lore` 检索，`/lorelum:lorelum` 为单一显式入口。
- CLI 侧 `lore hook claude` 复用同一 Catalog 检索/渲染语义与降级契约，行为与其他宿主逐字对齐。
- marketplace、layout 测试、维护者与用户文档全部落位，五份宿主 registration 相互独立。

**Non-Goals**：

- 不引入本地 MCP/stdio 面（Claude Plugin 支持 `.mcp.json` 组件，明确不使用）。
- 不实现 macOS/Linux 真机冒烟（无对应环境；声明范围收窄至已验证平台，见 Risks）。
- 不改动既有四宿主的 artifact 与合同；不使用 Claude 的 `sessionTitle`/`watchPaths`/`reloadSkills` 等额外输出键。

## Decisions

1. **Hook 命令采用 shell 字符串 `lore hook claude || lore.cmd hook claude`，`timeout: 10`（秒）**。排除项及依据：
   - exec form（`args` 数组）：Windows 上 PATH 无 `lore.exe`、`.cmd` 不可 spawn → 必坏；
   - 裸 `lore hook claude`：Windows Git Bash 解析不了裸 `lore`（实测）→ 每次启动报错且 Catalog 永不注入；
   - codex 式 if/else 包装 + `commandWindows`：Claude 原生把 Hook 失败降级为非阻塞提示，CLI 内部已自行降级 `{"continue":true}` 退出 0，包装只会吞掉「CLI 未安装」的可见信号；且 `commandWindows`/`additionalContextLimit` 不是 Claude hooks schema 字段。
   - `||` 形态的行为：POSIX 首项命中符号链接即短路；Windows Git Bash 首项 127 后由 `lore.cmd` 命中（首项 stderr 噪音在最终退出码 0 时不展示）；两侧皆无 → 127 非阻塞报错，保留「CLI 未装」的可行动信号。
2. **matcher 为 `startup|resume|clear|compact|fork`**：Claude matcher 对 SessionStart 按精确 token 匹配，含 `fork`（分叉会话丢失已注入上下文，与 `compact` 同理重新注入）。
3. **`HostHookName` 追加 `"claude"`，`hostLabel` 返回 `"Claude Code"`**；诊断前缀遵循既有 `lore hook <host> degraded:` 模式。薄包装 `claude.ts` 与 `workbuddy.ts`/`zcode.ts` 同构，仅宿主常量不同；响应构造直接复用 `buildHostHookResponse`（事件名与 envelope 同 zcode 组，无需新 builder）。
4. **manifest 极简**：`name/version/description/author{name,url}/homepage/license/repository/keywords/displayName`（displayName 为 **Lorelum**，满足 issue「一个名为 Lorelum 的用户可见 Plugin」），不写路径指针（约定目录自动发现），不写 `hooks` 字段（Claude 系 manifest `hooks` 字段语义是内联对象或精确文件路径，自动加载 `hooks/hooks.json` 已覆盖，避免双路径——与 WorkBuddy 决策 3 同理）。`claude plugin validate --strict` 要求的 description/version/author 均满足。
5. **marketplace 注册**：仓库根 `.claude-plugin/marketplace.json`，`{name: "lorelum-plugins", owner: {name: "Lorelum", url: "https://lorelum.com"}, plugins: [{name: "lorelum", source: "./plugins/claude/lorelum", version 与 manifest 一致, description, author, category, icon}]}`——唯一要求 `owner` 的宿主注册。五份 registration 互不引用对方 artifact。
6. **Skill 宿主化副本以 zcode 版为底**（含 injected Catalog 假设），宿主名词替换为 Claude Code；须通过 `docs/development/skill-guidance-fixtures.md` 全部场景；`references/semantic-query-recovery.md` 按同底本派生。**不随带 `commands/`**：官方将 commands 定位为旧形态，`/lorelum:lorelum` 单入口已覆盖显式调用，双入口徒增漂移面（与 workbuddy 的差异：WorkBuddy 有桌面端 `commands` 指针先例，Claude 侧官方指南明确指向 skills）。
7. **版本纪律**：manifest、marketplace entry、`plugin-layout.test.ts` 断言统一为当前 release 版本 `0.1.0-alpha.4`。
8. **验证面以桌面客户端本地会话为一等冒烟面**（Windows 原生）。两个先行探针：桌面提示框 `/plugin marketplace add` 是否可用、Manage plugins 是否有 Update 入口；退路 = 临时安装 CLI 仅执行 `marketplace add`/`plugin update`（三面状态共享，验收观察仍在客户端完成）。`claude plugin validate ./plugins/claude/lorelum --strict` 纳入维护者验证命令。
9. **（评审扩展，Refs #254）身份改写按工具名选择语法**：`Bash` → Unix `export` 前缀（任意平台；Windows 上该工具经 Git Bash 执行，本变更 SessionStart 真机冒烟已证 Git Bash 路径成立）；`PowerShell` → `$env:` 前缀（任意平台）。matcher `Bash|PowerShell`（官方 Windows 示例原样）。其余工具名一律 `{}`。共享 `containsLoreToken` 文本检测与 `agent.shellSessionInjection` 语义，不复制 Codex 的按平台分支。
10. **（评审扩展）Claude 的 PreToolUse 响应仅含 `updatedInput`，不携带 `permissionDecision`**：官方文档语义下这保留正常权限评估流（宿主对改写后输入评估规则，deny/ask 规则仍生效），满足 #254「MUST NOT 改变原命令批准语义」；Codex 侧的 `allow` 形态是彼宿主已定合同，不改动。`HostHookResponse` 的 PreToolUse 变体将 `permissionDecision` 放宽为可选。真机验收含「改写后命令权限流不变」观察项；若实测 `updatedInput` 缺 decision 不生效，按 #254 后备顺序处理（公共会话窗口或声明缺口），不回退到 `allow`。
11. **（评审扩展）CLI 路由共享化**：`respondToCodexPracticeHint` 参数化为 `respondToPracticeHint(input, host)`，codex/claude 共用 SubagentStart 读取、lore-only/all-shell 检测与改写构造；`runHostHook` 降级回退 `{}` 的宿主特判扩为 `codex|claude`。Backend `hostKeySchema` 追加 `"claude"`（会话目录边界获得 `sessions/claude/` 命名空间），Plugin 内不另存候选。PreToolUse/SubagentStart 的 Hook 命令用 codex 式 if 包装（CLI 缺失 → `{}` 静默失败开放；PreToolUse 额外把旧 CLI 的 `{"continue":true}` 归一为 `{}`），SessionStart 维持裸 `||` 形态（决策 1 理由不变）。

## Risks / Trade-offs

- [无 Git Bash 时的 PowerShell 回退不认 `||`（Windows PowerShell 5.1）] → 该边缘下 hook 语法错，Claude 以非阻塞错误提示继续会话；Claude Code 在 Windows 常规依赖 Git for Windows，接受此降级并记录，不为边缘引入双命令分支。
- [桌面端 `/plugin marketplace add` 与 Update 入口未在官方文档明列] → 列为冒烟先行探针；若不可用，用临时 CLI 执行该步（状态共享），验收观察仍在客户端。
- [`additionalContext` 10k 宿主硬顶，无 per-hook 限额字段] → Catalog 渲染器本身有界；集成场景须覆盖多 Pack 下渲染尺寸，超限由宿主截断、不阻塞会话（宿主契约）。
- [与 `add-workbuddy-host` 并行 active、两 delta 修改同一组 Requirement] → 本 delta 已包含 workbuddy 的目标文本；**任一侧后 archive 都必须重读当前 spec 重新同步 delta 再 archive**（两侧 delta 互相包含对方场景是收敛条件），已在 tasks 的验证节固化为检查项。
- [本机仅 Windows，无法执行 macOS/Linux 冒烟] → 冒烟声明范围收窄至 Windows 原生（桌面本地会话 + Git Bash + `lore.cmd` PATH 解析）；macOS/Linux 留待有对应环境时补充验证，用户文档安装命令不声明未验证细节。
- [五份根级 registration 并存增加漂移面] → `plugin-layout.test.ts` 扩展 claude 身份/版本断言并翻转过渡守卫，与既有宿主同一测试封锁漂移。
- [`updatedInput` 不带 decision 的实际生效性在文档中是推断而非逐字保证] → 真机验收设置专门观察项（改写后命令执行 + 权限提示行为）；不成立则按 #254 后备顺序降级并更新本设计，不引入 `allow`。
- [`share-read-practice-hints`（active）的「当前只有 Codex 消费这项配置」表述与本变更落地后的事实冲突] → 该需求尚未进入 specs/，本 delta 无法对其做 MODIFIED；已在新增需求中写明「Claude Code 与 Codex 共同消费」，并在 tasks 固化检查项：任一侧 archive 时重读当前 spec 同步该句（与 workbuddy interlock 同一纪律）。
- [子 Agent 亦触发 PreToolUse（公共字段含 agent_id），其 shell 读取会写入同一会话候选] → 与 #215 已声明的 Codex 同款归属限制，用户文档明示；不为本变更引入来源隔离。

## Migration Plan

纯增量：新宿主 artifact、根 `.claude-plugin/marketplace.json`、CLI 联合类型扩展，不改既有宿主行为。回滚 = 删除 `plugins/claude/`、根 `.claude-plugin/marketplace.json` 与 `claude` 相关 CLI 分发/测试/文档，恢复 `plugin-layout.test.ts` 的不存在断言与 `agent-setup` 页的手动 Skill 指引；spec deltas 未 archive 前不涉及已接受合同回滚。

## Open Questions

无遗留——issue #233 的条件分支（「当且仅当存在经验证的非阻塞 lifecycle Hook 时提供 catalog adapter」）已裁决成立，五个开放决策（命令形态、matcher、commands、manifest、marketplace owner）均在 proposal 给出依据。
