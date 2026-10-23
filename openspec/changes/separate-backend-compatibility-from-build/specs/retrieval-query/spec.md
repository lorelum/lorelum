## MODIFIED Requirements

### Requirement: Semantic query follows actionable errors without implicit recovery
semantic query SHALL 返回 Backend 的具体错误码及完整可执行 message，不自动停止不匹配实例、不传播 compatibility recovery policy、不自动 keyword fallback。通过认证、实例归属和 Backend 内部协议核验的不同 build SHALL 正常处理 query，不得只因精确 build 不同报错或重启。text 与 JSON error.message MUST 同文；适用的 resource 与 diagnostics MUST 保留。既有按需启动、ready、preparing 与退出码合同 MUST 保持。

#### Scenario: Query encounters another build or protocol
- **WHEN** 原 semantic query 遇到已验证、同内部协议但精确 build 不同的 Backend
- **THEN** query MUST 真实提交给该实例并按正常 ready/preparing/indexing 或业务错误返回，不报告 backend.build-mismatch、不停止实例、不重载其已准备模型

#### Scenario: Query encounters another protocol
- **WHEN** 原 semantic query 遇到已验证但内部 protocol 不同的 Backend
- **THEN** 它 MUST 返回 backend.protocol-mismatch，message MUST 展示双方已知构建身份与 Backend 协议、将未知旧版本明示为 unknown，并给出 `lore backend stop --if-idle`、仅 stopped 后 `lore backend start`、成功后重试相同原 query 的完整步骤；query 自身 MUST 不执行 stop

#### Scenario: Deferred refusal does not schedule background work
- **WHEN** AI 按 query 错误消息执行 guarded stop，结果为 active-long-task 或 unknown-activity deferred
- **THEN** AI MUST 保留另一任务和实例，说明无法安全恢复，不后台重试、不自动退避、不未经用户明确同意使用普通 stop 或 kill，也不把失败说成空检索结果

#### Scenario: True query retry after stop and start
- **WHEN** 真实隔离 smoke 对 protocol mismatch query 完成 guarded stopped、旧 daemon 退出、当前 backend start
- **THEN** 相同文本、参数及 semantic 模式的原 query MUST 真正再次执行并产生真实 ready 结果或 preparing；验收 MUST 不以不同命令、keyword 查询或静态 JSON 替代原 query

#### Scenario: Backend start fails during explicit recovery
- **WHEN** stopped 后显式 backend start 返回 unavailable、listener、ownership、认证或其它具体启动失败
- **THEN** 调用方 MUST 报告真实错误及下一步，不伪造 query 成功、不自动重新启动旧 build、不重放 query 或切换 keyword

#### Scenario: Resource failure is preserved
- **WHEN** query 返回 embedding/model/native 资源校验失败
- **THEN** failure MUST 保留安全 resource 与 diagnostics，message MUST 针对资源问题；兼容性调整 MUST 不删除资源故障信息或把它替换成 mismatch 指导

#### Scenario: Existing preparation remains visible
- **WHEN** retry query 真实进入模型或索引准备
- **THEN** query MUST 返回既有 preparing state 与操作信息，而不得将恢复步骤完成当成 ready 或隐藏仍未完成的准备
