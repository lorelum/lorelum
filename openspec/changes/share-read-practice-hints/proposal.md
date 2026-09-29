## Why

主 Agent 在任务中读过的 Practice，可能正好是子 Agent 的检索起点。早期原型曾把候选放在系统临时目录，并使用看起来专属于清单的会话文件；现在候选由 Backend 存入通用会话目录，macOS 的真实子 Agent 链路也已验证。Codex 的 Hook 能提供会话 ID；改写 shell 输入后，本地脚本和管道中的子进程可以继承该 ID。Linux 和 Windows 不应继续只靠目录与活动窗口近似关联。候选仍只作为低成本检索提示，不是任务记忆或采纳记录。

## What Changes

- Codex `PreToolUse` 只针对 Bash，在保留原工具输入其余字段的前提下，为 shell 命令导出宿主与会话 ID；macOS/Linux 使用 Unix shell 写法，Windows 原生 Agent 使用 PowerShell 写法，非 shell tool 跳过。macOS 的真实 app-server 命名权限档位 demo 已验证直接命令、脚本和管道会继承 ID；这不等于 Linux 或 Windows 已完成真实宿主验收。Codex 的 `PostToolUse` 不再开关活动窗口。
- 为了避免普通 shell 命令也出现会话变量，用户级 `config.yaml` 增加 `codex.shellSessionInjection`：默认 `lore-only`，仅当宿主提交的命令文本含独立的 `lore` 字样才改写；可设 `all-shell`，为每个 Bash shell 命令改写。默认模式不读本地脚本文件，外层 `sh script.sh` 没写 `lore` 时，脚本内部的 `lore get` 可能漏记。配置不控制 SessionStart Catalog、SubagentStart 或其他 tool。
- `lore get` 仍由 CLI 直接读取 Practice；成功后才将候选元数据、实际执行目录与有效且成对继承的会话身份短时报告给已运行的 Backend，不启动 Backend、不要求 `--json`，不分析命令或输出。CLI 将缺失或无效身份视为未提供；Backend 优先使用显式身份，否则由一个跨功能共用的活动窗口模块近似关联，不能让后续功能各建一套窗口。
- `~/.lorelum/sessions/<hostKey>/<宿主原始 sessionId>/` 是通用会话目录，Codex 直接使用自己的会话 ID，不额外编码或加前缀；本功能只占用其中的 `practice-reads.jsonl`。Backend 是唯一写入者；当前不引入通用数据库、清理状态机或额外的会话元数据文件。活动窗口是可选的内存关联能力，不是第二份候选清单；保留它的内部接口与 README，供无法安全传递显式身份的其他宿主复用。
- Codex `SubagentStart` 通过 Backend 读取本会话的候选，去重并按预算注入短提示。子 Agent 认为相关时再自行 `lore get`，不自动读取正文。Backend 重启或 worktree 删除不应清除已经持久化的候选。
- Backend 不可达或没有可用会话身份时允许漏记；显式绑定不受同路径并行会话影响，其他宿主的窗口后备路径仍可能误归属。子 Agent 的读取也可能进入同一会话清单。提示称“本会话已读候选”，不称“父 Agent 采纳的 Practice”。macOS 已验证真实子 Agent 与权限链路，Linux/Windows 仍需各自宿主验收；不把无本地连接权限的沙箱当成记录能力的目标环境。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：保持 CLI-first、候选 metadata-only 与 Backend 单点存储；让支持安全改写的宿主显式传会话身份，保留公共窗口关联作为不能传递身份时的后备，Codex 继续提供 `SubagentStart` 提示，其他宿主的 SessionStart Catalog 不变。

## Impact

涉及 `packages/cli/src/hook/`、`get` 成功读取后的报告路径、`packages/backend` 的会话目录解析和公共关联模块、Codex Plugin Hook 配置、测试及双语用户指南。复用现有 Backend 认证，不增加 daemon、数据库或本地 MCP；候选不进入 Pack LocalStore、Engine、Plugin 私有存储、临时目录或工作区。本次与 #214、#215、#216 相关；#217 的 compact 恢复不在范围。以 [tasks.md](./tasks.md) 的验收状态区分已实现的 Backend/CLI 边界与尚未通过的 Mac Hook 改写、真实子 Agent 链路，不能把前者当作整项能力已交付。
