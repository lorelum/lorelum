## ADDED Requirements

### Requirement: Resource verification failures remain distinguishable across clients
模型文件大小或 digest 校验失败 SHALL 继续返回 `embedding.resource-invalid`，native 安装资源失败 SHALL 返回 `embedding.native-resource-invalid`。Backend 的 failed 状态、显式 `model load`、语义 query 及其 CLI 错误 SHALL 保留同一受限资源信息（资源类型、逻辑文件名、检查项，适用时的预期/实际值）及相应的实际恢复动作；该信息 MUST 不含绝对路径、下载 URL、凭据或私有端口。模型文件与 native 的完整性检查 MUST 保持有效；本要求 MUST 不引入自动删除或重新下载模型缓存。

#### Scenario: Fixed model file digest mismatch
- **WHEN** 固定缓存文件或显式 `modelPath` 文件的 digest 不符合固定模型身份
- **THEN** 状态与 CLI 错误 SHALL 指明模型来源、逻辑文件、期望与实际 digest，并要求修正对应模型来源而非重装 native

#### Scenario: Native failure reaches semantic query
- **WHEN** 语义 query 因 native 安装资源缺失而无法加载模型
- **THEN** CLI 错误 SHALL 保留 native 专用 code、失败资源信息和重新安装完整构建的指引，MUST 不表现为模型缓存损坏或静默 keyword 结果
