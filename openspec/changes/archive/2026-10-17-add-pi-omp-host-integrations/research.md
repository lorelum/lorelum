# Codex、pi 与 omp 插件考证

本文件保存方案依据与实验边界，不声明 pi/omp 的 Lorelum 插件已经实现。考证日期：2026-10-12。

## 考证对象

| 对象 | 版本依据 | 本轮执行 |
| --- | --- | --- |
| Codex CLI | `codex --version`：0.162.0 | plugin/marketplace help；已发布 Lorelum Hook |
| Lorelum CLI | `lore --version`：0.1.0-alpha.5，protocol 2 | Catalog 和 Bash 会话身份改写 |
| pi | npm metadata 与临时安装的 `pi --version`：1.1.0 | 独立目录安装、package discovery、RPC extension startup |
| omp | 已安装 package metadata 与 `omp --version`：18.8.7 | help、独立 marketplace 安装、RPC extension startup |

pi 的旧仓库地址 [badlogic/pi-mono](https://github.com/badlogic/pi-mono) 重定向到 [earendil-works/pi](https://github.com/earendil-works/pi)。公开 CLI 包为 [`@earendil-works/pi-coding-agent`](https://registry.npmjs.org/%40earendil-works%2Fpi-coding-agent/latest)，Node 要求为 22.19+。不要把旧 npm 命名与旧事件接口当成所有 pi 版本的合同。

pi 的源码链接来自 upstream `main`，未锁定 commit；npm 版本与可执行实验锁定为 1.1.0。omp 依据本机 18.8.7 分发包内的源码；未把搜索镜像的“latest”声明作为发布版本依据。

## Lorelum 的 Codex 实现

分发链是 [marketplace registration](../../../.agents/plugins/marketplace.json) 指向 [manifest](../../../plugins/codex/lorelum/.codex-plugin/plugin.json)，manifest 声明 `skills/`，宿主发现 [hooks/hooks.json](../../../plugins/codex/lorelum/hooks/hooks.json)。产品 ID 为 `lorelum`，selector 为 `lorelum@lorelum-plugins`，不是 npm package。

三条执行链由 [CLI host adapter](../../../packages/cli/src/hook/host-hook.ts) 拥有：

- `SessionStart` 匹配 startup/resume/clear/compact，调用 `lore hook codex`，从 Pack list service 获取详情，由 [renderer](../../../packages/cli/src/hook/pack-catalog.ts) 输出最多 4000 字符的 metadata-only Catalog。宿主 wrapper 的上下文限制为 5000，超时为 10 秒。
- `PreToolUse` 只匹配 `Bash`。默认只为外层命令文本含独立 `lore` token 的命令注入宿主与 session ID，`all-shell` 才覆盖脚本内间接调用。保留其余参数，Unix 使用 `export`，原生 Windows 使用 PowerShell 赋值。Codex 响应带 `permissionDecision: "allow"`；这个字段不能照搬到其他宿主。
- `SubagentStart` 从已运行 Backend 获取主会话的已读 Practice 候选，注入短 hint，不注入正文；没有 `PostToolUse` Hook。具体关联与持久化由 CLI/Backend 拥有，不是插件解析 shell 输出。

[Skill](../../../plugins/codex/lorelum/skills/lorelum/SKILL.md) 才决定任务相关的 semantic query，并在使用 Practice 前执行完整 get。Hook 不安装 Pack，不主动 query/get，不引入 MCP。

实测：已发布 CLI 的 `SessionStart` 返回带 `additionalContext` 的 Catalog；Bash probe 返回两个身份变量前缀，且保留 `timeout_ms`。这证明 Hook ABI 输出，不证明本轮实际发生了 Codex 主会话、权限流程或子 Agent 上下文消费。没有运行示例 Practice 的 get。

一个文档差异：Codex README 的“包含 Pack root”说法与 renderer 不符；实现和 [Hook 合同](../../../docs/cli/hook.md) 只注入名称、description 和 appliesTo。方案以实现与合同为依据，本轮不顺手修改既有文档。

## pi 的原生机制

依据：[packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)、[extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)、[types](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/extensions/types.ts)、[messages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/messages.ts)、[system prompt](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)。

- package.json 的 `pi.extensions` 与 `pi.skills` 声明资源；支持 npm、Git repository、local directory。文档没有建立 monorepo Git 子目录 selector，所以不能写 `pi install git:github.com/lorelum/lorelum` 并假定它选中 `plugins/pi/lorelum/`。
- `pi install`、`pi remove`、`pi list`、`pi update --extensions` 是 package 管理路径；个人配置为 `~/.pi/agent/settings.json`，项目配置为 `.pi/settings.json`，项目输入受原生 trust 管理。
- Extension 默认导出 factory，接收 `ExtensionAPI`。Skill 是按需读取的 Agent Skills 指令，不等于执行事件的 extension。
- `session_start.reason` 为 startup/reload/new/resume/fork；没有 omp 的 `session_switch` callback。
- `before_agent_start.systemPrompt` 是字符串，另有 `systemPromptOptions.sections`；`context` 是每次模型请求前的临时消息转换。custom message 经 host 转换为 user message；通过 context 返回消息不等于调用 sendMessage 持久写入会话。
- 工具参数通过原地修改 `tool_call.event.input` 改写；返回值不是 omp 的 `{ input }` replacement。
- 原生产品不带子 Agent。第三方 subagent extension 的行为不能替代一个官方生命周期合同。

## omp 的原生机制与兼容边界

源码位置均相对于 `@oh-my-pi/pi-coding-agent@18.8.7` 分发包；上游为 [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi)。

| 事实 | 证据位置 |
| --- | --- |
| package manifest 优先读 `omp`，否则读 `pi` | `src/extensibility/plugins/loader.ts:194-199`；`extensions/directory-resolution.ts:48-71` |
| package Skill 来自实际 `skills/` 目录，不保证消费任意 `pi.skills` 路径 | `src/discovery/omp-plugins.ts:65-75`；`omp-extension-roots.ts:342-350` |
| 独立 marketplace 优先发现 `.omp-plugin/marketplace.json`，然后 `.claude-plugin/marketplace.json` | `src/extensibility/plugins/marketplace/fetcher.ts:209` |
| marketplace source 支持相对目录和 git-subdir；entry 要有 name/source，catalog 要有 owner | `marketplace/types.ts:70-138`；`fetcher.ts:100-171` |
| startup 与 switch 分开；fork 可出现在 switch 或 branch 事件 | `src/extensibility/shared-events.ts:29-74` |
| `before_agent_start` 的 system prompt/返回值是 `string[]` | `src/extensibility/extensions/types.ts:844-852,1295-1299` |
| 工具参数改写返回 `input`；后者在执行和审批前重验，多个 handler 的 input 是 last-wins | `src/extensibility/shared-events.ts:325-346` |
| 两个 pi namespace 都有显式映射 | `src/extensibility/plugins/legacy-pi-compat.ts:801-814` |
| ResourceLoader shim 有明确缺口：theme、extendResources、project/provider trust 等 | `src/extensibility/legacy-pi-coding-agent-shim.ts:899-923` |

omp 有原生 TypeScript extensions、另一套 Hook API，以及跨编辑器 discovery；它不是只把 pi 换了命令名。`ToolDefinition.shellEnv` 的文档限定为用户交互 shell surface，不能由此推导模型 bash 或 task 子 Agent 的进程环境继承。`before_subagent_spawn` 返回合同以模型路由/阻止为主，没有建立类似 Codex `SubagentStart.additionalContext` 的注入接口。

## 跨宿主实测

所有 probe 使用临时 HOME、独立 `PI_CODING_AGENT_DIR` 与临时 package/marketplace。移除认证环境变量，未读取真实宿主账户配置；RPC 只发送 `get_state`，没有 prompt 或模型请求。

1. 同一临时 extension 使用运行时 `import * as host from '@earendil-works/pi-coding-agent'`，注册 `session_start` 并调用 `ctx.shutdown()`。
2. pi 1.1.0 和 omp 18.8.7 都成功加载；`host.createAgentSession` 均可见，session ID 均为字符串。pi startup payload 的 reason 为 `startup`，omp 的 reason 缺失。
3. pi `install <临时目录>` 成功，`list` 显示一个 local package；不带 `-e` 的 RPC 启动自动发现并执行 probe。
4. omp 从临时 `.omp-plugin/marketplace.json` 添加 marketplace，再安装一个相对目录来源的插件；`plugin list --json` 显示对应 ID/version。不带 `-e` 的 RPC 启动自动发现并执行 probe。
5. omp 在无账户的临时环境必须显式选择模型才能启动；加 `--model openai/gpt-5.2` 后仅做 session startup，没有调用模型。

结论是“这个导入与 startup 子集在两个实际宿主上工作”，不是任意 pi extension 与 omp 双向兼容。

## 没有证明的事项

- pi/omp Lorelum Catalog 的模型可见性、自动 compact、真实 semantic query/get：尚未实现 adapter，本轮没有伪造验收。
- 远程 marketplace clone、公开 npm install/update、Windows 实机行为：未执行。
- omp task 子 Agent 的 extension 加载与父会话 hint 传递：没有完整执行链证据。
- 工作树源码 Hook smoke 因 `@lorelum/backend/config` 模块未解析而启动失败；已发布 CLI smoke 不代表本工作树源码验证成功。

临时宿主、probe、marketplace 和配置在考证完成后删除，不改变用户安装。
