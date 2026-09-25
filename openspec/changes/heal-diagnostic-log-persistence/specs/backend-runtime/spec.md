## ADDED Requirements

### Requirement: Daemon startup tolerates unavailable diagnostics locations

Backend daemon 的启动与就绪 MUST NOT 因 Lorelum 日志位置不可用而失败：日志目录先按 `diagnostic-logging` 的自愈规则处理，不能安全修复时使用设计的私有备用位置，两者都不可用时诊断 sink 降级为禁用并继续完成启动，daemon 对 query/model/index 请求照常服务。该降级 MUST 对用户可见：daemon SHALL 在其状态接口与启动就绪结果中暴露诊断持久化的降级事实（含失败类别与尝试的位置），使 `lore backend start` 的调用方与后续 `lore backend status` 能够呈现"服务可用但诊断日志未持久化"，降级 MUST NOT 仅存在于进程内部。该降级 MUST NOT 改变 daemon 对 runtime state 目录（实例记录、启动授权、activity 锁、模型运行时目录）的既有严格检查：这些位置不安全时仍按原有 `backend.state-invalid` 行为拒绝，不得自动修改其权限，也不得因本能力放宽任何非日志边界。

#### Scenario: The daemon log directory is unrepairable

- **WHEN** Backend 日志目录归其他用户所有或无法安全收紧，备用位置也不可用，daemon 被启动
- **THEN** daemon MUST 完成启动并正常服务请求，诊断日志不持久化且不产生 `backend.state-invalid` 启动失败

#### Scenario: A degraded daemon is visible through status

- **WHEN** daemon 以禁用诊断 sink 完成启动后，用户执行 `lore backend status`
- **THEN** 输出 MUST 报告诊断日志未持久化及其失败类别，同时报告服务本身正常

#### Scenario: A runtime state directory remains strictly checked

- **WHEN** daemon 的 runtime state 目录（实例记录或锁所在目录）不安全
- **THEN** daemon MUST 维持既有 `backend.state-invalid` 拒绝行为，MUST NOT 自动收紧其权限或因日志位置降级规则而放宽该边界
