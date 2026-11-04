# 产品体验：omp shell 会话身份

## 默认路径

用户在 Windows、macOS 或 Linux 的 omp 普通 Bash 工具中运行 `lore get <id>`。无需配置：Lorelum 只为符合 `agent.shellSessionInjection` 策略的当前命令提供 Bash 语法的会话身份。Backend 已运行时，成功读取可归属当前 session，之后压缩或子任务可按现有规则收到候选；get 本身在 Backend 未运行时仍可工作。

## 使用 PowerShell

若用户明确让 omp 工具命令由 PowerShell 而非普通 Bash 执行，在已有 `~/.lorelum/config.yaml` 的 `agent` 下合并：

```yaml
agent:
  ompShell: powershell
```

下一次 shell bridge 调用生效，无需重启 Backend。删除该字段或设为 `bash` 恢复默认。该选项不会修改 omp 的 shell 设置，也不会自动检测每一次调用；同一会话混用不同 shell 时应确保选择与调用一致。

## 失败及边界

未知值或不可读取的配置使当前身份改写跳过，原始工具命令和审批继续；成功 get 仍可返回，但本次阅读可能不能关联到会话。用户应把值改为 `bash` 或 `powershell` 后重试。设置不影响其他宿主、Pack Catalog、query 排序、get 正文或用户授权。
