## ADDED Requirements

### Requirement: Idle native memory reclamation

已 ready 的本地模型 runtime SHALL 默认在没有排队或执行中的编码任务且连续空闲 60 秒后释放模型与计算 context 的内存，不要求用户停止 Backend 或执行卸载。下一次编码 SHALL 在同一受控 native 服务中自动重载模型并继续处理。回收 MUST 不截断或拆分单条文本，MUST 保留既有长输入、batch 行关联、向量身份和外部并发准入语义。阈值 SHALL 允许 native 主循环调度延迟，不承诺精确到秒的释放时间。

#### Scenario: Long input followed by idle
- **WHEN** 一次可支持的长输入完成编码，后续短输入完成且连续空闲超过回收阈值
- **THEN** runtime SHALL 归还长请求保留的高水位计算内存，Backend 与受控 native 服务进程 SHALL 继续可用

#### Scenario: Batch request wakes an idle runtime
- **WHEN** 已释放内部模型/context 的 ready runtime 接收新的多输入编码请求
- **THEN** runtime SHALL 重载模型并返回与输入顺序关联的完整向量，MUST 保持既有维度、有限性、归一化及同形 batch 数值容差

#### Scenario: Work remains active
- **WHEN** 编码请求仍在排队或执行，即使请求执行时间超过空闲阈值
- **THEN** 空闲回收 MUST 不取消、截断或终止该请求

### Requirement: Ready runtime does not promise residency

模型 `ready` SHALL 表示 runtime 可接受编码，不承诺模型权重或计算工作区持续驻留。只读状态查询和 ready 时重复显式 load MUST 不强制唤醒或阻止空闲回收；显式 unload SHALL 继续等待在途请求与受控进程回收后才报告 unloaded。唤醒耗时 SHALL 计入现有编码 deadline，失败、超时和取消 MUST 保持既有错误及回收语义，不得静默返回空结果或部分向量。

#### Scenario: Status observes an idle ready runtime
- **WHEN** 用户在内部模型已释放后读取模型状态或对 ready runtime 重复执行 load
- **THEN** 操作 SHALL 返回 ready，MUST 不为该操作重载模型或要求用户手动恢复

#### Scenario: Explicit unload after idle
- **WHEN** 用户对已休眠的 ready runtime 执行 unload
- **THEN** 操作 SHALL 停止其受控 native 进程，并仅在确认回收成功后报告 unloaded

#### Scenario: Wake request fails
- **WHEN** 首个唤醒编码请求无法在既有 deadline 内完成，或模型重载失败
- **THEN** 请求 MUST 返回既有模型失败或超时错误，并沿既有 owned-runtime 回收路径处理，MUST 不自动删除或重新下载模型缓存
