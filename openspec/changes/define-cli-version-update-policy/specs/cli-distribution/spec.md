## MODIFIED Requirements

### Requirement: Atomic and non-invasive installation
安装器 SHALL 将版本内容安装到用户可写目录，并仅在完整验证后原子切换 `lore` 命令入口。安装器 MUST 不要求 Bun、Node 或 sudo，MUST 不修改 shell startup 文件，也 MUST 不覆盖或删除外部管理的同名入口；失败、取消或损坏 archive MUST 不产生半安装状态。下载发行包时，安装器 SHALL 定期在 stderr 显示已下载量和速度；响应给出可靠总大小时 SHALL 同时显示总大小及百分比，未知时 MUST 不编造。下载成功 SHALL 单独提示，但不得被表述成校验或安装成功。Windows 实现 MUST 不重新启用会严重拖慢下载的 PowerShell 5.1 逐块进度 UI。

#### Scenario: Existing external command
- **WHEN** 安装目标位置已有不是 Lorelum 安装器管理的命令
- **THEN** 安装器 MUST 停止并说明冲突，而不得覆盖该命令

#### Scenario: Archive download is in progress
- **WHEN** 用户直接运行安装器下载匹配平台的发行包
- **THEN** 用户 SHALL 看到低频的已下载量、速度，以及总大小可用时的百分比；下载完成提示后若校验或安装失败仍 MUST 报错而不宣称安装成功
