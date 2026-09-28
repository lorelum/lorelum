## 0. 已有证据，不等于修订方案已实施

- [x] 0.1 当前 worktree 已实现 Backend-owned 候选接口、旧的单文件会话路径及 Practice-hints 私有窗口；相关 Backend/CLI/Plugin 单元与协议测试通过，但这些测试只覆盖改方案前的代码。未发布，也没有真实子 Agent 可见性验收。
- [x] 0.2 在 Codex CLI 0.155.1 的 macOS app-server `permissions: ":read-only"` 临时会话，可信任的一次性 Pre Hook 返回 `permissionDecision: "allow"` 和保留原输入字段的 `updatedInput`。直接进程、`sh` 脚本、管道实际读到的环境变量哈希均与会话 ID 一致；没有写入用户配置或工作区。未验证 PowerShell、清空环境的命令及批准请求；只给出 `updatedInput`、不含 `allow` 时改写未生效。

## 1. 审查关口

- [x] 1.1 将修订后的 proposal、spec、design、tasks 交用户审查；用户明确同意前，不改生产代码、Plugin、双语用户指南或现有 Backend 文件。用户已明确批准实施并更新现有 PR。
- [ ] 1.2 实施前用安全的临时命令在真实 Codex 命名权限档位确认改写没有放宽原批准/沙箱合同，验证原工具输入的工作目录、超时和退出码保持不变；若不成立，先重新审查方案，不继续实现显式绑定。本轮只读探针确认 Hook 收到临时写命令、目标文件未创建且 Agent 报告权限错误，但未捕获独立工具退出记录，也没有覆盖批准请求，不算此项完整验收。

## 2. 审查通过后调整实现

- [x] 2.1 把会话路径规划为 `~/.lorelum/sessions/<hostKey>/<宿主原始 sessionId>/practice-reads.jsonl`，Codex 会话 ID 原样命名目录，Backend 统一计算并确保文件操作留在用户会话目录内；完整记录继续只由 Backend 追加，且不含 Pack 来源列表。验证权限、长会话、损坏末行、重启和 worktree 删除后仍可读。不迁移或删除未发布原型文件；若实施前发现真实旧文件先重新评估迁移。
- [x] 2.2 将窗口从 Practice-hints 私有服务移到 Backend 的公共 `sessions` 模块，定义唯一会话关联入口，显式身份优先、窗口仅作后备；写 README 说明当前 Windows 使用者、生命周期、近似归属与未来宿主复用规则。不得为新功能另建一套窗口，也不增加无需求的通用状态机。
- [x] 2.3 CLI 成功 `lore get` 后按共同 `SessionRef` 合同筛选成对环境变量；缺失或无效当作没有显式身份，不把坏值交给 Backend，随后仅尝试公共窗口后备。带有效身份时向已运行 Backend 报告候选与实际目录。保持文本/JSON、失败读取、独立终端、Backend 不可达时的结果/退出语义，不启动 Backend、不建备用清单。
- [ ] 2.4 Codex macOS 的 Pre Hook 仅对 Bash 保留全部原工具输入并给 `command` 前置安全引用的两个 `export`，不为窗口访问 Backend；非 shell no-op。Linux/Windows 保持现有 Pre/Post 窗口代码路径，分别通过真实宿主改写验证才可切换，不删除支持。保留 SessionStart Catalog 与 SubagentStart 的元数据提示。

## 3. 真实验收与文档

- [ ] 3.1 测试 Backend 显式身份和窗口后备的隔离、认证、同目录并行会话；确认 Codex 原始会话 ID 直接对应目录、候选与子 Agent 提示不含 Pack 来源；测试环境变量缺失/无效的后备与漏记、Hook 不改其他输入字段、未信任/缺字段降级、Codex/Linux/Windows 配置和上下文预算。Linux/Windows 的环境变量改写若要启用，分别另做真实宿主验证，当前窗口后备不能被默默撤掉。
- [ ] 3.2 用与源码匹配的 Backend 和真实 Codex 完成直接、脚本、管道内的成功/失败 `get`、工作区子目录与真实子 Agent 可见性；测无 Lorelum Bash 的 Hook 冷/暖开销及 `get` 报告额外时间。不能拿 Hook JSON 或旧单元测试充当真实子 Agent 收到提示。
- [ ] 3.3 实施后才同步英文/中文用户指南与 Plugin README，说明会话目录、显式绑定与 Windows 窗口后备的差异；运行相关 CLI/Backend/Plugin 测试、typecheck、格式、lint、OpenSpec 严格校验并审阅完整 diff。未通过真实宿主链路前不称自动注入已交付。

## 本轮验证记录

- 当前本机 `~/.lorelum/sessions` 不存在，旧 Backend 构建与 worktree 源码 build identity 不同；没有动用户正在使用的 Backend/CLI 或配置。
- app-server demo 使用临时目录 `/tmp/lorelum-hook-env-n9f8nI/`，设置命名只读权限档位、一次性已审 Hook 和临时信任绕过；用实际命令输出与线程 ID 哈希比较。该实验验证环境传递，不验证权限批准语义，也不覆盖 Windows。
- 此任务文件中的新实施与验收项均未开始；此前 Backend 205 通过、3 跳过，CLI 314 通过，Plugin 7 通过等结果只属于修改前的窗口版代码。
