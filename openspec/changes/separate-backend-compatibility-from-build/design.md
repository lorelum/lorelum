## Context

动机和产品路径分别见 [proposal.md](./proposal.md)、[product.md](./product.md)。以下证据定义现状，delta specs 定义拟议目标，不以 Issue 中“同协议所以语义完全兼容”的判断代替维护者的协议约束。

| 已核对来源 | Observed | Migration decision |
| --- | --- | --- |
| `scripts/release/compile-cli.ts` 的 `createCompileJob`；同目录 `compile-cli.test.ts` 的 identity 用例 | 每次编译随机生成身份；拷贝和重启同一 executable 保持身份 | 保留精确随机 ID；新增可读 provenance，不再用 ID 判断普通接入兼容 |
| `packages/backend/src/runtime/build-identity.ts` 的 `currentBuildIdentity` | source 身份包含 real checkout、六个生产 package、lock 和 native 源码 | 保留 source 精确身份算法，不新增整库校验；普通业务 client 不再为兼容接入计算本地 source hash |
| `packages/backend/src/client/client.ts` 的 `identify/request/control`；`client.test.ts` 的 cross-build 用例 | proof 和 record 归属验证后，仍要求当前 CLI build 相同；stop 豁免不传递到严格请求 | 删除当前 CLI build 比较及豁免开关；保留远端 identity 对 record 的精确匹配、proof 和 protocol |
| `packages/backend/src/runtime/supervisor.ts` 的 `start/stopIfIdle/stopVerified` 与对应测试 | 单 startup lock、activity guard、跨协议已拥有进程回收均存在 | 复用这些机制完成显式 current-build 切换，不创建新锁、队列或第二套停止实现 |
| `packages/backend/src/modules/backend/model.ts`、`service.ts`；`runtime/runtime-state.ts` | identity、status、record 都是严格 DTO；status 只提供不透明 ID | 只扩展认证后的 status；identity bootstrap 和 record 结构保持不变 |
| `packages/cli/src/registry.ts`、`create-program.ts`、`output/presentation.ts` | version data 是静态框架 response，文本只显示 tool/envelope protocol | 将 version 数据按实际调用延迟生成，发现 schema 仍归 registry |
| `openspec/specs/backend-runtime/spec.md`、`retrieval-query/spec.md` | 当前合同明确拒绝跨 build | 本 change 必须替换相关完整 requirement/scenario，不能仅追加相互冲突的新场景 |

内部 Backend `PROTOCOL_VERSION` 为 3，CLI envelope `protocolVersion` 为 2，包版本为 `0.1.0-alpha.6`；这些是本次检查的基线，协议迁移见下文。

## Goals / Non-Goals

**Goals:** 兼容性规则只由 Backend client 的协议接入负责；精确构建归属继续可验证；开发者一次明确操作即可确保运行目标构建；可读信息不追读变化后的 worktree。

**Non-Goals:** 不增加客户端版本范围矩阵、feature negotiation、额外 semantic epoch、worktree daemon、环境变量配置或 native ABI 规则；不改变 Store/index/embedding Profile 身份、事务、认证、私有文件、PID 或 child-process 检查；不修改 release workflow 和安装器。

## Decisions

### 1. 精确归属与协议兼容各自有唯一职责

`client.identify` 继续验证 nonce proof，以及远端 instance/build 对 runtime record 的精确匹配；远端 protocol 还须匹配 record，再与本客户端所需协议比较。record 与握手身份不一致属于 `backend.state-invalid`，真正与当前客户端不同协议属于 `backend.protocol-mismatch`。普通受保护请求不再要求与 CLI build 相同。

删除 `CreateBackendClientOptions.buildIdentity` 与 `allowCurrentBuildMismatch`，连同缓存接入后的当前 build 比较一起删除；stop 和普通请求不再需要两种 build 接入模式。缓存只表示当前实例已经完成接入；认证失败和实例退出仍不换实例、不重放业务。`control` 的 status 对 record instance/build 关联校验保留。

`runBackendDaemon` 在启动 grant、PID、record build 与自身 build 之间的严格核对保留。这防止错启动、错记录，不是新的兼容性门槛。`buildIdentity` 继续用于日志关联和 `sameBuild`，不改成人类可读字符串。

协议号承担 wire、操作语义、共享持久化/派生状态的兼容承诺。改变这些约束的实现须提升 Backend 协议并附契约测试；普通修复不因 commit 不同另设 epoch。这里不证明所有历史同协议分支必然等价，也不尝试推断任意 PR 的兼容性。

### 2. provenance 由代码入口生成，Backend 自持启动快照

在 `packages/backend/src/protocol/build-provenance.ts` 定义唯一可传输类型及 schema：

```ts
type BuildProvenance = Readonly<{
  toolVersion: string;
  revision: string | null;
  dirty: boolean | null;
  buildKind: "compiled" | "source";
}>;
type BuildInfo = BuildProvenance & Readonly<{ buildIdentity: string }>;
```

`runtime/build-info.ts` 新增 `currentBuildInfo(entrypoint: string, toolVersion: string): Promise<BuildInfo>`，复用 `currentBuildIdentity`。它只负责本地采集，不做兼容裁断、HTTP 或生命周期控制。source 模式从 entrypoint 所属 checkout 读取 Git revision 和非忽略的工作树修改状态，不能依赖命令 cwd；Git 不存在、不是仓库或无法可靠读取时相关值为 null，而非声称 clean。它不暴露绝对路径、remote、分支名、用户名或 host。source 的 `toolVersion` 由 CLI 包已有常量传入，Backend 不反向依赖 CLI。Git 读取集中在同模块的 `readBuildProvenance(checkoutRoot, toolVersion, buildKind)`，供 source 与编译入口共用，不复制 dirty/unknown 规则。

`scripts/release/compile-cli.ts` 在 `createCompileJob` 中采集一次编译仓库 provenance，将 `LORELUM_BUILD_PROVENANCE` 与既有 `LORELUM_BUILD_IDENTITY` 一起交给 Build API/CLI 两条编译路径。包版本来自 CLI package manifest；保留完整 commit，dirty 包含 Git 可见的未提交内容，不包括已忽略的构建输出。没有 Git 时仍可编译。复制产物或离开仓库运行不重新探测 Git，不做 executable 哈希。不要为 codex/claude 目录名引入 host 标签配置。

CLI 内部 daemon 分支在 `main.ts` 采集一次 BuildInfo，传入 `runBackendDaemon({ build: info })`。daemon 仅把 `buildIdentity` 用于原有启动核对，把 provenance 显式挑选后冻结在 `createBackendService` 中，由认证后的 status 返回。record 和 platform environment 不承载新字段；status 不读取 executable 路径、磁盘或 Git。

Backend v4 的 status 保留 state/model/instanceId/buildIdentity，并在运行中增加 `backendProtocolVersion` 与 `build: BuildProvenance`；stopped 不伪造远端字段。CLI 的 `toResult` 组合本地 `cli: BuildInfo & { backendProtocolVersion: number }`，运行时再给出 `sameBuild` 和 `protocolCompatible: true`。HTTP 不回传“调用方 CLI 信息”，它不拥有该事实。JSON 保留完整 ID/revision，可读文本用短 ID、短 revision 和 dirty/unknown 标识。

### 3. version 延迟生成，不扩张成通用框架

新增 `packages/cli/src/version.ts` 的 `createVersionData(entrypoint: string): Promise<VersionData>`，结果是既有 protocolVersion/toolVersion 加 BuildInfo 字段和 `backendProtocolVersion`。`create-program.ts` 只在参数验证后真正执行 version 分支时调用它；`registry.ts` 的 version response 保留 command、resultSchema、textRenderer，删除静态 response.data 及相应快照克隆代码。`output/format-selection.ts` 仍只用 response.command 做命令识别，不触发元数据采集。

不引入所有命令可选 resolver、通用 provider 或全局构建状态服务；同一条 version/static discovery 双路径不共存。help/describe 不计算 hash、不运行 Git、不创建 supervisor。`renderVersionText` 只做纯展示。compiled version 不需要 runtime、model 或 Git。

### 4. 显式 start 保证本次代码，默认 start 保持兼容复用

CLI 的 `backend.start` 单独注册 `--current-build`，status 不接受该选项。supervisor 继续拥有 command、精确 build ID 和生命周期决策，最小接口为：

```ts
type BackendStartResult = BackendStatus | BackendHandoffDeferred;
type BackendHandoffDeferred = Readonly<{
  state: "deferred";
  reason: "active-long-task" | "unknown-activity";
}>;

// 同一实现的 overload，避免普通调用方被迫处理不可能出现的 deferred。
start(): Promise<BackendStatus>;
start(options: { requireCurrentBuild: true }): Promise<BackendStartResult>;
```

`createProcessBackendSupervisor` 仍从调用 executable/source 入口组装启动 command，只取原本启动归属所需的精确 build ID；它不为默认业务接入额外采集 Git provenance。为显式 Backend 命令的 composition 增加内部 `buildIdentity?: string` 参数：handler 先从 `BackendCommandServices.currentBuildInfo()` 获取本地 BuildInfo，再将其 ID 传给 createSupervisor，输出复用同一对象，不重复扫描 source；默认业务启动不传此参数并沿用原路径。该数据不跨 CLI invocation 缓存，不扩展用户 options 或配置。CLI handler 在选中显式选项时调用 `start({ requireCurrentBuild: true })`，deferred 走已存在的 exitCode 1 能力，成功 start/status 共享 provenance 展示；普通 start 保持 exit 0/2，显式选项使命令 schema 声明 0/1/2。

整个决策持有同一个 startup lock：读取有效 record，无实例则沿既有 launch；同构建同协议通过 client status 确认 ready 后复用；其他已拥有实例调用私有 `stopIfIdleLocked`，deferred 立即返回，stopped 后才启动当前入口。把现有 stopIfIdle 的锁内编排提取为该私有函数，公共 stopIfIdle 继续负责取锁。禁止在持锁期间调用公共 start/stop/stopIfIdle，避免递归取锁。

v4 的 idle 决定由 daemon 而非 supervisor 作出：现有认证 `POST /stop` 新增可选 `{ifIdle:true}`，不新增 endpoint。Backend service 在认证后的业务接入处维护一个仅内存的在途请求计数，app 的请求结束/错误 finally 释放；identity/status/stop 不算业务占用。guard 发现已有请求就返回 active-long-task；零请求时在同一同步段关闭 admission，再获取既有 activity lock 检查后台操作和有效 lease、写 `handoff-stop`。deferred 则重开本次关闭的 admission，但不得覆盖并发普通 stop 的永久 stopping。supervisor 只解码一次结果并等待原有进程退出，不能先写 marker，否则会干扰已接收请求的后续模型/index 准备。

v4 的 lease 只在 `expiresAt > now` 时保留占用，过期不等于真实状态未知；原有持锁写入可顺便清理过期项，不加 timer 或 owner PID 扫描。activity record 损坏、实例归属不明仍是独立 unknown 边界。v3 不支持新的 admission/stop 模式，继续原私有 activity guard 和跨协议 owned-process 停止，expired lease 也按旧规则 unknown；这条兼容路径只能承诺原有后台操作保护，不能声称覆盖其所有普通请求。

activity lock 仅包住后台 assessment 与 `handoff-stop` 标记，随后释放；停止、等待 native/daemon 退出和 launch 都不持有 activity lock，避免阻挡 daemon 的状态更新。复用现有 stop failure marker 清理、进程身份核对和跨协议停止路径。shutdown 使用原 shutdown budget，之后为新 launch 创建完整 startup budget，不把停止耗时算作新进程冷启动预算。不增加自动重试、持久队列或失败后自动回退旧代码。

占用边界只覆盖 Backend 实际接收的请求、拥有的后台操作和未过期显式保留，不推断其它 Agent 会话、编码任务或模型常驻。新增内存计数保护的是只有 daemon 能原子决定的并发 admission，不是重复执行 CLI/schema/身份检查。该判断依据 `agentic-coding.implementation.validate-at-the-owning-boundary`：先说清每项检查证明的事实与所有者，不因多一层就多一次校验。

不选择 `backend restart --if-idle`：重启已是本构建的实例没有收益；不选择“默认每次自动换到新 build”：会在查询副作用中干扰其他 host，仍然反复丢失暖模型；不选择“只删 build 检查”：新代码验证可能悄悄由旧 Backend 执行。

### 5. 保持 bootstrap 与 record 不变，一次升级 status 协议

status 的 strict decoder 不接受新增字段，故 Backend 内部协议从 3 升到 4；CLI envelope 保持 2。identity 的 `{instanceId, buildIdentity, protocolVersion, proof}` 及 HMAC 序列完全不变，runtime record 也不增加字段。新 CLI 可用旧结构验证 v3 实例，再准确返回 protocol-mismatch；不向 v3 请求不兼容 status、不把旧 schema 错误误归为 port-conflict。

protocol-mismatch message 在 client 根据已认证 identity 与本地协议生成，保留完整既有 guarded stop→start→原命令指导；精确本地 BuildInfo 在 CLI 捕获该特定错误时延迟采集并添加。新增 `packages/cli/src/backend/error.ts` 的单一异步错误映射函数负责这一步，query/model/index/control 的原捕获点统一调用它，不各自拼文案或采集 Git；其他错误保持既有映射，resource 不丢失。显式命令已有的本地 BuildInfo 直接传入复用。远端 toolVersion/provenance 无法获得就标 unknown，显示已认证的完整 build ID 与协议号，不为读取旧版本另发请求。不要把 provenance 加到未认证 identity，亦不创建第二套跨协议诊断 endpoint。

同协议不同 build 不再产生 `backend.build-mismatch`。保留错误码枚举仅用于旧错误输入的识别/已有消费者兼容，默认构造也改成明确“重试以确认协议并查看双方状态”的历史错误指导，不新增生产抛出点；`backend.incompatible` 的泛称也不得再宣称当前 build 相同是复用条件。不添加结构化 recovery policy。

旧 CLI 对新协议仍可能因严格 status decoder 失败；不承诺修复旧二进制。较新 CLI 可用原有 owned-process guarded stop 路径停止 v3/v4，回退前先用它停止本实例。普通 release installer 的交接仍归 `stop-backend-before-cli-upgrade`，不修改其 artifacts 或安装脚本。

协议错误包含双方完整 ID、revision 与恢复指令，实测超过既有错误展示的 400 字符上限。仅对 `backend.protocol-mismatch` 将展示上限提高到 2048；保留终端控制字符转义，其他错误仍使用原上限，text/JSON 使用同一完整安全文本。不为展示问题增加身份请求或恢复策略。

### 6. 调用路径与检查必要性

`query/query-command.ts` 经 `query/runtime-client.ts` coordinator、supervisor 和 client 到 daemon 的 query controller，再由 Engine 执行检索。原拒绝发生于 `identify` 的本地 build 比较；删除它后，协议兼容的请求继续原有业务、取消和资源释放路径。显式切换由 CLI 选项触发 supervisor 的同锁交接，ready 来自新实例；不在 query 中隐式执行。

按 `agentic-coding.implementation.justify-added-checks` 复核：

- 保留握手认证、record 归属与协议匹配，分别证明连接身份、进程归属和兼容性；不把 CLI build 相同继续当作前置条件。
- 删除 status 协议号二次比较：握手已经验证，status 来自同一不可变值，没有新来源或转换风险。既有 instance/build 关联保持不变。
- 删除新 controller 的旧协议能力开关：真实旧实例运行旧 binary，兼容分流归 supervisor，不用新实现伪装旧协议来证明额外拒绝必要。
- 保留请求计数、关闭接入和 activity lock：它们分别保护在途请求及请求之外的后台工作/lease 竞态；不加进程扫描、额外 hash、timer 或重试。

维护时，构建展示变化只影响采集和 formatter；query 的破坏性语义变化由协议与契约测试管理，不引入第二套兼容标记。

## Risks / Trade-offs

- 同协议不同代码被默认复用：开发者要用显式 current-build，status 始终提供双方身份；这不是为每条 query 添加警告的理由。
- provenance 不是可重现构建证明：同 commit/dirty 状态可能有不同输入，精确 ID 仍保留，release checksum/native 校验独立保留。
- 真正换 Backend 会丢失内存中模型：只有显式开发切换或真正不兼容才承担成本，不声称可以热迁移。
- v3 缺少版本信息：如实 unknown，接受一次 guarded 协议交接；不以观测性需求扩张 bootstrap/record。
- 单次 start 不是会话独占：不增加锁定模式，已有 lease 保持对长任务的保护。
- 协议升级必须覆盖操作语义/缓存兼容：兼容承诺由维护者通过合同与测试管理，不用代码哈希替代这个责任。

## Migration Plan

交付顺序与行为验证见 [tasks.md](./tasks.md)，真实运行证据见 [validation.md](./validation.md)。保留旧身份算法、record 和 bootstrap；回退时先用新 CLI 停止本实例，再运行旧 CLI，不迁移 canonical Store、Pack 或模型缓存。安装器与发布 workflow 不在范围内。
