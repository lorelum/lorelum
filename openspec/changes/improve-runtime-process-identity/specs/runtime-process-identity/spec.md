## Purpose

定义 Lorelum 既有运行时在操作系统进程监视工具中的可辨认名称，以及 Windows 主 CLI 的品牌资源边界，使用户不必仅凭 `bun` 或上游 native 名称猜测进程角色，也不把当前 embedding 用途固化为长期进程身份。

## ADDED Requirements

### Requirement: Existing runtime roles have readable names
Lorelum SHALL 保持唯一的用户命令入口 `lore`。启动 Backend daemon 时，系统 MUST 在宿主 spawn API 支持时以 `lore-backend` 作为 child 的进程显示名；宿主不支持该显示行为时，Backend lifecycle MUST 保持现有语义，且不得为此新增第二个 executable。受 manifest 保护的 native model executable MUST 使用 `lore-model` 名称（Windows target 使用相应的 `.exe` 扩展名），且该名称不得承诺或限制当前模型能力。

#### Scenario: Host supports a Backend display name
- **WHEN** 用户启动 Backend 的宿主支持 child process display name
- **THEN** 常驻 daemon MUST 以 `lore-backend` 可辨认，native model runtime MUST 以 `lore-model` 的 executable name 可辨认

### Requirement: Windows CLI carries Lorelum visual identity
Windows target 的 `lore.exe` MUST 嵌入 Lorelum 产品标题、产品描述和品牌 icon 资源。本 change 不 SHALL 为 native executable 添加 Windows icon，也不 SHALL 将 macOS/Linux 的裸 CLI 或 daemon 打包为 `.app`、LaunchAgent、`.desktop` 或其他 GUI 常驻面。

#### Scenario: Inspecting the Windows CLI
- **WHEN** 用户在 Windows Explorer 或资源管理器中检查已安装的 `lore.exe`
- **THEN** 它 MUST 显示 Lorelum 的品牌视觉资源
