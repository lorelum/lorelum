# 重构验收约束

本文件约束 [design.md](design.md) 的实施，不是新增产品 capability。以下 SHALL/MUST 表示本 change 的行为保真与内部边界要求；未实施前不代表通过。代码依据固定为主线 `963963e`，来源表见 design 的 Context。

## 行为保真

| 编号 | 场景和输入 | 必须观察到的结果 | 基线依据 |
| --- | --- | --- | --- |
| B1 | 六宿主既有 Catalog 请求，使用相同隔离 Store | 目录数据和预算不变；Codex/Claude/WorkBuddy/ZCode 为嵌套 context，Cursor 为 additional_context，omp 为 additionalContext；不出现普通 CLI envelope，不自动 query/get | CLI hook 各宿主测试、pack-catalog.ts、omp.ts |
| B2 | Codex Bash 的 lore 命令，含额外 tool_input 属性 | 附加正确 host/session，保持其他输入字段；保留现行 allow；平台语法不变 | codex.test.ts、shell-association.ts |
| B3 | Claude Bash 与 PowerShell 的 lore 命令 | 语法由工具名决定，不因操作系统改变 Bash 语法；不返回 permissionDecision | claude.test.ts、host-hook.ts |
| B4 | Cursor 同时有 session_id 和 conversation_id，再仅保留后者 | 先使用 session_id，缺少时使用 conversation_id；仅用 updated_input，审批流不变 | cursor.test.ts、host-hook.ts |
| B5 | WorkBuddy/ZCode Bash lore 命令 | POSIX 注入；不增加 permissionDecision；保留原生 command/process 启动方式 | workbuddy.test.ts、zcode.test.ts、对应 hooks.json |
| B6 | 默认 lore-only 的普通 shell 命令、非 shell 工具、session 缺失；及显式 all-shell | 前三者按现行语义 no-op；all-shell 仍只按既有规则处理。不能让类型收紧开始拒绝允许的额外字段 | agent-settings.test.ts、各宿主 Hook tests |
| B7 | Codex/Claude 子 Agent 已读候选；Backend 缺失、超时、空候选 | 有候选时只输出有界 metadata；没有时不注入正文、不启动 Backend、不阻断宿主；保留 350ms 可选请求边界 | practice-hints/backend.test.ts、render.test.ts、各宿主 tests |
| B8 | Cursor/WorkBuddy/ZCode 的子 Agent 事件 | 不新增注册或模拟交付通道；保留原先不支持/空响应与诊断分类 | 对应 hooks.json、host-hook.ts |
| B9 | malformed JSON、非对象、unsupported event、Store 失败 | stdout 单行宿主响应，诊断在 stderr，Hook handler 退出 0；工具异常的 `{}` 与 ZCode continue 降级差异保持，不统一掉 | runHostHook、各宿主失败 tests |
| B10 | omp main、sub 默认关闭、sub 显式开启；有 Main 来源与无来源 | main Catalog 不受 sub 设置影响；关闭 sub 返回 `{}` 且不访问 Store；候选读取独立于 sub Catalog 设置；无来源不选别的 session | omp.test.ts、extension catalog.test.ts |
| B11 | omp switch/branch/tree/compact、并发 context、shutdown、嵌套 task/eval | 快照失效、pending 复用、旧读取隔离、临时 user 消息与权限层级保持；原始 Main 来源保留，child get 不并回 Main | plugins/omp/lorelum/extensions 下 tests 与实现 |
| B12 | get 成功而可选提示写入失败 | get 结果不变，记录仍由 Backend 所有；bridge read-hints 的错误诊断差异保留 | get-command.ts、practice-hints/backend.ts、omp.ts |
| B13 | 既有 --store-root/--debug 形式、重复参数、非法选项、未知 host；普通 CLI 调用 | 参数接受/拒绝及回落普通 CLI 的规则不变；普通命令输出不进入 Hook 原生响应；单次调用日志有统一关闭路径 | parseHostHookInvocation、main.test.ts、main.ts |

B1–B13 的行为覆盖应尽量迁移现有 colocated tests；新增测试只覆盖重构容易引入的消费者可见风险，不断言内部文件名或转发次数。

## 内部架构

- A1：公共 runner MUST 不包含原生事件、工具、session 字段或权限字段的 host 条件分支。输入解析及 fallback 的协议决定属于 adapter。
- A2：宿主 adapter MUST 拥有具体输入和输出类型；公共操作 MUST 不接收原始 payload，不以类型别名假装协议隔离。共享能力与宿主模块依赖方向单向。
- A3：main SHALL 只有一个 Hook 命令执行出口，参数只解析一次，日志在统一 finally 关闭；不得保留六份旧入口或旧入口 shim。
- A4：生产默认依赖 SHALL 在调用入口组装；普通服务和 adapter 不得通过隐藏默认实例重新组装。shell 无需 Store，关闭的 omp sub Catalog 不访问 Store，Catalog 不连接 Backend。
- A5：共享操作 SHALL 复用既有 Catalog renderer、shell quoting 和 Backend 可选请求策略；Backend 连接工厂不得继续位于 model/commands.ts。
- A6：MUST 不引入 BaseHook、统一任务事件、虚构能力默认实现、跨事件 CLI 状态或新的持久化。omp 状态与 Backend 状态保留既有所有者。
- A7：符号迁移 SHALL 用 LSP references 更新全部仓库调用者和 package barrel；旧中央分支、无用别名与转发出口删除，不留下两套路径。

A1–A7 由实施者在 typecheck 及源码审阅时逐项举证；不为内部组织添加源码字符串断言测试。

## 验证所有权与证据

实施者负责 B1–B13 与 A1–A7，已有有效验证不要求另一 Agent 重跑。按最终改动范围运行集中行为测试、相关包 typecheck 和非 embedding 源码 CLI smoke；每条证据写 commit/工作区状态、环境、输入、观察结果及未覆盖边界。

真实宿主证据与源码 smoke 分开：源码可以证明 JSON 形状，不能证明宿主消费、权限流程或模型可见性。影响这些边界的迁移须沿受支持安装方式验证，记录宿主/插件/CLI 版本及平台。不可用的宿主验收不得伪称通过；完成可达工作并明确缺失环境。

规划阶段只校验文档、相对链接和 OpenSpec 结构，不运行或宣称通过尚未实施的 B/A 项。已有 `963963e` 的 13 个源码 CLI 场景只是分析基线证据，不是未来重构验收结果。
