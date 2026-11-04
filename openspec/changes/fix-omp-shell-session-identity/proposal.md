# Proposal

## Why

Windows omp 普通 Bash 工具使用内置 POSIX shell，按操作系统插入 PowerShell 赋值会丢失会话身份。omp 的外部 shell 又可能与普通工具不同。

## What Changes

- 普通 omp Bash 调用自动使用 POSIX 语法；可确定的外部 shell 调用读取 omp 的有效设置。
- 提供可选的 `agent.omp.shell` 覆盖，支持 `bash` 或 `powershell`，不要求普通用户配置。
- 保留注入策略、宿主审批、原命令、非阻塞失败和其他宿主行为，更新测试及中英文指南。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：明确 omp 的 shell 自动选择及可选覆盖。

## Impact

影响 omp shell bridge、配置解析、测试和文档；不修改 omp 用户配置，不改变其他宿主、query/get 结果或 JSON。
