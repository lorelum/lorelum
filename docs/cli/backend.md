# Backend 命令

当前可观察合同见 [backend runtime OpenSpec](../../openspec/specs/backend-runtime/spec.md)；本页说明 CLI 生命周期命令与输出细节。

`lore backend start/status/stop` 管理固定监听 `127.0.0.1:26186` 的本地后台服务。命令不使用 LocalStore，`--store-root` 不改变服务地址、模型或配置来源。

## 启动

```sh
lore backend start
```

首次 start 由 CLI 应用组装层调用独立 config 包创建缺失的共享配置文件；已有配置不会覆盖。等待兼容且经过认证的 backend 报告 ready 后退出 `0`。重复启动复用已有实例；启动不会下载或加载模型。随后可执行 [model load](model.md)。

成功输出是单行 JSON，展开后例如：

```json
{
  "protocolVersion": 1,
  "toolVersion": "0.0.0",
  "command": "backend.start",
  "ok": true,
  "data": {
    "state": "ready",
    "model": "unloaded",
    "instanceId": "<本次实例 ID>",
    "buildIdentity": "<构建身份>"
  }
}
```

版本和身份值以实际输出为准。CLI envelope version 1 与内部 control/business version 3 是独立版本。

## 状态

```sh
lore backend status
```

只读，不启动后台进程、不加载或扫描模型。没有服务时成功 data 为 `{"state":"stopped","model":"unloaded"}`；运行时给出 backend state、model state、instanceId 和 buildIdentity。模型失败时 backend 仍可 ready，详细原因看 `lore model status`。

## 停止

```sh
lore backend stop
# Agent-only safe handoff; it never stops active or unknown work.
lore backend stop --if-idle
```

不带参数的 `backend stop` 是明确运维动作：它请求经过身份验证的实例停止，取消下载或卸载模型并等待 daemon 退出。对于 protocol-compatible 的旧 build，它继续使用 authenticated stop；对于 protocol 不兼容但 ownership 仍可由私有 runtime record、PID 和启动时间精确验证的旧 daemon，当前 CLI 会先发本地 graceful termination，超时后只终止同一已验证 lifecycle。它不依赖已经被升级删除的旧 CLI，也绝不按端口或名称终止陌生进程。

`backend stop --if-idle` 是给 Agent recovery runner 的受限动作，不是普通用户排障命令。它在 lifecycle lock 内二次检查 Backend 的私有 activity record 和 task lease：只有明确 idle 时才停止，成功 data 为 `{ "state": "stopped" }`；模型准备、index operation、有效 Agent lease 或 activity 无法验证时返回 `{ "state": "deferred", "reason": "active-long-task" | "unknown-activity" }`，不会发 signal、删除 record 或中断工作。Agent 只可自动调用这一种 stop；普通 `backend stop` 只由用户或显式运维调用。

支持的 host Agent 通过 `backend lease acquire`、`renew`、`release` 管理不含任务内容的短期 opaque lease。它们是机器集成控制面，不要求普通用户手动维护。

## 配置与错误

用户可编辑的配置、默认值、环境变量和生效时机见[配置指南](https://lorelum.com/zh/docs/configuration)。backend lifecycle 命令会读取并验证配置；修改配置不会热更新运行实例，重复 start 也不会刷新快照。

失败退出 `2`，输出 `ok:false` 的 [CLI envelope](README.md)。常见错误：

| code | 处理 |
| --- | --- |
| `backend.port-conflict` | 固定端口属于未验证的服务，检查占用 |
| `backend.build-mismatch` | 已验证 Backend 的 protocol 可用但属于另一 build；semantic query 会给 host Agent `auto` 或 `defer` recovery，不要求用户处理 worktree/build 细节 |
| `backend.protocol-mismatch` | 已验证 Backend 的内部 protocol 不同；semantic query 仍给出安全 recovery，显式 `backend stop` 可用当前 CLI 收敛精确验证的旧 lifecycle |
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
