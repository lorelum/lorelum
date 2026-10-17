## ADDED Requirements

### Requirement: Automatic point-read context excludes the selected Store root

`lore get` 的自动 ProjectContext discovery MUST 将 selected LocalStore root 视为保留边界。它不得把 Store 的 `.lorelum` 目录、全局 config 或 Pack artifact 解释为项目来源；若边界以下没有有效 project layer，point read MUST 使用 selected Store 的 canonical Practice。显式 `--project-root` 指向 selected Store root MUST 返回既有 invalid-project-root usage error，不得猜测或回退到其他 project root。

#### Scenario: Point read below a Store root has no synthetic project warning

- **WHEN** 调用方位于 selected Store root 的子目录且没有边界以下的有效 project layer
- **THEN** `lore get` MUST 从 selected Store 读取 canonical Practice，且不得附加由 Store root 产生的 ProjectContext degraded provenance

#### Scenario: Point read in an ordinary directory remains Store-only

- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** `lore get` MUST 从 selected Store 读取 canonical Practice，且不得创建或附加 ProjectContext provenance
