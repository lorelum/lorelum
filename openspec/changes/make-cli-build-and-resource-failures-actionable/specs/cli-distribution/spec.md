## ADDED Requirements

### Requirement: Development CLI build outputs match their stated capabilities
`build:cli` SHALL 生成未归档的当前 target 完整 CLI 目录，其中 SHALL 包含可执行文件和与其匹配且经过验证的 native runtime/manifest，可用于模型加载和语义操作。`build:cli-only` SHALL 仅生成不携带 native runtime 的 `dist/lore` 编译文件，用于明确不需要 embedding 的检查。`build:release-staging` SHALL 保持完整构建的兼容入口；这些本地构建 MUST 不发布包或上传资产。

#### Scenario: Compiled CLI validates semantic behavior
- **WHEN** 开发者为当前 target 运行 `build:cli`
- **THEN** CLI 和匹配的 native runtime SHALL 位于同一可运行目录，而不能要求另行复制开发 candidate 或从 PATH 找 executable

#### Scenario: Explicit binary-only check
- **WHEN** 开发者只需编译文件用于 keyword 或启动成本检查而运行 `build:cli-only`
- **THEN** 命令 SHALL 产出 `dist/lore`，且 MUST 不将它声称为可执行 embedding 的完整安装包
