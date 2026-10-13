# Spec Delta

## MODIFIED Requirements

### Requirement: Single public Plugin identity
每个受支持宿主 SHALL 在自己的原生分发机制中暴露恰好一个 Lorelum 集成；使用 marketplace 的宿主 SHALL 在原生 marketplace registration 中暴露恰好一个 Lorelum Plugin。Lorelum 的产品 ID SHALL 为 `lorelum`；host-specific source root SHALL 为 `plugins/<hostKey>/lorelum/`，Pi 的 `hostKey` SHALL 为 `pi`。marketplace namespace、Plugin ID、source root 和 selector MUST 各自指向该宿主唯一的公开分发来源；同一个字符串 selector 可以在不同宿主中出现，但 MUST 被视为 host-local identity，而不得声称是跨宿主全局唯一值。Pi SHALL 使用原生 Package 而非 marketplace selector。

Codex 侧：公开 Codex marketplace SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 Plugin。该 Plugin SHALL 保持显示名 **Lorelum**、source root `plugins/codex/lorelum/` 和 selector `lorelum@lorelum-plugins`。alpha 迁移后，公开文档和开发流程 MUST 只使用 `lorelum-plugins`；不得同时公开 legacy `lorelum@lorelum` selector。

ZCode 侧：仓库根 `marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 ZCode Plugin，source root `plugins/zcode/lorelum/`，selector `lorelum@lorelum-plugins`。ZCode marketplace entry MUST 声明与 `.zcode-plugin/plugin.json` 相同的 version。

Cursor 侧：仓库根 `.cursor-plugin/marketplace.json` SHALL 使用名称 `lorelum-plugins`，并且 SHALL 只暴露一个 ID 为 `lorelum` 的 Cursor Plugin，source root `plugins/cursor/lorelum/`，selector `lorelum@lorelum-plugins`（host-local）。当该 marketplace 参与更新检测时，entry `version` MUST 与 `.cursor-plugin/plugin.json` 的 `version` 一致。Codex 的 `.agents/plugins/marketplace.json`、ZCode 的根 `marketplace.json` 与 Cursor 的 `.cursor-plugin/marketplace.json` MUST 保持相互独立，且不得在其中一个 registration 中声明另一宿主的 artifact。

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
- **THEN** `.cursor-plugin/marketplace.json` entry `version` MUST 与 `.cursor-plugin/plugin.json` `version` 一致并高于已安装版本，使宿主可以判定更新可用

#### Scenario: Host registrations remain independent
- **WHEN** 仓库同时承载 Codex、ZCode 与 Cursor 三个宿主 artifact
- **THEN** 三个 registration 文件 MUST 各自只声明本宿主的 source root，且任一 registration 中 MUST NOT 出现指向其他宿主 artifact 的条目

#### Scenario: Pi does not reuse another host marketplace
- **WHEN** 用户安装 Lorelum Pi 集成
- **THEN** Pi SHALL 加载 Pi Package，且 Codex、Claude Code 等其他宿主 registration MUST 不注册该 artifact

## ADDED Requirements

### Requirement: Pi Package loads Extension and Skill together
`plugins/pi/lorelum/` SHALL 提供一个原生 Pi Package，以 manifest 明确声明唯一 Extension 入口和名为 `lorelum` 的 Skill；测试文件与辅助模块 MUST 不被误加载为独立 Extension。安装指引 SHALL 提供可实际使用的安装来源、信任说明、更新和移除路径，不得使用未经支持的 Git 子目录语法或未发布的 npm 包。该包 MUST 不携带 CLI、Store 或模型 runtime，也 MUST 不绕过 Pi 的项目信任决策。

#### Scenario: A user installs the Pi Package
- **WHEN** 用户按文档安装 Package 并允许 Pi 加载
- **THEN** 同一安装 MUST 同时发现 Lorelum Extension 和 Skill，而不要求用户手工复制两个资源

#### Scenario: A user removes the Pi integration
- **WHEN** 用户按文档移除 Pi Package
- **THEN** 移除 MUST 不卸载独立的 Lorelum CLI 或删除已安装 Pack

#### Scenario: Project package awaits trust
- **WHEN** Package 被声明为项目级资源但用户尚未授权项目信任
- **THEN** 集成 MUST 不在项目信任之前执行 Extension，也不得额外自行修改宿主设置或批准项目
