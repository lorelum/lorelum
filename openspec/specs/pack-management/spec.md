# pack-management Specification

## Purpose

为 Registry Pack 的选择、安装和更新提供稳定的版本解析合同，使用户文档可以默认使用最新稳定发行版，同时仍能显式固定可复现版本。

## Requirements

### Requirement: Registry release selection
`lore pack install <name>` SHALL 在未指定版本时解析 selected Registry 中该 Pack 的最高稳定 SemVer release，且不得依赖 Registry YAML 的排列顺序。`lore pack install <name>@<version>` MUST 只解析该精确版本；不存在的 Pack、没有稳定 release 或不存在的精确版本 MUST 返回明确的 Registry error，且不得降级为其他 release。

#### Scenario: Unpinned installation chooses the latest stable release
- **WHEN** Registry 为一个 Pack 提供多个稳定 release，调用方执行未带 `@version` 的 install
- **THEN** CLI MUST 安装其中版本最高的稳定 release

#### Scenario: Exact version is unavailable
- **WHEN** 调用方请求 Registry 未声明的精确 Pack 版本
- **THEN** CLI MUST 返回 version-not-found error，且不得安装最新或其他版本

### Requirement: Install and update replacement boundary
安装结果 SHALL 标识其解析到的 Pack 版本与来源。当同名已安装 Pack 的 artifact 与请求 release 不同而不能作为 idempotent install 保留时，`lore pack install` MUST 返回 update-required；调用方 MUST 使用 `lore pack update` 替换已安装 Pack。Pack canonical commit 与 install 后 `indexSync` 的 ready、pending、failed 语义仍由 `semantic-index` 负责。

#### Scenario: Changed installed Pack requires explicit update
- **WHEN** 已安装 Pack 与 selected Registry release 的 artifact 不同
- **THEN** install MUST 返回 update-required，并且不得静默替换已安装内容

### Requirement: Registry locator transport
`lore pack install` 与 `lore pack update` 的 `--registry` locator SHALL 支持 GitHub slug、GitHub HTTPS URL 与 GitHub SSH URL 三种形态，并按形态选择 descriptor 读取传输。SSH URL 输入 MUST 仅接受 github.com host，MUST 接受 `git@github.com:owner/repo.git` 与 `ssh://git@github.com/owner/repo.git` 两种写法，MUST 从 URL 提取 slug 用于校验与展示，并 MUST 从用户提供的 URL 派生物化用 git URL 而不将其重写为其他传输。SSH URL 的 descriptor 读取 MUST 经同一 git 传输完成，且 256KB 大小上限、schema 校验与错误分类 MUST 与匿名 raw 路径一致。

#### Scenario: SSH locator installs from a private repository
- **WHEN** 调用方以 `--registry git@github.com:owner/private-repo.git` 执行 install，且当前环境 git 已能以 SSH 访问该仓库
- **THEN** CLI MUST 完成安装，install → list → get 行为与公开仓库一致

#### Scenario: ssh:// syntax is equivalent
- **WHEN** 调用方以 `--registry ssh://git@github.com/owner/repo.git` 指定与 `git@github.com:owner/repo.git` 相同的仓库
- **THEN** CLI MUST 解析出相同 slug 并走相同 git 传输

#### Scenario: Non-github host is rejected
- **WHEN** 调用方以 host 非 github.com 的 SSH URL 指定 registry
- **THEN** CLI MUST 返回 registry invalid error，且不发起网络访问

### Requirement: Legacy locator compatibility
`owner/repo` slug 与 `https://github.com/owner/repo(.git)` 输入的 Registry 解析行为 SHALL 保持不变：MUST 继续经既有匿名 raw 路径读取 descriptor，其成功与失败输出（含错误消息）MUST 与本要求生效前逐字一致。

#### Scenario: Slug input keeps anonymous raw path
- **WHEN** 调用方以 `--registry owner/repo` 或 `--registry https://github.com/owner/repo.git` install 公开仓库
- **THEN** CLI MUST 走匿名 raw 路径，所有输出与本要求生效前一致

#### Scenario: Legacy input never switches transport
- **WHEN** 任一 legacy 形态 locator 指向的仓库为私有或不可达
- **THEN** CLI MUST 沿用匿名 raw 路径的错误行为，MUST NOT 自动回退或重试 git 传输

### Requirement: Non-interactive SSH transport
git 传输 SHALL 全程非交互：SSH 首连 host key 确认、key passphrase 等交互提示 MUST 确定性快速失败，任何场景 MUST NOT 挂起等待交互输入。

#### Scenario: Untrusted host key fails fast with guidance
- **WHEN** SSH 首连遇到 known_hosts 无条目的 host
- **THEN** CLI MUST 快速失败返回 `registry.unavailable`，消息含先以 `ssh -T git@github.com` 验证访问的指引，且不得挂起

#### Scenario: Inaccessible repository is indistinguishable
- **WHEN** 当前环境对目标私有仓库无 SSH 访问权限，或该仓库不存在
- **THEN** CLI MUST 对两种情形返回相同的 `registry.unavailable` 分类，MUST NOT 区分"不存在"与"无权限"

### Requirement: Registry descriptor freshness
git 传输的 descriptor SHALL 每次 install/update 现拉，MUST NOT 引入本地缓存。

#### Scenario: Newly pushed release is immediately installable
- **WHEN** 调用方向 git 传输 registry 推送新 release tag 后立即执行 install
- **THEN** CLI MUST 解析到该新 release，无需任何缓存失效操作

### Requirement: Credential hygiene
任何命令输出、错误信息与 store 记录 MUST NOT 出现携带 userinfo 的 URL 或其他凭据内容。git 传输 MUST 复用既有物化沙箱环境语义（不读取用户全局 git 配置，credential helper 与 `insteadOf` 不生效），SSH agent 密钥经 `SSH_AUTH_SOCK` 环境透传保持可用。

#### Scenario: No credentials in output
- **WHEN** 以任一形态 locator 执行 install 并成功或失败
- **THEN** JSON envelope、错误消息与 store 记录 MUST NOT 包含 userinfo 或 token

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

### Requirement: Registry and local directory source routes are exclusive
`lore pack install` 与 `lore pack update` SHALL 支持 selected Registry release 或显式 local Pack directory 两条 source route。Registry route 保留 Pack specifier 和 Registry selection 行为；local directory route 只通过 non-empty `--path <directory>` 选择，且其 source acquisition MUST NOT 读取 Registry、解析 release version、执行 Git 或访问 Registry/network source client。canonical install 完成后的既有 `indexSync` lifecycle 不因 source route 改变。

两条 route MUST 共享现有 LocalStore replacement boundary：同一 canonical artifact 的 install MUST 幂等成功；同名但 artifact 不同的 local install MUST 返回 `pack.update-required`，而 local update MUST 执行显式替换。`--store-root` 对 local route 的 Store selection 与 Registry route 一致。local install MUST 继续满足 `semantic-index` 中的 install `indexSync` requirement；local update 保持当前 update 的 result/lifecycle，不因本 change 触发 indexSync。

#### Scenario: Local install preserves the explicit update boundary
- **WHEN** 已安装 `team-pack` 与 `lore pack install --path ./team-pack` 读取的 artifact 不同
- **THEN** CLI MUST 返回 `pack.update-required`，且不得静默覆盖现有 Pack

#### Scenario: Local route honors an isolated Store
- **WHEN** 用户执行 `lore --store-root ./scratch pack install --path ./team-pack`
- **THEN** CLI MUST 只修改 `./scratch` 选择的 LocalStore，不得修改 default Store、Registry catalog 或项目配置

#### Scenario: Local source acquisition does not enter the Registry pipeline
- **WHEN** 用户执行任一合法 `pack install --path` 或 `pack update --path` 命令
- **THEN** source acquisition MUST 不调用 Registry selector、descriptor loader、release resolver、Git materializer 或 Registry/network source client；合法 local install 的后置 indexSync 仍遵循既有 install contract
