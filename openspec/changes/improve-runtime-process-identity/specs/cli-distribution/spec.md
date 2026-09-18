## MODIFIED Requirements

### Requirement: Self-contained verified platform package
每个支持目标的发布包 SHALL 包含唯一用户入口 `lore` CLI、匹配 target 且以 `lore-model` 命名的 native model runtime、manifest 和必要 notices/licenses。安装器 MUST 在安装前验证下载文件、archive layout、目标 manifest 与解压路径安全性；CLI 与 native runtime MUST 来自同一已验证 asset，不得由安装器重新构建、从 PATH 解析或与其他 release 混搭。`lore` MUST 保持唯一被安装器激活的用户命令入口。

#### Scenario: Valid platform archive
- **WHEN** 用户安装与当前平台匹配的发布 archive
- **THEN** 安装器 MUST 只接受同时包含匹配 `lore`、target native manifest 和 `lore-model` executable 的完整 archive，并在验证失败时拒绝安装而不留下可用入口
