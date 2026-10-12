## ADDED Requirements

### Requirement: Actionable cross-command Backend errors

Backend build/protocol mismatch SHALL 返回现有对应错误码及完整可执行 message。query、model status/load、index status/build/rebuild/operation、backend start/status MUST 使用相同的恢复指导；默认 text 与 JSON error.message MUST 使用同一完整文本。错误合同 MUST 不构造或传播 compatibility recovery policy；diagnostics 与独立 ResourceFailure MUST 保留。

message MUST 指示先执行 `lore backend stop --if-idle`，仅在 stopped 后执行 `lore backend start`，成功后重试原命令；deferred 时 MUST 说明不后台重试、不未经用户明确同意调用普通 stop。query 和 status MUST 不因 mismatch 自动停止实例。

#### Scenario: Command matrix encounters build mismatch
- **WHEN** query、model status/load、index status/build/rebuild/operation 或 backend start/status 与已验证但 build 不同的实例连接
- **THEN** 每个命令 MUST 返回 backend.build-mismatch 及完整 guarded stop→start→原命令重试指导，不自动停止、重放或返回成功；text/JSON MUST 同文且不含恢复策略字段

#### Scenario: Command matrix encounters protocol mismatch
- **WHEN** 上述命令遇到已验证但 protocol 不同的实例
- **THEN** 每个命令 MUST 返回 backend.protocol-mismatch 和同等完整指导，不要求旧 CLI、不自动杀进程，也不读取策略对象来决定下一步

#### Scenario: Backend is unavailable to a non-starting command
- **WHEN** 只读 model/index 状态或其它按既有合同不自动启动的命令发现 Backend 已停止
- **THEN** 命令 MUST 返回 backend.unavailable，message MUST 提示 `lore backend start` 后重试原命令，且 MUST 不为了状态读取启动或停止实例

#### Scenario: Specific ownership or listener failure
- **WHEN** runtime record 权限/ownership 无法验证或固定端口属于无关 listener
- **THEN** 命令 MUST 返回对应具体错误及修正方向，不给必然失败的泛化 stop 建议、不删除有效记录、不终止无关服务、不泄露私有 secret

#### Scenario: Authentication failure is not a handoff signal
- **WHEN** 与 listener 的认证或身份核验失败
- **THEN** 命令 MUST 保留具体错误及针对性 message，MUST 不忽略失败后尝试 signal、启动替代服务或假定 mismatch 可以恢复

### Requirement: Guarded stop preserves safe refusal

`lore backend stop --if-idle` SHALL 继续使用既有 ownership 核验、lifecycle lock、activity 与 task lease。只有明确 idle 才可停止；active 或 unknown MUST 返回 deferred 而不 signal、不删记录、不取消任务。AI MUST 不将 deferred 变成后台重试、退避队列或未经用户明确同意的普通 stop。

#### Scenario: Active long task refuses recovery
- **WHEN** guarded stop 发现模型准备、index operation 或有效 Agent lease
- **THEN** 它 MUST 返回 state deferred、reason active-long-task，实例和任务保持运行；AI MUST 报告安全拒绝，不后台重试或自行强停

#### Scenario: Unknown activity refuses recovery
- **WHEN** 私有 activity 无法可靠确认 idle
- **THEN** guarded stop MUST 返回 deferred、reason unknown-activity，不发 signal、不清理记录；AI MUST 不因等待而推断已经安全 idle

#### Scenario: Real stopped start original retry proof
- **WHEN** 隔离真实 runtime 的原命令产生 mismatch，且实例已验证 idle
- **THEN** 验收 MUST 观察 guarded stop 返回 stopped、旧 daemon 确实退出、backend start 建立当前实例、相同原命令得到真实结果或 preparing；仅 error/envelope fixture MUST NOT 代替该证明

#### Scenario: Model and native resources retain independent errors
- **WHEN** 模型/native 文件校验失败或 model/index 状态携带资源故障
- **THEN** 移除恢复策略 MUST 不删除 resource 的逻辑文件、check、可用 expected/actual size 或 digest，也不更改现有模型/index 状态语义、用户配置、Pack/Practice 或缓存
