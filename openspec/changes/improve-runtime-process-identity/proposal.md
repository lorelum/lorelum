## Why

Lorelum 的常驻 Backend 与当前承载 embedding 的 native model runtime 在任务管理器、活动监视器和进程列表中可能显示为 `bun`、`lore` 或上游名称 `llama-server`，用户难以直接判断它们的角色。这个 change 让已有运行时使用更易读且不绑定当前模型用途的名称，并为 Windows 主 CLI 提供品牌 icon；不把命名需求扩展成新的发布或 lifecycle 体系。

## What Changes

- 保留唯一用户入口 `lore`；Backend 启动时在宿主支持的情况下以 `lore-backend` 作为进程显示名，不新增第二个 Backend executable。
- 将受 manifest 保护的 native model executable 从上游 `llama-server` 重命名为 `lore-model`（Windows 为 `.exe`），并同步 source candidate、release package 和安装器的既有文件路径。
- 为 Windows `lore.exe` 写入 Lorelum title、description 和 icon。native child 的 Windows icon、`.app`、LaunchAgent、`.desktop` 及 GUI 常驻面不属于本 change。
- 不改变 Backend 的授权、loopback、PID/启动时间/父子关系验证或 stop/recovery 逻辑。

## Capabilities

### New Capabilities

- `runtime-process-identity`: 定义 Backend 与 native model runtime 的可辨认名称，以及 Windows 主 CLI 的品牌资源边界。

### Modified Capabilities

- `cli-distribution`: 平台包和安装验证使用重命名后的 native executable，且对用户保持唯一的 `lore` 命令入口。
- `native-runtime-artifact`: manifest 所锚定的 target native executable 使用不绑定具体模型用途的 Lorelum model 角色名称，且 source/release 继续只运行校验通过的同 target artifact。

## Impact

- 受影响实现：Backend spawn options、native build/manifest、release archive 和两套安装器的既有文件路径，以及 Windows CLI compile metadata。
- 受影响发布物：native manifest 文件表和 Windows `lore.exe`。
- 不新增第二个运行时 image、build identity、MCP、网络监听面、用户配置项或基于名称的进程管理，也不自动发布 release。
