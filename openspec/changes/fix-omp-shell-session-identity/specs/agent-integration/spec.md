# Spec Delta

## ADDED Requirements

### Requirement: Omp shell identity syntax is selectable

omp 的 shell bridge SHALL 从 `agent.ompShell` 读取身份前缀语法，支持 `bash` 和 `powershell`，默认 `bash`。选择仅影响 omp 的命令级环境变量前缀，不影响其他宿主、Catalog、原命令参数、审批或全局环境。配置无效时 MUST 保留原工具命令并非阻塞降级；下一次 shell bridge 调用 SHALL 读取新的配置，无需重启 Backend。

#### Scenario: Windows ordinary Bash command
- **WHEN** Windows omp 使用默认配置执行成功的 `lore get`
- **THEN** Bash 可执行身份前缀，已运行 Backend 将读取记录关联到当前 session

#### Scenario: Explicit PowerShell
- **WHEN** 用户设置 `agent.ompShell: powershell` 且 omp shell 使用 PowerShell
- **THEN** bridge MUST 使用 PowerShell 会话环境变量语法，且不改写原命令或其他工具输入

#### Scenario: Invalid omp shell setting
- **WHEN** `agent.ompShell` 不是支持的字符串
- **THEN** omp shell 请求 MUST 非阻塞降级并保留原命令；其他宿主和 Catalog 不受影响
