## ADDED Requirements

### Requirement: Daemon-owned embedding runtime parent liveness

Backend daemon 拉起 embedding native runtime 时 MUST 在 spawn 环境携带 parent-liveness opt-in（`LLAMA_PARENT_LIVENESS_STDIN=1`），使 owner-death 快速退出语义仅作用于 daemon-owned 进程。embedding runtime 在启动阶段退出时，daemon MUST 在有界重试后返回稳定终态 embedding 错误，MUST 不将启动期退出表示为无限期 pending 或仅以 deadline 错误收场。

#### Scenario: Spawn carries liveness opt-in

- **WHEN** daemon 启动 embedding native runtime
- **THEN** spawn 环境 MUST 包含 `LLAMA_PARENT_LIVENESS_STDIN=1`，且该变量 MUST 不出现在其他非 daemon 拉起路径

#### Scenario: Runtime exits during startup

- **WHEN** embedding runtime 在启动探测阶段以 exit 0 退出且无任何输出
- **THEN** daemon MUST 在有界重试后以 `embedding.failed` 终态失败结束该次启动，MUST 不无限等待至 deadline
