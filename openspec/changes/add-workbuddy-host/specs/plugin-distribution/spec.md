# plugin-distribution Delta

## MODIFIED Requirements

### Requirement: Single public Plugin identity
每个受支持宿主 SHALL 在自己的原生 marketplace registration 中暴露恰好一个 Lorelum Plugin。Lorelum 的产品 ID SHALL 为 `lorelum`；host-specific source root SHALL 为 `plugins/<hostKey>/lorelum/`，其中当前 `hostKey` 为 `codex`、`workbuddy` 或 `zcode`。marketplace namespace、Plugin ID、source root 和 selector MUST 各自指向该宿主唯一的公开分发来源；同一个字符串 selector 可以在不同宿主中出现，但 MUST 被视为 host-local identity，而不得声称是跨宿主全局唯一值。

Codex 侧：公开 Codex marketplace SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 Plugin。该 Plugin SHALL 保持显示名 **Lorelum**、source root `plugins/codex/lorelum/` 和 selector `lorelum@lorelum-plugins`。alpha 迁移后，公开文档和开发流程 MUST 只使用 `lorelum-plugins`；不得同时公开 legacy `lorelum@lorelum` selector。

ZCode 侧：仓库根 `marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 ZCode Plugin，source root `plugins/zcode/lorelum/`，selector `lorelum@lorelum-plugins`。ZCode marketplace entry MUST 声明与 `.zcode-plugin/plugin.json` 相同的 version。

WorkBuddy 侧：仓库根 `.codebuddy-plugin/marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 WorkBuddy Plugin，source root `plugins/workbuddy/lorelum/`，selector `lorelum@lorelum-plugins`。WorkBuddy marketplace entry MUST 声明与 `plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json` 相同的 version。

Codex 的 `.agents/plugins/marketplace.json`、WorkBuddy 的根 `.codebuddy-plugin/marketplace.json` 与 ZCode 的根 `marketplace.json` MUST 保持独立，且不得在其中一个 registration 中声明另一宿主的 artifact。

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

#### Scenario: WorkBuddy marketplace installation
- **WHEN** 用户在 WorkBuddy 中将 Lorelum 仓库或本地目录添加为 marketplace，并安装 Lorelum Plugin
- **THEN** WorkBuddy SHALL 从仓库根 `.codebuddy-plugin/marketplace.json` 的 `lorelum-plugins` 安装 `lorelum` Plugin，且已安装 selector 为 `lorelum@lorelum-plugins`

#### Scenario: WorkBuddy Plugin update is discoverable
- **WHEN** 新版本 WorkBuddy Plugin 发布到同一 marketplace
- **THEN** marketplace entry version MUST 与 `plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json` version 一致并高于已安装版本，使宿主可以判定更新可用
