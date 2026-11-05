# Design

## Context

omp 普通 Bash 工具使用内置 POSIX shell，外部服务及交互终端可能使用另一个 shell；不能根据 Windows 平台或无条件根据 `shellPath` 判断。

## Goals / Non-Goals

**Goals:** 普通常用路径无需配置；对于可判断的外部 shell 使用 omp 已解析的有效 shell；支持 POSIX、PowerShell、CMD 和 fish，并提供可选覆盖。

**Non-Goals:** 不修改宿主配置或全局环境，不按操作系统猜 shell，不新增查询行为，不改变其他宿主或审批；不声称所有外部或远程 shell 均可自动判定。

## Decisions

`agent.omp.shell` 是可选覆盖，支持 `bash`、`powershell`、`cmd` 和 `fish`，优先于自动选择；只由 omp 读取。错误值不影响其他宿主或 Catalog。普通工具使用内置 Bash；命名服务或可用本地 PTY 读取 omp `settings.getShellConfig()` 的实际外部 shell，不把该设置用于普通 Bash。未知 shell 不猜语法，而是跳过本次身份注入并保留原命令。

extension 向 CLI bridge 传递 POSIX、PowerShell、CMD、fish 或无法识别的标识；旧 bridge 请求缺少语法时仍使用 Bash。CLI 保持命令级环境和非阻塞降级，针对各 shell 正确转义身份；不能安全转义时不改写命令。

## Risks / Trade-offs

客户端终端路由或外部 wrapper 的实际 shell 可能无法在 Hook 阶段确定，覆盖项用于此类情况。一个覆盖作用于全部 omp shell 调用，不能同时为不同 shell 单独设置。下一次 Hook 读取 Lorelum 设置，宿主设置生效时机由宿主决定。
