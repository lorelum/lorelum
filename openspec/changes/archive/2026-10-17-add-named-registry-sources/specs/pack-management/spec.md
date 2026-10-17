## ADDED Requirements

### Requirement: Saved Registry selector precedence

`lore pack install` 与 `lore pack update` 的 `--registry` MUST 同时接受已保存的 Registry alias 和一次性 remote Git locator。显式 `--registry` MUST 覆盖用户 default；未提供该 flag 时，命令 MUST 使用用户显式设置的 default，且未设置 default 时 MUST 使用内置 official Registry。

一次性 locator 的 GitHub `owner/repository` shorthand 与受允许 remote Git URL 形态 MUST 保持兼容，并且不得因为使用该形态而自动创建、修改或选择持久 source。仅不含 `/`、`:` 或 URL delimiter 的 lowercase kebab-case token 才是 alias candidate：`official` 选择内置 source，已保存 candidate 选择该 alias，不存在的 candidate 返回 `registry.alias-not-found`；其余输入必须交给 remote locator resolver。default Registry 中缺少 Pack、选定 source 不可用或 release 不存在时，CLI MUST 返回该选择对应的明确错误，MUST NOT 自动搜索其他保存 source 或 fallback 到 official。

#### Scenario: Saved remote alias is selected explicitly
- **WHEN** 用户已保存 remote alias `team`，并执行 `lore pack install engineering-basics --registry team`
- **THEN** CLI MUST 从 `team` 的 source 解析 release，且成功 result MUST 标识 remote Registry、所选 alias 与 resolved Git source

#### Scenario: Default source is used without a flag
- **WHEN** 用户将 `team` 设置为 default，并执行未带 `--registry` 的 `lore pack update engineering-basics`
- **THEN** CLI MUST 只从 `team` 解析目标 release，不得额外查询 official 或其他保存 source

#### Scenario: Direct remote Git locator remains transient
- **WHEN** 用户执行 `lore pack install engineering-basics --registry https://gitlab.example.com/acme/team-packs.git`
- **THEN** CLI MUST 通过该 remote Git source 读取 descriptor，并且 `lore registry list` 的保存 source 与 default MUST 不发生变化

#### Scenario: Saved local Git Registry is selected by alias
- **WHEN** 用户已用 `lore registry add local-team --path ./fixtures/team-registry` 保存 source，随后执行 `lore pack install engineering-basics --registry local-team`
- **THEN** CLI MUST 从该 local Git Registry 的 current `HEAD` 读取 descriptor，并从同一 worktree 的 Git object database 物化 release；结果、错误与 LocalStore MUST NOT 包含该 Registry source 的 worktree path、`file:` locator 或 temporary source path；既有 Store `packRoot` 字段保持原有语义

#### Scenario: Unavailable selected source does not fallback
- **WHEN** 显式 alias 或 default source 不可访问，或其中不存在请求的 Pack
- **THEN** CLI MUST 返回相应 Registry error，且不得改从 official 或其他保存 source 安装同名 Pack

### Requirement: Registry source identity in Pack mutation results

Registry-backed Pack mutation 成功结果 SHALL 保持现有 remote `registry.name` 与 `registry.repository` 字段。对保存或 transient 的 non-legacy remote source，`repository` MUST 是无凭据且 host-inclusive 的 stable display identity；GitHub legacy source SHALL 继续报告 `owner/repository`。对保存的 local Git Registry，结果 MUST 改用不含 `repository` 的 local-registry result branch：`registry` 至少标识 descriptor `name` 与 saved `alias`，`source` 至少标识 `{ type: "local-git", ref, commit }`，且不得以虚假的远程 repository 或 Registry worktree path 替代它。既有 Store `packRoot` 字段保持现有语义。

#### Scenario: Local Registry result redacts its worktree
- **WHEN** Pack mutation 从保存的 local Git Registry 成功完成
- **THEN** JSON result MUST 能区分 local Git Registry 与 remote Git Registry，且不得包含 Registry worktree path、`file:` locator 或 credential material
