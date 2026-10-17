## ADDED Requirements

### Requirement: Query discovery excludes the selected Store root

自动 ProjectContext discovery SHALL 将 selected LocalStore 的 `--store-root` 作为保留边界。若祖先目录中的 `.lorelum` 对应 selected Store root，`lore query` MUST 不将该目录作为 ProjectContext layer，也不得越过该边界继续读取更高层祖先的 `.lorelum`。若没有该边界以下的有效 project layer，query MUST 使用 Store-only behavior，且不得因 Store 的全局 config、Pack artifact、cache 或 runtime 文件输出 context degraded warning。比较 MUST 基于规范化的绝对/real path，支持任意 selected Store root，不得依赖 home 路径、目录名、Git metadata、config 形状或 Pack 内容。

#### Scenario: Query below a user Store remains Store-only

- **WHEN** 调用方在 selected Store root 的子目录中运行 query，且该 Store root 以下不存在其他有效 ProjectContext layer
- **THEN** query MUST 使用 selected LocalStore，且结果不得包含由 Store root 产生的 `config.invalid`、`pack.invalid` 或 degraded context

#### Scenario: Explicit Store root is not a project root

- **WHEN** 调用方以 `--project-root` 显式选择其 `.lorelum` 正好等于 selected Store root 的目录
- **THEN** query MUST 返回既有 invalid-project-root usage error，且不得猜测其他 project root、连接 Backend 或创建 ProjectContext cache

#### Scenario: Ordinary directory without any marker remains Store-only

- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** query MUST 使用 selected LocalStore，不得返回 ProjectContext、degraded warning 或 project-derived cache；semantic query 的正常模型与 Store index 生命周期不受影响
