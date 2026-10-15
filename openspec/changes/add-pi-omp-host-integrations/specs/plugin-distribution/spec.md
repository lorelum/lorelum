## MODIFIED Requirements

### Requirement: Single public Plugin identity

每个受支持宿主 SHALL 在自己的原生分发机制中暴露恰好一个 Lorelum Plugin：有 marketplace 的宿主使用独立 registration。Lorelum 的产品 ID 与 Skill 名称 SHALL 为 `lorelum`；host-specific source root SHALL 为 `plugins/<hostKey>/lorelum/`，包括 Codex、ZCode、Cursor 与 omp。marketplace namespace、Plugin ID、source root 和 selector MUST 各自指向该宿主唯一的公开分发来源；同一个字符串 selector 可以在不同宿主中出现，但 MUST 被视为 host-local identity，而不得声称是跨宿主全局唯一值。

Codex 侧：公开 Codex marketplace SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 Plugin。该 Plugin SHALL 保持显示名 **Lorelum**、source root `plugins/codex/lorelum/` 和 selector `lorelum@lorelum-plugins`。alpha 迁移后，公开文档和开发流程 MUST 只使用 `lorelum-plugins`；不得同时公开 legacy `lorelum@lorelum` selector。

ZCode 侧：仓库根 `marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 ZCode Plugin，source root `plugins/zcode/lorelum/`，selector `lorelum@lorelum-plugins`。ZCode marketplace entry MUST 声明与 `.zcode-plugin/plugin.json` 相同的 version。

Cursor 侧：仓库根 `.cursor-plugin/marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 Cursor Plugin，source root `plugins/cursor/lorelum/`，selector `lorelum@lorelum-plugins`（host-local）。当该 marketplace 参与更新检测时，entry `version` MUST 与 `.cursor-plugin/plugin.json` 的 `version` 一致。Codex 的 `.agents/plugins/marketplace.json`、ZCode 的根 `marketplace.json` 与 Cursor 的 `.cursor-plugin/marketplace.json` MUST 保持相互独立，且不得在其中一个 registration 中声明另一宿主的 artifact。

omp 侧：仓库根 `.omp-plugin/marketplace.json` SHALL 独立声明 `lorelum-plugins`、插件名 `lorelum`、source root `plugins/omp/lorelum/` 与宿主本地 selector `lorelum@lorelum-plugins`。entry version MUST 与对应 package version 一致；omp registration MUST NOT 指向 Codex 或 Claude artifact。

#### Scenario: Marketplace installation
- **WHEN** 用户按公开安装文档配置 Lorelum Codex integration
- **THEN** Codex SHALL 从 `lorelum-plugins` marketplace 安装 `lorelum` Plugin，且已安装 selector 为 `lorelum@lorelum-plugins`

#### Scenario: Alpha user migrates from the legacy selector
- **WHEN** 用户的 Codex 配置仍含有 legacy `lorelum` marketplace 或 `lorelum@lorelum` Plugin
- **THEN** 迁移文档 SHALL 要求先移除该 legacy source，再添加 `lorelum-plugins` 并安装 `lorelum@lorelum-plugins`，使迁移完成后只有一个 Lorelum marketplace source

#### Scenario: Distribution keeps the Plugin identity stable
- **WHEN** Codex 从 `lorelum-plugins` 解析 Lorelum Plugin
- **THEN** marketplace metadata SHALL 解析到 `plugins/codex/lorelum/`，Plugin manifest ID SHALL 为 `lorelum`，且用户可见显示名 SHALL 为 **Lorelum**

#### Scenario: ZCode marketplace installation
- **WHEN** 用户在 ZCode 中添加 Lorelum 仓库或本地目录作为 marketplace，并安装 Lorelum Plugin
- **THEN** ZCode SHALL 从仓库根 `marketplace.json` 的 `lorelum-plugins` 安装 `lorelum` Plugin，且已安装 selector 为 `lorelum@lorelum-plugins`

#### Scenario: ZCode Plugin update is discoverable
- **WHEN** 新版本 ZCode Plugin 发布到同一 marketplace
- **THEN** marketplace entry version MUST 与其 `.zcode-plugin/plugin.json` version 一致并高于已安装版本，使宿主可以判定更新可用

#### Scenario: Cursor marketplace installation
- **WHEN** 用户在 Cursor 中添加 Lorelum 仓库或本地目录作为 marketplace，并安装 Lorelum Plugin
- **THEN** Cursor SHALL 从仓库根 `.cursor-plugin/marketplace.json` 的 `lorelum-plugins` 解析到 `plugins/cursor/lorelum/` 并安装 `lorelum` Plugin，且该 Plugin 以 `.cursor-plugin/plugin.json` 为 manifest

#### Scenario: Cursor Plugin update is discoverable
- **WHEN** 新版本 Cursor Plugin 发布到同一 marketplace 且该 marketplace 参与更新检测
- **THEN** `.cursor-plugin/marketplace.json` entry `version` MUST 与其 `.cursor-plugin/plugin.json` `version` 一致并高于已安装版本，使宿主可以判定更新可用

#### Scenario: Host registrations remain independent
- **WHEN** 仓库同时承载 Codex、ZCode 与 Cursor 三个宿主 artifact
- **THEN** 三个 registration 文件 MUST 各自只声明本宿主的 source root，且任一 registration 中 MUST NOT 出现指向其他宿主 artifact 的条目

#### Scenario: Omp marketplace selects its artifact
- **WHEN** 用户添加 Lorelum 仓库为 omp marketplace 并安装 `lorelum@lorelum-plugins`
- **THEN** omp SHALL 从 `.omp-plugin/marketplace.json` 选择 `plugins/omp/lorelum/`，加载其中声明的 extension 与 Skill

## ADDED Requirements

### Requirement: Omp installation ownership

omp 插件 SHALL 依赖用户独立安装的 `lore` CLI，MUST NOT 安装、升级或卸载 CLI、Pack、model 或 Backend 状态。安装、更新、卸载 SHALL 使用宿主原生机制并遵循其 trust 与作用域规则；插件 MUST NOT 自动更改用户已有宿主权限或账户设置。omp artifact SHALL 保持独立版本和验收范围；导入兼容 MUST NOT 替代安装与行为验证。

omp 安装 SHALL 保留 Main Catalog 与 Skill，并保留可选的子 Agent Pack Catalog 功能；`agent.subagentPackCatalog` MUST 默认 false，由 CLI 消费，不由安装器自动开启或修改用户配置。关闭此项 MUST NOT 关闭 Main Catalog 或已读候选；开启 MUST 只额外提供 Pack 目录元数据，不包含完整 Pack 或 Practice 正文。

#### Scenario: Removing the host integration preserves knowledge
- **WHEN** 用户通过宿主原生机制移除 omp 的 Lorelum artifact
- **THEN** 宿主 SHALL 不再加载该 artifact，已安装 CLI 与 Pack 数据 MUST 保留

#### Scenario: Project-local installation follows host trust
- **WHEN** 用户选择宿主支持的 project scope 安装
- **THEN** Lorelum SHALL 遵循宿主自身的 project scope/trust，不额外建立 Lorelum 审批机制，也不得通过个人级配置绕过宿主 trust
