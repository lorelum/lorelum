## ADDED Requirements

### Requirement: Ordinary command lifecycle has single stage evidence

当收集等级允许对应记录时，普通 CLI 调用 SHALL 为同一次 invocation 的开始与完成各持久化一份生命周期证据，MUST 不仅因同时接入普通 logger 和诊断适配器而重复记录相同阶段。失败所需的错误详情与 stack SHALL 继续保留；阶段去重 MUST 不改变 stdout、业务错误码、退出码、trace 关联、凭据排除或日志失败隔离。

#### Scenario: Successful command records each lifecycle stage once

- **WHEN** 一个普通 CLI 命令以启用 info 的收集设置成功完成
- **THEN** 该 invocation SHALL 有一个开始和一个完成阶段记录，且 stdout 与原命令合同一致

#### Scenario: Failed command retains diagnostics without changing business output

- **WHEN** 命令失败，或诊断 sink 不可用
- **THEN** 系统 MUST 保留原命令错误码、输出与退出码；可记录时 SHALL 保留失败排障信息与 trace，日志不可用时 SHALL 沿用现有有限提示与缺失语义

### Requirement: Trace collection preserves independent bounded evidence windows

按 trace 收集日志 SHALL 分别限制该 trace 的直接记录与用于查找 shared lifecycle 的全局记录窗口。direct record MUST 不因被其他 trace 挤出全局窗口而丢失。shared record SHALL 仅沿选中的原子关系 ID 收集未归属其他 trace 的记录；缺失、损坏和任一窗口截断 MUST 继续如实报告。

#### Scenario: An older direct record survives a crowded global window

- **WHEN** 指定 trace 的记录早于全局最近窗口，且其数量仍在 direct 窗口限额内
- **THEN** 收集结果 MUST 保留该 direct record；全局窗口截断 SHALL 如实报告，不得用其他 trace 的记录替代

#### Scenario: Shared lifecycle does not import another trace context

- **WHEN** 两个 trace 关联同一 operation，而可读日志包含 anonymous lifecycle 与另一 trace 的 context
- **THEN** 当前 trace SHALL 能收集匹配的 anonymous lifecycle，MUST 不返回另一 trace 的普通 context；读取失败与截断信息 MUST 保留
