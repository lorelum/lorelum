## Why

用户现在能用 `lore --version` 看自己装了哪版，却不能在 Lore 里知道有没有适合自己的新版。要更新时还得自己翻 Releases、判断 alpha/stable、挑平台，再找到对应安装方法；网络失败或外部管理的入口也容易被误解为“没有更新”或“可以直接覆盖”。Issue #130 要先把这条用户路径和版本管理边界定下来。

本变更**引入新产品行为**。先读 [产品方案](./product.md)：它从一位默认 installer 用户检查、明确选择 `--apply`、自动更新到核对新版的完整路径出发，也说明其他来源为什么不能自动更新。它是 Proposed，不是已发布指南。

## What Changes

- `lore update` 保持**只读检查**：用户看到当前版、匹配频道/平台的新版、release notes 和下一步；`lore --version` 仍不联网。
- 增加显式 `lore update --apply`：只在当前 CLI 能确认是**默认路径下官方 installer 管理的入口**时才重新检查并更新；使用当前安装包中的同平台安装器来下载校验、停旧 Backend 和切换入口，最后从新入口核对版本。没有新版时不运行安装器；其他安装来源在联网和任何安装动作前拒绝。
- alpha 用户默认查预发布版，稳定版用户默认只查稳定版；可显式换频道。没有候选、已经是最新、本机版更高、检查失败是不同结果，不能混成“无更新”。每次显式检查现查，不做缓存或后台提示。
- 默认安装入口显示 `lore update --apply`；自定义 installer 路径、手动安装、其他管理器、源码及不明来源只能检查，须按原安装方式更新。安装器切换前失败保留旧入口；切换后版本核对失败必须报告状态不确定和恢复步骤，不能虚报成功。
- Pack 的 `lore pack update` 不变。`--apply` 的信任与归档校验沿用现有安装器，不宣称 `SHA256SUMS` 是独立签名；不引入自动后台更新或自定义路径自动更新。

## Capabilities

### New Capabilities

- `cli-version-management`: Lore CLI 的显式版本检查、频道选择，以及默认 installer 安装上的受限 `--apply` 更新。

### Modified Capabilities

- `cli-distribution`：下载大文件时提供低频已下载量反馈；安装器原子切换和 asset 验证要求保持原样，不允许 CLI 覆盖外部入口。

## Impact

- CLI 命令、查询、默认安装识别与结果输出；发行包附带当前平台的现有安装器脚本，`--apply` 调用它而不在运行时下载 `main` 分支脚本或复制安装逻辑。
- 更新站点英文/中文安装说明；三个目标验证候选包与安装器路径，公开版本之间的“检查 → `--apply` → 从新入口核对版本”smoke 属发布验证。
- 不涉及 Pack lifecycle、Backend、LocalStore、Hook 自动检查，也不授权更改 release workflow、发布资产或公开 Issue。
