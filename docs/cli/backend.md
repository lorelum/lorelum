# Backend 命令

当前可观察合同见 [backend runtime OpenSpec](../../openspec/specs/backend-runtime/spec.md)；本页说明 CLI 生命周期命令与输出细节。

`lore backend start/status/stop` 管理固定监听 `127.0.0.1:26186` 的本地后台服务。命令不使用 LocalStore，`--store-root` 不改变服务地址、模型或配置来源。

## 启动

```sh
lore backend start
lore backend start --current-build
```

首次 start 由 CLI 应用组装层调用独立 config 包创建缺失的共享配置文件；已有配置不会覆盖。普通 `start` 等待内部 Backend protocol 兼容且经过认证的实例报告 ready 后退出 `0`。它会复用其他 build 的兼容实例，不因 `buildIdentity` 不同而重启或重载模型；启动本身不会下载或加载模型。随后可执行 [model load](model.md)。

`--current-build` 只属于 `backend start`，不适用于 `status` 或其他命令。它要求运行本次 CLI 对应的精确 Backend build：没有实例时直接启动；已是当前 build 时复用；其他已验证实例只有在可安全 handoff 时才停止并启动当前 build。活动或无法确认时返回 `state: deferred` 和 `reason`，退出码为 `1`；成功 ready 退出 `0`，真正失败退出 `2`。这不是普通 `start` 的默认行为。

`lore --version` 可在不连接 Backend 的情况下显示 CLI 版本、CLI envelope protocol、Backend protocol 与 build provenance。两个协议号各有用途：CLI envelope 为 `2`，Backend 内部协议为 `4`。文本使用短 ID/revision；`--version --json` 保留完整 `buildIdentity`、`revision`、`dirty` 和 `buildKind`。Git 信息不可用时，revision/dirty 显示为 unknown，而不是推断为 clean。

运行中的 Backend status 输出也会显示双方 build。文本示意：

```text
Backend: ready; model: ready
Backend build: <版本> <source|compiled> <revision>; id <短 ID>; protocol 4
CLI build:     <版本> <source|compiled> <revision>; id <短 ID>; protocol 4
Same build: no; protocol compatible: yes
```

对应的 JSON data 同时保留两边的完整信息：Backend status 含 `backendProtocolVersion` 与启动时冻结的 `build` provenance；CLI status 命令额外含本地 `cli` provenance、`sameBuild` 和 `protocolCompatible`。没有 Backend 时只返回 `state: stopped`、`model: unloaded` 和本地 `cli`，不虚构远端 build 或比较结果。

## 状态

```sh
lore backend status
```

只读，不启动后台进程、不加载或扫描模型。没有服务时成功 data 为 `{"state":"stopped","model":"unloaded","cli":{...}}`；协议兼容的运行实例会展示 backend 与 CLI 的 build provenance、协议号和是否同 build。遇到 protocol mismatch 时返回具体错误，而不是伪造兼容 status。模型失败时 Backend 仍可 ready，详细原因看 `lore model status`。

## 停止

```sh
lore backend stop
# Agent-only safe handoff; it never stops active or unknown work.
lore backend stop --if-idle
```

不带参数的 `backend stop` 是明确运维动作：它请求经过身份验证的实例停止，取消下载或卸载模型并等待 daemon 退出。对于 protocol-compatible 的旧 build，它继续使用 authenticated stop；对于 protocol 不兼容但 ownership 仍可由私有 runtime record、PID 和启动时间精确验证的旧 daemon，当前 CLI 会先发本地 graceful termination，超时后只终止同一已验证 lifecycle。它不依赖已经被升级删除的旧 CLI，也绝不按端口或名称终止陌生进程。

`backend stop --if-idle` 是按错误消息使用的受限安全恢复动作。Backend protocol 4 会先同步关闭新业务请求准入；已有已准入请求会返回 `deferred` / `active-long-task`，不会在请求后再写 handoff marker。没有在途请求时，它在 activity lock 内检查模型准备、index operation 和有效 task lease，再原子写入 handoff marker。Lease 仅在 `expiresAt > now` 时有效；过期 lease 不再阻止停止，也不需要扫描持有人进程。模型仅仅已加载、另一个 Agent/聊天正在工作，都不算 Backend 活动。损坏或归属不明的 activity 仍返回 `deferred` / `unknown-activity`。

Backend protocol 3 没有在途业务请求 admission 保护，仍按旧 activity/lease 规则判断；旧规则下过期 lease 可能被视为 unknown 并 defer，因此不要把 v3 handoff 描述成覆盖所有普通请求的原子保护。无论版本，若返回 `deferred`，都不打断现有任务、不后台重试；只有成功停止后才继续启动或重试原命令。

支持的 host Agent 通过 `backend lease acquire`、`renew`、`release` 管理不含任务内容的短期 opaque lease。它们是机器集成控制面，不要求普通用户手动维护。

## 配置与错误

用户可编辑的配置、默认值、环境变量和生效时机见[配置指南](https://lorelum.com/zh/docs/configuration)。backend lifecycle 命令会读取并验证 backend/embedding 配置；这两部分修改不会热更新运行实例，重复 start 也不会刷新快照。CLI 的 `query.retrievalMethod` 不属于该 daemon 快照；semantic query、index status/build/rebuild 和安装后的同步每次重新读取并按请求选择 Profile，无需重启，详见 [配置维护边界](../configuration/README.md#query-方法与前台预算)。

失败退出 `2`，输出 `ok:false` 的 [CLI envelope](README.md)。常见错误：

| code | 处理 |
| --- | --- |
| `backend.port-conflict` | 固定端口属于未验证的服务，检查占用 |
| `backend.protocol-mismatch` | Backend 内部 protocol 与 CLI 不兼容；同 protocol 的跨 build 本身不构成错误。按完整 message 安全停止旧 Backend 后再 start，并重试原命令；deferred 时保留实例与任务 |
| `backend.incompatible` | 非 lifecycle 的兼容性问题，例如 encoding/profile 不匹配；它不是自动 handoff 信号 |
| `backend.config-invalid` | 修正 YAML、未知字段或越界值 |
| `backend.state-invalid` | 私有运行记录或权限无法安全使用 |
| `backend.deadline-exceeded` | 操作未在配置预算内达到目标状态 |
| `backend.unauthorized` | 身份或认证校验失败 |
| `backend.unavailable`、`backend.busy`、`backend.failed` | 查看服务状态，按错误原因恢复 |

## 构建与支持范围

开发 backend 生命周期、配置或 keyword 行为时，不需要 native candidate。只有源码验收涉及 `model load`、embedding 或 semantic index 时，才先执行 `bun run build:native`；它把 candidate 放在 `packages/backend/.artifacts/native/embedding/<target>/`（当前 target：`darwin-arm64`、`linux-x64`、`win32-x64`），供源码 backend 校验和启动。

`bun run build:cli-only` 只生成 `dist/lore`，不携带配套 native runtime，适合非 embedding 的编译检查。要从 compiled CLI 验证模型加载或语义检索，执行 `bun run build:cli`，并使用完整的 `dist/release/<target>/` 目录；CLI 必须与匹配的 `native/<target>/` runtime 保持在同一目录中。旧命令 `build:release-staging` 与完整本地构建等价，两者都不发布版本；只有验证最终 archive/package 时才执行 `bun run build:release`。完整的当前 worktree 验收选择见[开发指南](../development/README.md#normal-development-workflow)。native manifest 和许可证说明见 [native 构建说明](../../native/embedding/README.md)。

当前 embedding 支持 macOS arm64（已在 M4 验证并具备 release 打包）、Linux x64（已完成 Ubuntu 24.04 / WSL2 的源码、Backend-to-native、release staging/打包与编译版 CLI 生命周期验收；尚未正式发布）和 Windows x64（已在 Windows 11 / 26200 完成真实构建——钉版 WinLibs GCC 15.2 UCRT + CMake 3.31.6，无需系统安装编译器——backend→native 全链路验收含冻结/崩溃/父进程死亡回收、release 打包 `lore-<version>-win32-x64.zip` + `install.ps1` 与编译版 CLI 生命周期；产物为通用 x64 基线并静态链接 MinGW 运行时，仅依赖系统 DLL kernel32/ws2_32/advapi32/shell32 与 UCRT API set；其他 Windows 版本与 CI runner 尚未验证）。Windows 已知限制：运行时记录私密性依赖每用户 profile 边界（无 POSIX uid/mode 检查），`lore backend stop` 之外的信号语义为立即终止，`install.ps1` 通过 `lore.cmd` shim 而非符号链接管理命令。

默认 semantic query、semantic index build/rebuild 都通过 Backend 使用本地模型；只有显式 `lore query --mode keyword` 继续直连 Engine。query、index build/rebuild 和 install-driven index 会按需启动 Backend，并在需要 embedding 且模型缺失时自动开始或加入下载；前台只短暂观察，query 以 preparing result、index/install 以 operation 或 `indexSync.pending` 表示后台仍在继续。
