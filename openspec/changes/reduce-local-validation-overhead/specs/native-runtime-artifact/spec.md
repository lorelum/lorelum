## MODIFIED Requirements

### Requirement: Target-specific trusted native runtime

运行时 SHALL 仅从受支持 target catalog 选择 native artifact，并 MUST 在模型准备时验证 matching manifest 与必需 executable 的身份、大小和完整性。每个 target manifest 的 executable MUST 是 Lorelum 的 lore-model 角色文件（Windows target 为 lore-model.exe）；该名称表达 native model runtime，而不绑定当前 embedding 用途。运行时 MUST 不从 PATH、任意环境变量、Store、模型 config 或其他 target 回退选择 native executable。许可证/notices 的完整文件集验证 SHALL 属于构建/打包验收，不作为已安装 executable 的运行时准备或编码条件。

#### Scenario: Missing or incompatible native artifact

- **WHEN** 当前 target 没有受支持 artifact、其 manifest 与当前运行时不兼容，或 manifest 未锚定该 target 的 lore-model executable
- **THEN** semantic/native operation MUST 明确失败，而不得执行不同 target、未验证 executable 或上游名称的备用 executable

#### Scenario: Installed runtime lacks a notice file

- **WHEN** matching manifest 和必需 executable 有效，但一个许可证或 notices 文本缺失或改变
- **THEN** runtime 准备和编码 MUST 不因该非执行文件失败；构建/打包完整验证 MUST 仍发现文件集问题

### Requirement: Missing or invalid native installation is actionable

编译版 CLI 需要模型时，系统 SHALL 在下载模型前验证相邻 target native manifest 与必需 executable；若缺失、不可用或与编译 CLI 不匹配，MUST 返回 embedding.native-resource-invalid，包含受限的逻辑文件名、失败检查项和可取得时的预期/实际大小或 digest，并告知使用匹配的完整构建重新安装。MUST 不运行未验证 executable，不从 PATH、其他 target 或模型下载源补齐 native 资源。

#### Scenario: CLI executable without its native directory

- **WHEN** compiled CLI 目录只有 `lore` 而缺少 `native/<target>/manifest.json`
- **THEN** 模型加载 SHALL 在下载模型前失败，错误 SHALL 指明 native manifest 缺失并建议安装完整目录；现有模型缓存 MUST 不受影响

#### Scenario: Native file differs from trusted manifest

- **WHEN** 必需 executable 的大小或 SHA-256 与匹配的 manifest 不符
- **THEN** 系统 SHALL 指明目标文件、检查项及可取得的预期和实际值并拒绝启动该文件
