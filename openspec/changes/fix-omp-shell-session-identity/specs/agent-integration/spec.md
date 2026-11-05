# Spec Delta

## ADDED Requirements

### Requirement: Omp shell identity syntax is resolved for each invocation

omp SHALL 默认按可获得的宿主执行信息选择命令级会话身份语法，而不按操作系统假定 PowerShell。用户 MAY 设置 `agent.omp.shell` 为 `bash`、`powershell`、`cmd` 或 `fish` 覆盖自动选择；覆盖 MUST NOT 修改宿主配置、其他宿主、Catalog、原命令参数或审批。无效配置 MUST 非阻塞降级并保留原工具命令。

#### Scenario: Ordinary omp Bash
- **WHEN** omp 普通 Bash 工具执行命令，即使宿主外部 shell 配置为 PowerShell
- **THEN** bridge MUST 使用 POSIX 身份前缀，除非用户显式覆盖

#### Scenario: Omp external shell
- **WHEN** 可确定 omp 本次使用外部 shell，且其已解析路径属于 POSIX、PowerShell、CMD 或 fish
- **THEN** bridge SHALL 使用对应身份前缀，除非用户显式覆盖

#### Scenario: Unknown external shell
- **WHEN** 无法识别该外部 shell，且用户未设置覆盖
- **THEN** bridge MUST 保留原命令并非阻塞继续，不得猜测语法

#### Scenario: Explicit override
- **WHEN** 用户设置有效的 `agent.omp.shell`
- **THEN** 下一次 omp Hook SHALL 使用对应语法，不需要重启 Backend

#### Scenario: Invalid setting
- **WHEN** omp 的 shell 覆盖无效
- **THEN** 当前命令 MUST 非阻塞降级且保持原样；其他宿主和 Catalog 不受影响
