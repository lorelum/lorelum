## ADDED Requirements

### Requirement: Project index discovery excludes the selected Store root

当 `lore index` 自动选择 ProjectContext target 时，系统 MUST 将 selected LocalStore root 作为 discovery 保留边界。Store root 及其上层祖先不得被解析为 project layer；位于该边界以下的有效项目 layer 仍 MUST 保持现有的 parent-to-child inheritance、cache 与 operation 行为。显式 `--project-root` 指向 selected Store root MUST 使用既有 invalid-project-root usage error，而不得创建 project semantic target 或后台 operation。

#### Scenario: Store-only index does not create a degraded project target

- **WHEN** 调用方从 selected Store root 的子目录自动运行 index，且不存在边界以下的有效项目 layer
- **THEN** 命令 MUST 使用 Store target，且不得从 Store root 的 config 或 Pack artifact 创建 degraded ProjectContext target

#### Scenario: Ordinary directory without a marker uses Store target

- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** index MUST 使用 Store target，不得创建 ProjectContext target、project-derived cache 或 context diagnostic
