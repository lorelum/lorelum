## ADDED Requirements

### Requirement: Opt-in parent liveness for the native runtime

embedding native runtime SHALL 仅在 spawn 环境显式提供 `LLAMA_PARENT_LIVENESS_STDIN=1` 时启用 parent-liveness 监视。启用时，该机制 MUST 在参数解析前生效，并在持有 stdin 管道写端的 owner 消失（EOF）时立即退出，以绕过无法推进的正常清理。未携带 opt-in 的调用 MUST 不基于 stdin 状态退出，其退出码与输出 MUST 反映该调用的真实结果。

#### Scenario: Direct invocation is unaffected by stdin

- **WHEN** 不携带 opt-in 环境变量直接调用 native runtime（如 `--version` 或启动 server），且 stdin 处于 EOF、无效句柄或打开管道任一状态
- **THEN** runtime MUST 正常执行该调用并产生相应输出或服务，MUST 不以 exit 0 静默退出

#### Scenario: Daemon-owned runtime exits on owner death

- **WHEN** daemon 以 opt-in 拉起 runtime 并持有 stdin 管道，owner 死亡导致 stdin EOF
- **THEN** runtime MUST 立即退出，MUST 不执行可能无法推进的正常清理
