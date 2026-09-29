## Context

最初的 worktree 原型已有 Backend 拥有的 Practice 候选接口、内存活动窗口和 `~/.lorelum/sessions/<host>/session-<编码ID>.jsonl`；当时尚未经过真实子 Agent 验收。活动窗口原本位于 Practice-hints 服务内部，可能使未来会话功能重复维护窗口；文件组织也让 `sessions` 看起来只服务 Practice 已读清单。初版已把它们迁到公共 `sessions` 模块并验证 macOS 的真实子 Agent 链路；本轮消除 Codex 在 Linux/Windows 上仍用窗口后备的平台差异。参见 [proposal.md](./proposal.md) 的需求和 [agent-integration delta](./specs/agent-integration/spec.md) 的行为约束。

Codex Hook 本身有 `session_id`、`tool_use_id` 和 Bash 的 `tool_input.command`，问题是脚本内执行的 `lore get` 进程不会自动得到这些字段。[OpenAI Hooks 文档](https://learn.chatgpt.com/docs/hooks) 要求 `PreToolUse` 同时返回 `permissionDecision: "allow"` 与 `updatedInput` 才能改写输入。macOS 真实宿主的完整链路验证了直接命令、`sh` 脚本、管道中的 `lore get` 能继承会话身份并记录候选；真实子 Agent 收到了短提示。

宿主 Hook 的 JSON 输出不能单独证明命令实际继承身份；成功读取、持久记录和子 Agent 可见性须沿完整链路验证。不同平台的结果不能互相推定。

## Goals / Non-Goals

- **Goals：** Codex 在 macOS、Linux 和 Windows 的 shell tool 中直接传递会话身份，避免同路径会话误归属；一个通用会话目录能容纳未来不同会话数据；只保留一套供其他宿主复用的活动窗口后备；仍让 `get` 的可选报告失败时不影响读取。
- **Non-Goals：** 不把环境变量当认证或采纳证据；不保证清空环境、跨容器/远程进程能继承身份；不因显式身份而自动启动 Backend；不实现 compact 恢复、会话清理、通用事件日志、数据库或本地 MCP。macOS 已验收，Linux/Windows 的宿主级权限与继承结果不得由此推定。

## Decisions

### 显式身份优先，窗口只作公共后备

Codex 的 `PreToolUse` 仅匹配 Bash，保留原 `tool_input` 的所有字段，只给 `command` 前置宿主与会话 ID 的赋值。macOS/Linux 用经过 Unix shell 安全引用的 `export`，Windows 原生 PowerShell 用 `$env:` 赋值并对单引号转义。返回宿主规定的 `hookSpecificOutput`、`permissionDecision: "allow"` 和完整 `updatedInput`。不解析原命令；对非 Bash、缺少会话 ID 或无法安全改写的调用输出 no-op。这条显式绑定路径不为每次 Bash 连接 Backend，Codex `PostToolUse` 不需要关闭窗口。直接命令、管道、本地脚本通常继承这两个变量；明确清空环境、`sudo`、容器和远端命令可能丢失它们，此时允许漏记。正式实现必须确认加前缀不会改变原命令的工作目录、参数、退出码和批准流程；各平台须分别在正常宿主环境验证，不能以另一平台的结果代替。

Windows 原生 Codex 使用 PowerShell，WSL 内运行的 Codex 使用 Linux 路径；Hook 的 Windows `commandWindows` 只负责调用 `lore hook codex`，具体的 PowerShell 命令前缀由 CLI 返回。其他宿主若没有安全的输入改写能力，仍可映射自己的 shell Pre/Post 到同一公共后备；不能为每项会话功能另建窗口。Codex 三个平台不同时写窗口以追求双保险，避免每次 Bash 的 Backend 请求与两套归属结果。尚未完成的 Linux/Windows 真实宿主验证须在交付说明中标明，不把单测视为实测。

### 仅在需要时改写 shell 命令

`~/.lorelum/config.yaml` 的 `agent.shellSessionInjection` 是 Agent 共用配置，仅支持 `lore-only` 与 `all-shell`。当前只有 Codex Hook 消费它；其他宿主尚无 shell 身份改写能力，不为统一名称新增空跑 Hook。缺失时默认 `lore-only`：Codex Hook 仍会收到每次 Bash PreToolUse，但只在原 `tool_input.command` 文本出现独立的 `lore` 字样时返回 `updatedInput`；`lore get`、绝对路径中的 `/lore`、管道和命令替换都可命中。这里只做文本边界判断，不解析 shell AST，也不检查本地脚本内容。文本提到 `lore` 但未执行时可能多注入一次；外层只有 `sh script.sh` 而脚本内部调用 `lore` 时会漏记。这是用户认可的默认取舍，不另建窗口补记。

用户显式选择 `all-shell` 后，Codex 为每次有效的 Bash 命令都注入，覆盖脚本内间接调用的常见子进程继承。该值不表示非 shell tool 也注入。设置由 CLI 在 Hook 调用时读取用户级共享配置，只校验 `agent` section，不写配置或更改已有自定义字段；缺失配置正常使用默认。无效 YAML 或无效值使本次 Hook 输出 no-op 和不含配置内容的诊断，不阻塞原命令，也绝不默默扩大为 `all-shell`。SessionStart Catalog、SubagentStart 提示和普通 `lore get` 不受此开关控制。两种模式都仍运行 Codex Pre Hook，因此默认模式减少的是命令改写和变量可见性，不承诺消除每条 shell 命令的 Hook 进程开销。先前 `codex.shellSessionInjection` 只存在于未合并 PR，不另加双配置优先级或迁移器。

CLI `get` 仍直接从 LocalStore 读取；成功后才按同一 `SessionRef` 合同检查成对的宿主/会话环境变量，缺失或无效都当作未提供，不把坏值传给 Backend。有效时将可选 `SessionRef` 与候选元数据、实际 `cwd` 一起发给**已运行**的 Backend。没有有效显式身份时，由 Backend 尝试公共活动窗口；两条路径都不可用就不记。Backend 的关联模块只负责一次会话归属，Practice-hints 模块只负责“读过什么”与持久化。关键内部合同示意（具体 DTO 复用现有本地认证协议）：

```ts
type SessionRef = { hostKey: HostKey; sessionId: string };
interface SessionAssociation {
  resolve(cwd: string, explicit?: SessionRef): SessionRef | undefined;
  routeToolEvent(event: ShellToolEvent): void; // 仅窗口后备宿主调用
  directory(session: SessionRef): string;
}
interface PracticeHintBackendClient {
  recordSuccessfulGet(cwd: string, hint: ReadHint, session?: SessionRef): Promise<void>;
  readRecentHints(session: SessionRef): Promise<readonly ReadHint[]>;
}
```

`packages/backend/src/modules/sessions/` 拥有此内部关联能力和会话路径解析；其中活动窗口是**同一个**进程内模块，供需要后备的宿主共享。保留一个短 README，写明调用方、显式身份优先顺序、Pre/Post 窗口的创建/关闭/过期、工作目录近似匹配、无持久窗口、无权限语义，以及当前 Codex 三个平台都不再使用窗口。它不是新公开 CLI/API，也不预建通用任务状态机。`packages/backend/src/modules/practice-hints/` 调用这个边界，不再私有维护窗口。工作目录在显式身份路径用于记录实际发生地，不参与选择会话；只有窗口后备才用目录与时间近似匹配。

### 通用会话目录，功能专属文件

目录改为：

```text
~/.lorelum/sessions/
  <hostKey>/
    <宿主原始 sessionId>/
      practice-reads.jsonl
```

Backend 统一计算会话目录：Codex 的会话 ID 原样作为目录名，不加 `session-` 前缀，也不做 base64 编码；文件操作仍须保持在用户会话目录内。其他将来的会话数据可以放同级的**不同**文件，而不是挤入 Practice 清单或另建一套顶层目录。当前只创建真实需要的 `practice-reads.jsonl`，不预设 `session.json`、索引或生命周期管理。每条 JSONL 保留 host/session ID、读取时间、实际工作目录、Practice ID、digest、标题和可选适用条件；不记录 Pack 来源列表、正文、prompt、查询、shell 命令或工具输出。子 Agent 按 Practice ID 自行 `lore get`，不需要来源 Pack。目录和文件仅当前用户可访问。文件完整追加；读取时按 ID 去重并按响应/注入预算截短，损坏末行不抹掉旧记录。Backend 重启、worktree 删除不删除会话文件。

现有路径仅在未发布的 worktree 实现中出现，本机 `~/.lorelum/sessions` 尚不存在；本阶段直接调整代码和隔离测试，不为未发布原型添加迁移器，也不主动删除任何旧临时文件或用户目录。若实施前发现真实用户文件，先重新评估迁移，不能静默忽略。`--store-root` 仍只选择 Pack Store，不改变用户级会话根目录。

### 失败与信任边界

环境变量只是宿主传递的关联线索，不是用户认证、权限凭据或防伪令牌；Backend 仍只接受经现有本地认证的请求，并在入口验证 host/session 字段。独立终端可以自行设置同名环境变量，因此候选绝不能用于授权、采纳或完成判定。成功 `get` 的报告、窗口后备及 `SubagentStart` 读取都不为提示启动 Backend；不可达、超时或没有归属时允许漏记，普通 `get` 文本/JSON 与退出码不变。`SubagentStart` 仍只注入短元数据和需要时自行 `lore get` 的提示，不自动读取正文。

## Risks / Trade-offs

- **改写 Bash 的语义与信任成本** → 默认只改文本含 `lore` 的 `command`，`all-shell` 由用户显式开启；保留其余工具输入，验证原退出码、工作目录和批准流程。未信任 Hook 应保持原命令且不声称精确绑定；失败不靠解析命令补救。
- **变量没有跨某些进程边界继承** → 记录为能力边界；Codex 三个平台都不并行维持窗口。Linux/Windows 真实宿主验收结果须与已通过的 macOS 结果分开报告。
- **窗口后备同路径会话重叠** → 仍可能误归属，文档仅对后备路径提示此限制；显式会话身份不借目录推断。
- **直接身份可被同用户进程伪造** → 只用于可选检索提示，不用于权限、安全审计或可信的父 Agent 采纳判断。
- **会话文件增长与读取扫描** → 本阶段只有有界响应，没有清理策略；观察真实占用与延迟后再设计，不预设锁或数据库。

### 已讨论且不采纳

| 方案 | 原因 |
| --- | --- |
| 所有 Codex Bash 继续 Pre/Post 请求 Backend 开窗口 | macOS 的显式身份 demo 已证明可跨本地脚本/管道传递；常见路径再做窗口增加请求成本和同路径误归属。 |
| 删除全部窗口代码，只支持能改写命令的宿主 | 其他宿主未必支持安全改写；共用的窗口后备仍可供它们复用。 |
| 每个功能自建会话窗口或在 CLI/Plugin 写另一份清单 | 造成多个归属规则和存储位置，违背 Backend 单一所有者。 |
| 环境变量当认证凭据，或用复杂签名阻止同用户伪造 | 候选只是提示；这不会替代已有 Backend 认证，却会引入密钥分发与生命周期成本。 |
| 强制 `get --json`、解析 Bash 文本/输出 | 脚本和管道会系统性漏记，不解决实际进程的会话身份。 |

## Migration Plan

用户已批准 Codex 三个平台改用显式身份。`sessions` 模块已有唯一会话路径和公共活动窗口接口/README，Practice-hints 服务将记录放进会话目录；CLI 成功 `get` 的报告也接受可选显式身份。Codex macOS 已完成真实宿主链路验证；Linux 和 Windows 改用各自 shell 的赋值语法后，须分别核对真实宿主结果，不能仅凭单测宣称验收通过。原型临时文件与旧会话文件不主动删除。

实施验证分两道：第一道在正常运行的真实 Codex 宿主检查改写实效——分别跑直接命令、脚本、管道、非 shell、原命令退出码、工作目录和需批准的安全操作；确认 `permissionDecision: "allow"` 没有跳过宿主审批。三平台分别记录结果。第二道启动与源码匹配的 Backend 和真实 Codex 子 Agent，确认成功/失败 `get`、同路径并行会话、文件重启可读、子 Agent 实际看到提示，并测 Hook 冷/暖与报告开销；不能只看 Hook 输出 JSON。无法运行的宿主路径保留实现与测试，但不得宣称已完成真实宿主验收，也不再把 Codex 窗口路径作为悄悄回退。没有通过真实链路前不得声称相应平台的自动注入已实测交付。
