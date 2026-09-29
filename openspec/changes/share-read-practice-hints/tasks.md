## 0. 已有证据，不等于修订方案已实施

- [x] 0.1 当前 worktree 已实现 Backend-owned 候选接口、旧的单文件会话路径及 Practice-hints 私有窗口；相关 Backend/CLI/Plugin 单元与协议测试通过，但这些测试只覆盖改方案前的代码。未发布，也没有真实子 Agent 可见性验收。
- [x] 0.2 在 Codex CLI 0.155.1 的 macOS app-server `permissions: ":read-only"` 临时会话，可信任的一次性 Pre Hook 返回 `permissionDecision: "allow"` 和保留原输入字段的 `updatedInput`。直接进程、`sh` 脚本、管道实际读到的环境变量哈希均与会话 ID 一致；没有写入用户配置或工作区。未验证 PowerShell、清空环境的命令及批准请求；只给出 `updatedInput`、不含 `allow` 时改写未生效。

## 1. 审查关口

- [x] 1.1 将修订后的 proposal、spec、design、tasks 交用户审查；用户明确同意前，不改生产代码、Plugin、双语用户指南或现有 Backend 文件。用户已明确批准实施并更新现有 PR。
- [x] 1.2 真实 Codex 命名权限档位下，改写后的命令保持工作目录与退出码 23；只读档位写入被沙箱拒绝，工作区外写入仍发起批准请求，拒绝后没有创建文件。当前 Bash Hook 输入只暴露 `command`，没有超时字段；保留其他输入字段（含模拟的超时字段）由单测覆盖，不把未出现的宿主字段说成实测通过。

## 2. 审查通过后调整实现

- [x] 2.1 把会话路径规划为 `~/.lorelum/sessions/<hostKey>/<宿主原始 sessionId>/practice-reads.jsonl`，Codex 会话 ID 原样命名目录，Backend 统一计算并确保文件操作留在用户会话目录内；完整记录继续只由 Backend 追加，且不含 Pack 来源列表。验证权限、长会话、损坏末行、重启和 worktree 删除后仍可读。不迁移或删除未发布原型文件；若实施前发现真实旧文件先重新评估迁移。
- [x] 2.2 将窗口从 Practice-hints 私有服务移到 Backend 的公共 `sessions` 模块，定义唯一会话关联入口，显式身份优先、窗口仅作后备；写 README 说明当前 Windows 使用者、生命周期、近似归属与未来宿主复用规则。不得为新功能另建一套窗口，也不增加无需求的通用状态机。
- [x] 2.3 CLI 成功 `lore get` 后按共同 `SessionRef` 合同筛选成对环境变量；缺失或无效当作没有显式身份，不把坏值交给 Backend，随后仅尝试公共窗口后备。带有效身份时向已运行 Backend 报告候选与实际目录。保持文本/JSON、失败读取、独立终端、Backend 不可达时的结果/退出语义，不启动 Backend、不建备用清单。
- [x] 2.4 当时的方案：Codex macOS 的 Pre Hook 仅对 Bash 保留全部原工具输入并给 `command` 前置安全引用的两个 `export`，不为窗口访问 Backend；非 shell no-op。Linux/Windows 保持现有 Pre/Post 窗口代码路径。此平台差异已由第 4 节的新要求替代。

## 3. 真实验收与文档

- [x] 3.1 测试 Backend 显式身份和窗口后备的隔离、认证、同目录并行会话；确认 Codex 原始会话 ID 直接对应目录、候选与子 Agent 提示不含 Pack 来源；测试环境变量缺失/无效的后备与漏记、Hook 不改其他输入字段、未信任/缺字段降级、Codex/Linux/Windows 配置和上下文预算。此时 Linux/Windows 尚未改写，后续验收见第 4 节。
- [x] 3.2 用与源码匹配的 Backend 和真实 Codex 完成直接、脚本、管道内的成功/失败 `get`、工作区子目录与真实子 Agent 可见性；测无 Lorelum Bash 的 Hook 冷/暖开销及 `get` 报告额外时间。不能拿 Hook JSON 或旧单元测试充当真实子 Agent 收到提示。
- [x] 3.3 当时已同步英文/中文用户指南与 Plugin README，说明会话目录、显式绑定与 Windows 窗口后备的差异；运行相关 CLI/Backend/Plugin 测试、typecheck、格式、lint、OpenSpec 严格校验并审阅完整 diff。新平台方案需要再次同步文档与验收，见第 4 节。

## 4. Codex 三平台显式会话身份

- [x] 4.1 Linux 与 macOS 共用 Unix shell `export` 注入；Windows 原生 PowerShell 使用 `$env:` 注入。保留 Bash 原始输入字段，非 Bash 或缺字段 no-op，Codex Plugin 不再安装空跑的 `PostToolUse` Hook。平台化单测覆盖转义和原输入；Unix shell 子进程继承与退出码有实际进程测试，Windows 实际执行留待 4.3。
- [x] 4.2 同步双语用户指南、Plugin README、Backend sessions README 与本变更的 proposal/spec/design；说明三个平台的写法差异、公共窗口仍供其他宿主复用，且不把 Mac 实测说成 Linux/Windows 实测。
- [ ] 4.3 运行相关测试、typecheck、格式/lint 和严格 OpenSpec 校验；能用真实 Linux/Windows Codex 宿主时检查改写、权限与子 Agent 链路，不能运行时如实记录未验收边界。

## 5. 可配置的 shell 会话身份注入范围

- [x] 5.1 在现有用户级 `config.yaml` 增加 `shellSessionInjection: lore-only | all-shell` 读取与校验，缺省 `lore-only`，无效配置对该次 Hook fail-open。默认只用外层命令文本的独立 `lore` 字样判定，不读脚本、不解析 shell；`all-shell` 保持当前所有 Bash 命令注入。覆盖三平台、非 shell、直接/组合命令、脚本间接调用和配置错误。
- [x] 5.2 同步双语 Codex 用户指南、配置入口和 Plugin/CLI 维护说明：明确默认只匹配外层文本，脚本内部可能漏记，`all-shell` 只涵盖 shell tool，不是每种工具；两种模式都不改变 `lore get` 结果。校验并更新现有 PR。
- [x] 5.3 将配置从 Codex 专属的 `codex.shellSessionInjection` 收敛到 Agent 共用的 `agent.shellSessionInjection`，不保留未发布旧字段的兼容层；修改读取、测试、双语文档与本变更合同。其他宿主尚无 shell 身份改写能力时不增加空跑 Hook；验证并更新现有 PR。

## 本轮验证记录

- 权限探针在临时目录使用真实 Codex app-server：只读写入返回 `Operation not permitted`，退出码 23 的原命令仍是 23；`:workspace` 档位的工作区外写入发起 `item/commandExecution/requestApproval`，拒绝后工具状态为 `declined`，目标文件不存在。当前宿主给 Hook 的 `tool_input` 只有 `command`，超时字段并未出现；单测模拟该字段并检查原样保留。
- 已将当前工作区 Plugin 安装为本地 `lorelum@lorelum-plugins`，用临时 PATH 让 Hook 调工作区编译的 CLI；Codex 登录 shell 内的 `get` 使用该 CLI 的绝对路径。与源码匹配的 Backend 写入原始会话 ID 对应目录；子目录中的直接、脚本、管道 `get` 各留一条候选，失败读取未新增。正常持久 Codex 会话里的真实子 Agent 在未收到 ID/标题的委派任务下，返回了候选 ID 和标题。未信任 Hook 的另一次真实会话未改写命令。macOS 实测不代表 Linux/Windows 通过。
- 本机 8 次进程样本：无 Lorelum 命令的 Mac Pre Hook 首次 131 毫秒，后续中位数约 117 毫秒；`get` 无显式会话中位数约 227 毫秒，显式会话约 218 毫秒。不同次序且样本少，不据此声称提升。Backend 停止时，带显式身份的成功 `get --json` 仍返回同一 Practice digest 和成功退出码。测试后已恢复原来的全局 Backend 构建和已加载模型；全局 `lore` 链接与用户配置没有改动。
- 最终相关 Backend、CLI、Codex Plugin 测试为 535 通过、3 项 Windows 平台跳过、0 失败；typecheck、格式检查、lint（已有警告，退出码 0）、Plugin 校验器（隔离安装 PyYAML）、`build:cli`、OpenSpec 严格校验与 diff 检查通过。安装测试使用的 Plugin cachebuster 已从仓库文件撤回，不进入 PR。

## 2026-09-29 平台统一的本轮验证

- Codex `PreToolUse` 在 macOS/Linux 返回相同 Unix `export`，Windows 返回 PowerShell `$env:`；三平台的引用转义、保留工具输入、非 Bash/缺字段 no-op 单测通过。macOS 上用真实 `sh` 进程分别执行两条 Unix 分支，子进程收到会话身份，原命令仍以 23 退出；编译 CLI 的 Mac Pre Hook smoke 也返回了预期的 `updatedInput`。
- CLI 与 Codex Plugin 共 327 项测试通过，1 项 Windows PowerShell 进程测试在 macOS 跳过；typecheck、lint（仓库已有警告，退出码 0）、格式检查、Plugin validator、站点构建及 OpenSpec 严格校验通过。更新后的本地 Codex Plugin 已安装，cachebuster 只存在于安装缓存，仓库 manifest 恢复原样。
- 本轮 Windows 虚拟机需要解锁口令，无法启动；当前宿主也没有 PowerShell 解释器。Linux/Windows 的真实 Codex 宿主、Windows 子进程继承与批准链路尚未验收，不能将静态测试或 macOS shell 测试说成跨平台实测。

## 2026-09-29 注入范围配置的本轮验证

- 默认模式以外层命令文本匹配独立 `lore`；实际读取用户级 YAML 的 `all-shell` 测试覆盖了无 `lore` 的脚本外层调用。三平台默认分支、组合命令、非 shell、坏配置 no-op 和原输入保留均有单测；编译 CLI 在用户原有自定义配置下的 `git status` 返回 `{}`、`lore get` 返回带会话身份的改写命令。没有修改用户配置。
- CLI/Plugin 完整相关测试 346 通过、1 项 Windows PowerShell 进程测试在 macOS 跳过；typecheck、lint（已有警告）、站点构建及 OpenSpec 严格校验通过。仓库级格式检查被本次范围外的 11 个旧文件挡住；本次变更的 TypeScript 文件另行检查。Linux/Windows 真实宿主链路仍属 4.3 的未完成边界。

## 2026-09-29 Agent 共用配置收敛

- `agent.shellSessionInjection` 替代未合并 PR 中的 Codex 专属字段。只改共享配置读取和当前消费它的 Codex Hook，不给其他宿主增加 Hook。测试确认旧 `codex` 字段不改变默认行为；编译 CLI 在隔离 HOME 读取 `agent: { shellSessionInjection: all-shell }` 时会改写外层 `sh read-practice.sh`，在用户现有配置下仍只改写带 `lore` 的命令。用户现有配置未修改，隔离测试配置已清理。
- CLI/Plugin 测试 346 通过、1 项 Windows PowerShell 进程测试在 macOS 跳过；typecheck、lint（已有警告）、站点构建、编译 CLI、Plugin 校验器、变更 TypeScript 文件格式检查及 OpenSpec 严格校验通过。Linux/Windows 真实宿主链路依旧没有验收。
