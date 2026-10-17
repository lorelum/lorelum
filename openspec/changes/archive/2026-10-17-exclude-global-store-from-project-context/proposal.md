## Why

alpha.2 的自动 ProjectContext discovery 会把 selected LocalStore 的全局 `.lorelum` 根目录当成项目 layer。用户在 Store 根目录的任意子目录运行 query 时，用户级 config 与 Store artifact Pack 布局被按项目 schema 解析，持续产生 `config.invalid`、`pack.invalid` 和 `context: degraded`。

Store 根目录是用户级 canonical 数据与配置边界，不是项目来源。需要修复 discovery 边界，既保留真实项目的父子 layer 行为，也避免普通 query 因内部数据布局降级。

## What Changes

- 自动 ProjectContext discovery MUST 将 selected `StorageRoot.rootPath` 视为保留边界：不得把该目录作为 layer，也不得越过它继续吸收其父目录的 `.lorelum` layer。
- 显式 `--project-root` 若指向 selected Store 根目录，MUST 以既有 invalid-project-root usage 语义失败；不得静默猜测或把 Store 当项目。
- 边界比较使用规范化的绝对/real path，支持任意 `--store-root`，不硬编码用户 home 路径或依据 config/Pack 内容猜测。
- 保留有效项目层、parent-to-child inheritance、`base: user|none`、`--no-project` 与 Store-only 行为；不移动、不清理或重写任何 Store 文件。
- 为 Engine 与 CLI 增加回归测试，并更新用户 query 文档中的 ProjectContext discovery 描述。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `retrieval-query`: 自动 query context 不能把 selected LocalStore 当作项目层或输出由其产生的 degraded warning。
- `semantic-index`: project semantic target 的自动发现必须遵守 selected Store root 边界。
- `practice-read`: 自动 ProjectContext point read 必须遵守 selected Store root 边界。

## Impact

- `packages/engine/src/project-context/resolver.ts`、ProjectContext tests 和 CLI context/query/get/index routing。
- `packages/config` 的 Store-path resolver 作为 canonical boundary identity 来源。
- `docs/cli/query.md` 与相应中英文 site reference；不增加依赖、Store migration、模型生命周期或 MCP 接口。
