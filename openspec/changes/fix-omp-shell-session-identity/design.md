# Design

## Context

omp 的普通非 PTY Bash 工具在 Windows 使用类 POSIX shell；真实会话中 PowerShell 前缀报错，get 返回正文但未记录 session。既有 bridge 根据平台选择语法，见 `packages/cli/src/hook/hosts/omp.ts`；共享 shell 关联与失败关闭由 `services/shell-association.ts` 和 runner 负责。

## Goals / Non-Goals

**Goals:** 默认覆盖普通 Bash 工具，也允许使用者显式选择 PowerShell。

**Non-Goals:** 不猜测任意外部 shell、不改变其他宿主、不修改 omp 配置或全局环境，不新增自动查询。

## Decisions

`agent.ompShell` 只由 omp shell 请求消费，取值 `bash` 或 `powershell`，缺省为 `bash`。CLI 复用现有 YAML 读取和安全引用实现；无效配置沿既有 hook 非阻塞降级，不修改原命令。配置项用于整个 omp shell 入口，不自动逐次检测；混用不同 shell 的会话须选择与该工具调用一致的配置。变更通过独立配置消费避免无效的 omp 值影响其他宿主或 Catalog。

## Risks / Trade-offs

采用 PowerShell 作为 omp 自定义外部 shell 的用户需显式配置；原生内置 Bash 则不需操作。由于混合 shell 无可靠逐调用标识，不声称可自动判定所有 PTY/服务。配置变更下一次 bridge 调用生效，无需重启 Backend。
