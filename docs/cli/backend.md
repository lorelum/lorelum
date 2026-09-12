# Backend 命令

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
```

请求经过身份验证的实例停止，取消下载或卸载模型并等待 daemon 退出。只有确认停止后才退出 `0`，data 为 stopped/unloaded。没有服务时可重复调用；不会按端口或名称终止陌生进程。下载片段保留，下次 model load 可恢复。

## 配置与错误

配置读取、默认值、环境变量和生效时机见 [配置入口](../configuration/README.md)、[Backend 配置](../configuration/backend.md)。backend 三个命令会读取并验证配置；修改配置不会热更新运行实例，重复 start 也不会刷新快照。

失败退出 `2`，输出 `ok:false` 的 [CLI envelope](README.md)。常见错误：

| code | 处理 |
| --- | --- |
| `backend.port-conflict` | 固定端口属于未验证的服务，检查占用 |
| `backend.incompatible` | 客户端与后台 build 或协议不匹配，检查是否混用了不同工作目录的程序 |
| `backend.config-invalid` | 修正 YAML、未知字段或越界值 |
| `backend.state-invalid` | 私有运行记录或权限无法安全使用 |
| `backend.deadline-exceeded` | 操作未在配置预算内达到目标状态 |
| `backend.unauthorized` | 身份或认证校验失败 |
| `backend.unavailable`、`backend.busy`、`backend.failed` | 查看服务状态，按错误原因恢复 |

## 构建与支持范围

开发 backend 生命周期、配置或 keyword 行为时，不需要 native candidate。只有源码验收涉及 `model load`、embedding 或 semantic index 时，才先执行 `bun run build:native`；它把 candidate 放在 `packages/backend/.artifacts/native/embedding/<target>/`（当前 target：`darwin-arm64`、`linux-x64`），供源码 backend 校验和启动。

`bun run build:cli` 只生成通用 CLI binary，不携带配套 native runtime，适合非 embedding 的编译检查。需要本地可运行的 compiled embedding candidate 时，执行 `bun run build:release-staging`；只有验证最终 archive/package 时才执行 `bun run build:release`。完整的当前 worktree 验收选择见[开发指南](../development/README.md#normal-development-workflow)。native manifest 和许可证说明见 [native 构建说明](../../native/embedding/README.md)。

当前 embedding 支持 macOS arm64（已在 M4 验证并具备 release 打包）和 Linux x64（已完成 Ubuntu 24.04 / WSL2 的源码、Backend-to-native、release staging/打包与编译版 CLI 生命周期验收；尚未正式发布）。Windows native、进程身份/ACL 和端到端验收尚未完成。普通 `lore query` 仍走原有 Engine 路径；semantic index 已通过 Backend 使用本地模型，semantic query 仍是后续阶段。
