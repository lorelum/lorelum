# backend-runtime Specification

## Purpose
定义本机 Backend 的控制面、身份认证、生命周期和数据边界，使 semantic runtime 可复用而不会把 loopback 服务误暴露为远程接口或 Store 事实来源。
## Requirements

### Requirement: Private loopback lifecycle
Backend SHALL 仅监听固定 loopback authority `127.0.0.1:26186`。`lore backend start` MUST 安全复用兼容实例或启动新实例，`lore backend status` MUST 保持只读，`lore backend stop` MUST 仅在 daemon 实际进入停止流程后报告成功；这些命令 MUST 不使用 `--store-root` 选择模型、配置或服务地址。

#### Scenario: Repeated lifecycle control
- **WHEN** 调用方对已运行或已停止的 Backend 重复执行 start、status 或 stop
- **THEN** 命令 MUST 返回与实际 lifecycle 状态一致的 JSON 结果，且 MUST 不按端口号或进程名终止未经认证的进程

### Requirement: Authenticated local control boundary
Backend client MUST 在首次向一个 daemon instance 发送受保护业务请求前验证 nonce-bound instance identity、远端 build 对 runtime record 的精确归属和内部协议兼容性；同一 client 后续业务请求 SHALL 沿用该接入身份而不重复发起 identity 挑战，并 MUST 继续携带 runtime credential。显式身份识别和新 client 接入 MUST 重新验证。通过归属验证且 Backend 内部协议相同的不同 CLI/Backend build MUST 允许普通控制与业务请求，不得因精确 build 不同拒绝复用；同协议代表 wire、操作语义与共享状态兼容的维护者承诺，破坏该承诺的变更 MUST 提升内部协议。Backend MUST 拒绝不符合 loopback authority、Host、Origin、body-size 与认证边界的请求，且 MUST 不向响应泄露 runtime secret、本机私有路径、native 私有端口或原始 Practice/query 输入。

#### Scenario: Untrusted local HTTP request
- **WHEN** HTTP 请求缺少有效认证、携带 Origin、使用错误 authority 或超过 body 限制
- **THEN** Backend MUST 拒绝该请求，且响应 MUST 不泄露 daemon runtime detail

#### Scenario: Repeated requests on one verified client
- **WHEN** 同一 client 已完成 daemon 接入验证并继续发出状态或业务请求
- **THEN** 后续请求 MUST 使用该实例的 credential 而不额外请求 identity；认证失败或实例退出 MUST 返回既有错误，不自动切换实例或重放业务

#### Scenario: Strict request follows cross-build stop access
- **WHEN** client 已识别另一个 build 的实例，且归属与内部协议核验均通过，随后提交普通业务
- **THEN** 请求 MUST 正常提交，MUST 不因 CLI 与 Backend 精确 build 不同返回 backend.build-mismatch；不同协议的业务请求 MUST 继续被拒绝

#### Scenario: Presented build differs from the owned record
- **WHEN** 远端 proof、instance、build 或协议不能与 runtime record 的归属相互印证
- **THEN** client MUST 保留对应身份或状态错误，MUST 不把它降级为可复用的跨构建差异，不提交业务或终止未经归属的 listener

### Requirement: Trusted local filesystem scope
本地 runtime SHALL 信任正常同用户环境中的路径组织，不得仅因可信祖先目录是 symlink 拒绝操作。凭据/runtime 私有叶节点的权限、文件类型和安全终止进程所需 PID/启动时间核对 MUST 保持有效；本要求不得引入远程监听、放宽浏览器请求边界或自动终止未拥有进程。

#### Scenario: Runtime below a normal symlinked parent
- **WHEN** runtime 私有目录位于正常可访问的 symlink 祖先之下，且私有叶节点属性符合既有规则
- **THEN** Backend SHALL 正常读取或创建自己的 runtime 数据，不因祖先链接本身返回 state-invalid

### Requirement: Engine and Store responsibility boundary
Backend SHALL 承载模型、认证、进程和 operation 生命周期，但 MUST 通过 Engine use case 执行 Practice 读取、检索、index 与排名规则。keyword retrieval MUST 保持 `CLI → Engine` 的离线路径；semantic 运行 MUST 保持 `CLI → Backend client → Backend daemon → Engine`，且不得引入 `CLI → Engine → Backend client` 路径。

#### Scenario: Semantic request selects a Store
- **WHEN** semantic request 携带 selected Store root
- **THEN** Backend MUST 将该 root 作为 Engine 的 Store/index 输入，而不得把它解释为模型、runtime 或 Backend 配置选择器

### Requirement: Daemon-owned embedding runtime parent liveness

Backend daemon 拉起 embedding native runtime 时 MUST 在 spawn 环境携带 parent-liveness opt-in（`LLAMA_PARENT_LIVENESS_STDIN=1`），使 owner-death 快速退出语义仅作用于 daemon-owned 进程。embedding runtime 在启动阶段退出时，daemon MUST 在有界重试后返回稳定终态 embedding 错误，MUST 不将启动期退出表示为无限期 pending 或仅以 deadline 错误收场。

#### Scenario: Spawn carries liveness opt-in

- **WHEN** daemon 启动 embedding native runtime
- **THEN** spawn 环境 MUST 包含 `LLAMA_PARENT_LIVENESS_STDIN=1`，且该变量 MUST 不出现在其他非 daemon 拉起路径

#### Scenario: Runtime exits during startup

- **WHEN** embedding runtime 在启动探测阶段以 exit 0 退出且无任何输出
- **THEN** daemon MUST 在有界重试后以 `embedding.failed` 终态失败结束该次启动，MUST 不无限等待至 deadline

### Requirement: Actionable cross-command Backend errors
Backend protocol mismatch SHALL 返回 backend.protocol-mismatch 及完整可执行 message。query、model status/load、index status/build/rebuild/operation、普通 backend start/status MUST 使用相同的恢复指导；默认 text 与 JSON error.message MUST 使用同一完整文本。message MUST 包含当前 CLI 的已知构建信息、已认证远端的完整 buildIdentity、双方 Backend 内部协议号；远端无法提供版本或 provenance 时 MUST 明示 unknown，不得猜测或套用本地版本。错误合同 MUST 不构造或传播 compatibility recovery policy；diagnostics 与独立 ResourceFailure MUST 保留。

message MUST 指示先执行 `lore backend stop --if-idle`，仅在 stopped 后执行 `lore backend start`，成功后重试原命令；deferred 时 MUST 说明不后台重试、不未经用户明确同意调用普通 stop。query 和 status MUST 不因 mismatch 自动停止实例。同协议但 build 不同 MUST 不返回 backend.build-mismatch。

#### Scenario: Command matrix encounters build mismatch
- **WHEN** query、model status/load、index status/build/rebuild/operation 或普通 backend start/status 与已验证、同内部协议但 build 不同的实例连接
- **THEN** 每个命令 MUST 按其正常行为执行，MUST 不因该 build 差异停止 Backend、重载模型、返回 mismatch 或自动重放原请求

#### Scenario: Command matrix encounters protocol mismatch
- **WHEN** 上述命令遇到已验证但 protocol 不同的实例
- **THEN** 命令 MUST 返回 backend.protocol-mismatch 和含双方已知身份、双方内部协议的完整指导，不要求旧 CLI、不自动杀进程，也不读取策略对象决定下一步；旧实例版本缺失 MUST 显示 unknown

#### Scenario: Backend is unavailable to a non-starting command
- **WHEN** 只读 model/index 状态或其它按既有合同不自动启动的命令发现 Backend 已停止
- **THEN** 命令 MUST 返回 backend.unavailable，message MUST 提示 `lore backend start` 后重试原命令，且 MUST 不为了状态读取启动或停止实例

#### Scenario: Specific ownership or listener failure
- **WHEN** runtime record 权限/ownership 无法验证或固定端口属于无关 listener
- **THEN** 命令 MUST 返回对应具体错误及修正方向，不给必然失败的泛化 stop 建议、不删除有效记录、不终止无关服务、不泄露私有 secret

#### Scenario: Authentication failure is not a handoff signal
- **WHEN** 与 listener 的认证或身份核验失败
- **THEN** 命令 MUST 保留具体错误及针对性 message，MUST 不忽略失败后尝试 signal、启动替代服务或假定 mismatch 可以恢复

### Requirement: Guarded stop preserves safe refusal
`lore backend stop --if-idle` SHALL 继续使用既有 ownership 核验、lifecycle lock、activity 与 task lease。只有明确 idle 才可停止；active 或 unknown MUST 返回 deferred 而不 signal、不删记录、不取消任务。AI MUST 不将 deferred 变成后台重试、退避队列或未经用户明确同意的普通 stop。

协议 4 的 Backend MUST 在自己的业务接入边界原子判断已接收请求与停止接入，任一在途业务请求 MUST 阻止 guarded stop；没有在途请求才可检查后台操作与未过期 lease。lease 的有效期结束 MUST 不再构成占用，不得仅因其过期永久返回 unknown。模型常驻或外部 Agent 会话存在 MUST 不作为活动依据。旧协议实例 MUST 保留其既有后台操作、lease 和安全停止合同，不得被宣称具备新版在途请求保护。

#### Scenario: Active long task refuses recovery
- **WHEN** guarded stop 发现模型准备、index operation 或有效 Agent lease
- **THEN** 它 MUST 返回 state deferred、reason active-long-task，实例和任务保持运行；AI MUST 报告安全拒绝，不后台重试或自行强停

#### Scenario: Unknown activity refuses recovery
- **WHEN** 私有 activity 无法可靠确认 idle
- **THEN** guarded stop MUST 返回 deferred、reason unknown-activity，不发 signal、不清理记录；AI MUST 不因等待而推断已经安全 idle

#### Scenario: An accepted request prevents an idle handoff
- **WHEN** 协议 4 Backend 已接收的业务请求尚未结束，调用方请求 guarded stop
- **THEN** Backend MUST 返回 active-long-task deferred，原请求继续执行；请求结束或失败后 MUST 释放其占用，新的请求与停止接入之间 MUST 不存在被遗漏的并发窗口

#### Scenario: An expired lease no longer reserves the backend
- **WHEN** 协议 4 Backend 没有请求或后台操作，且只有到期 lease
- **THEN** guarded stop MUST 可继续，不能仅因为过期 lease 返回 unknown；未过期 lease MUST 仍阻止交接，且不得为了判断到期扫描其持有人进程

#### Scenario: Real stopped start original retry proof
- **WHEN** 隔离真实 runtime 的原命令产生 protocol mismatch，且实例已验证 idle
- **THEN** 验收 MUST 观察 guarded stop 返回 stopped、旧 daemon 确实退出、backend start 建立当前实例、相同原命令得到真实结果或 preparing；仅 error/envelope fixture MUST NOT 代替该证明

#### Scenario: Model and native resources retain independent errors
- **WHEN** 模型/native 文件校验失败或 model/index 状态携带资源故障
- **THEN** 兼容性调整 MUST 不删除 resource 的逻辑文件、check、可用 expected/actual size 或 digest，也不更改现有模型/index 状态语义、用户配置、Pack/Practice 或缓存

### Requirement: Explicit current-build start is an idempotent guarded handoff
`lore backend start --current-build` SHALL 在没有 Backend 时启动本 CLI 对应的 Backend，在已有同 build 且同协议的 ready 实例时复用；遇到其他已拥有 build 或协议时 MUST 只在既有 guarded-idle 条件满足后停止旧 daemon 及其 native 子进程并启动当前入口。ready MUST 代表当前构建的实际实例，而不只是兼容旧构建。默认 start MUST 继续复用兼容的不同构建，不执行此交接。

切换遇到 active-long-task 或 unknown-activity MUST 返回 `state: deferred` 及对应 reason，以 exit 1 结束，保留旧实例，不后台重试、不强停、不重放业务。成功 ready MUST exit 0；真实停止或启动错误 MUST exit 2。同一次显式选择、停止与启动 MUST 串行完成，不允许竞争启动产生两个本产品 daemon。

#### Scenario: Current build is already running
- **WHEN** 开发者重复执行显式 current-build start，实例的精确 build、协议匹配且 ready
- **THEN** 命令 MUST 返回原 instanceId，不停止模型、不替换进程，也不隐藏 model failed 状态

#### Scenario: Another idle build or protocol owns the backend
- **WHEN** 显式 current-build start 发现另一已拥有的 idle build 或协议
- **THEN** 它 MUST 等待旧 daemon 及已拥有 native 子进程退出，再启动当前入口并返回新实例的实际 ready 状态

#### Scenario: A lease or unknown activity prevents switching
- **WHEN** 显式 current-build start 遇到模型准备、index operation、有效 lease 或无法确认活动
- **THEN** 它 MUST 返回对应 deferred 和 exit 1，MUST 不启动替代实例、不停止旧实例、不将兼容旧实例报告为已切换

#### Scenario: Replacement startup fails after a confirmed stop
- **WHEN** 旧实例已退出而当前入口启动失败
- **THEN** 命令 MUST 返回具体启动错误与可执行的下一步，不伪造 ready、不自动重启旧 build，也不把已停止的旧实例描述为仍可用

#### Scenario: Competing starts do not create duplicate daemons
- **WHEN** 默认 start 与显式 current-build start 并发
- **THEN** 生命周期决策 MUST 串行化，每次 ready MUST 对应实际实例，系统 MUST 不遗留两个同时拥有该固定 Backend authority 的 daemon
