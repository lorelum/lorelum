## ADDED Requirements

### Requirement: Missing or invalid native installation is actionable
编译版 CLI 需要模型时，系统 SHALL 在下载模型前验证相邻 target native 资源；若缺失、不完整或与编译 CLI 不匹配，MUST 返回 `embedding.native-resource-invalid`，包含受限的逻辑文件名、失败检查项和可取得时的预期/实际大小或 digest，并告知使用匹配的完整构建重新安装。MUST 不运行未验证 executable，不从 PATH、其他 target 或模型下载源补齐 native 资源。

#### Scenario: CLI executable without its native directory
- **WHEN** compiled CLI 目录只有 `lore` 而缺少 `native/<target>/manifest.json`
- **THEN** 模型加载 SHALL 在下载模型前失败，错误 SHALL 指明 native manifest 缺失并建议安装完整目录；现有模型缓存 MUST 不受影响

#### Scenario: Native file differs from trusted manifest
- **WHEN** native 文件的大小或 SHA-256 与匹配的 manifest 不符
- **THEN** 系统 SHALL 指明目标文件、检查项及可取得的预期和实际值并拒绝启动该文件
