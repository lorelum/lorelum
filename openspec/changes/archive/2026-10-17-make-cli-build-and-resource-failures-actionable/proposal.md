## Why

Issue #261 暴露出两个相连的问题：开发者把仅含 `lore` 的编译产物当作完整安装使用，缺失的 native runtime 又与模型文件校验失败共用 `embedding.resource-invalid`，导致下载模型后仍只得到无效的重试建议。已核验的现场模型文件 digest 匹配；本变更不假设缓存损坏，也不放宽资源完整性校验。

## What Changes

- **BREAKING（开发构建命令）**：`build:cli` 改为生成可运行模型和语义检索的完整本地目录；`build:cli-only` 才生成不带 native 的 `dist/lore`。`build:release-staging` 作为完整构建的兼容别名保留；`build:release` 的归档与发布路径不变。
- native 目录、manifest 或文件无效时给出独立的错误 code 和可操作的完整安装指引；模型文件验证失败仍用模型错误，不将两者合并。
- 模型状态、显式加载和语义查询保留受限的资源级失败信息：资源、检查项、逻辑文件名，以及适用时预期和实际的大小/digest；不回显绝对路径、下载 URL 或凭据。编译包缺 native 时在模型下载前失败。
- 更新开发者和 Agent 的构建说明与模型错误文档，补充打包、错误传播和真实编译产物回归。
- 不加入缓存自动重下载、native 自动修复、keyword 静默降级或 dev 版本号显示变更。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-distribution`：明确本地 `build:cli` 与单文件 `build:cli-only` 的产物和验证边界。
- `native-runtime-artifact`：缺失或无效的配套 native 资源应以可辨认、可操作的错误失败，且不先下载模型。
- `local-model-runtime`：模型与 native 的失败信息在状态和 CLI 错误中可区分，细节安全且不会改变文件校验或下载策略。

## Impact

涉及根 `package.json`、开发文档与 Agent 指引、Backend 资源验证/模型状态/HTTP adapter、CLI 错误传播和相应测试。CLI/Backend 错误合同增加 native 专用 code 与可选资源细节；旧 `embedding.resource-invalid` 继续用于模型资源。发布归档、安装器和固定模型身份不变。
