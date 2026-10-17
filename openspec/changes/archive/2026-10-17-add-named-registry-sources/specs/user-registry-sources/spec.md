## Purpose

为用户提供可命名、可检查、可恢复的 Registry source catalog，使常用团队或社区 Pack Registry 不必在每次命令中重复输入完整 locator，同时让默认来源与实际供应链选择保持可预期。

## ADDED Requirements

### Requirement: Named user Registry source lifecycle

CLI SHALL 提供 `lore registry add <alias> <locator>`、`lore registry add <alias> --path <repository>`、`lore registry list` 与 `lore registry remove <alias>`，用于管理用户级 named Registry source。alias MUST 是单个 lowercase kebab-case token；`official` MUST 保留为内置只读 source，且不得由用户新增、覆盖或删除。

`add` MUST 在持久化前以所选 source 的读取规则验证 `.lorelum/registry.yaml`；仅当 locator 或本地 worktree 与 descriptor 均有效时，CLI 才能保存 alias。已存在 alias 以同一 canonical source 再次 add MUST 幂等成功；以不同 source add MUST 返回 `registry.alias-conflict` 且保留原记录。`list` MUST 在同一 JSON result 中列出内置 official source、所有保存 source 与当前 default，但不得为了 list 访问 remote。

#### Scenario: Add a valid remote Git Registry source
- **WHEN** 用户执行 `lore registry add team ssh://git@git.example.com/platform/team-packs.git`，且该 remote Git repository 的 `.lorelum/registry.yaml` 有效
- **THEN** CLI MUST 保存 alias `team`，成功 result MUST 标识该 alias、无凭据的 remote repository identity 与它不是 default，后续 list MUST 包含该 source

#### Scenario: Add a valid local Git Registry worktree
- **WHEN** 用户执行 `lore registry add local-team --path ./fixtures/team-registry`，且该目录位于可读 Git worktree、其 `HEAD` 含有效 `.lorelum/registry.yaml`
- **THEN** CLI MUST 保存 `local-team` 的 canonical worktree root；后续 list 与 Pack mutation 可以使用 alias，但成功 JSON result、错误与 LocalStore MUST NOT 回显该机器绝对路径

#### Scenario: Failed validation leaves no source behind
- **WHEN** 用户 add 的 locator 不合法、本地目录不是有效 Git worktree、Registry 不可访问或 descriptor 无效
- **THEN** CLI MUST 返回对应的稳定 Registry error，且 list MUST 不包含该 alias，也不得改变既有 default 或其他 source

#### Scenario: Repeating the same registration is idempotent
- **WHEN** 用户以已保存 alias 的相同 canonical source 再次执行 `lore registry add`
- **THEN** CLI MUST 成功并标识操作为 idempotent，且不得新增重复记录或修改 default

### Requirement: Explicit default source and safe removal

CLI SHALL 提供 `lore registry set-default <alias|official>`。`set-default` MUST 只接受保存的 alias 或内置 `official`，且 MUST 持久化选择；选择 `official` 可以清除用户 override。`add` MUST NOT 隐式修改 default。删除非 official source 后，未来 source selection MUST 不再解析该 alias；若删除的 source 是 default，CLI MUST 在同一原子更新中将 default 恢复为 `official`，不得留下悬空 default。

#### Scenario: Explicit default changes unqualified Pack mutations
- **WHEN** 用户已保存 `team` 并执行 `lore registry set-default team`
- **THEN** 成功 result MUST 标识 `team` 为 default；直到用户再次选择其他 default 或移除该 source，未带 `--registry` 的 Pack mutation MUST 选择 `team`

#### Scenario: Removing the default restores the safe built-in source
- **WHEN** 用户移除当前 default alias `team`
- **THEN** CLI MUST 移除 `team` 并在同一成功 result 中标识 default 已恢复为 `official`

#### Scenario: Built-in official source cannot be removed
- **WHEN** 用户执行 `lore registry remove official`
- **THEN** CLI MUST 返回 invalid invocation error，且 source catalog 与 default MUST 保持不变

### Requirement: Source catalog privacy, integrity, and isolation

Registry source catalog MUST 独立于 LocalStore 与 project `.lorelum/config.yaml`。它只可持久化 alias、受允许的无凭据 remote locator 或 canonical local Git worktree path，以及 default selection。local worktree path 只可作为私有 catalog state 保存。catalog 读写 MUST 使用严格 schema、regular-file/symlink 防护、私有权限、跨进程互斥和原子替换；失败时 MUST 保留先前完整 catalog。

catalog 不可安全读取或 mutation lock 在有界等待内不可获得时，Registry management 与依赖 default 的 Pack mutation MUST 分别返回 `registry.catalog-invalid` 或 `registry.catalog-busy`。它们 MUST NOT 静默 fallback 到 official 或任意其他 Registry。公开 JSON result、错误、LocalStore 与可公开 Pack metadata MUST NOT 包含 token、credential-helper 数据、SSH private key、Registry source worktree path、`file:` locator 或 temporary source path；这不改变既有 Store `packRoot` result 的语义。

#### Scenario: User source state does not follow an isolated Store
- **WHEN** 用户以 `--store-root` 执行 Pack install 或 update
- **THEN** source catalog 与 default selection MUST 与未传 `--store-root` 时相同，且该 Store 中不得出现 Registry source catalog state

#### Scenario: Malformed catalog does not silently change supply source
- **WHEN** source catalog 无法安全读取或校验
- **THEN** Registry management 和依赖 default 的 Pack mutation MUST 返回 `registry.catalog-invalid`，且不得改用 official 或任意其他 Registry

### Requirement: Platform-neutral remote Git locator boundary

custom remote Registry source MUST 接受 `https://<host>/<repository-path>[.git]`、`ssh://[user@]<host>[:port]/<repository-path>[.git]` 与 `[user@]<host>:<repository-path>[.git]`。repository path MUST 支持 nested namespace，也 MAY 是单段 repository path；SSH URL 的 user 与 custom port MUST 被保留为访问身份，而 HTTPS locator MUST NOT 包含 username 或 password。GitHub `owner/repository` shorthand SHALL 保留为将该 shorthand 定位到 GitHub remote 的便利写法，内置 `official` 仍以 GitHub official repository 为默认 source。

只要输入严格匹配既有 GitHub shorthand 或 `https://github.com/<owner>/<repository>[.git]`（无 port、userinfo、query、fragment 且恰有两段 repository path），它 MUST 保持 anonymous raw descriptor 读取和当前错误行为。所有其它已接受 HTTPS remote（包括 github.com 的 non-legacy endpoint）与所有 SSH remote MUST 通过受限 Git transport 从 repository default branch 读取 descriptor。remote locator MUST 表示 Git clone endpoint；CLI MUST NOT 推断网页、`tree`、release 页面或 raw `.lorelum/registry.yaml` URL。

custom remote source MUST NOT 接受 bare/local path、`file:`、`http:`、`git:`/`git://`、`ext::`、unknown scheme、URL password、query、fragment、控制字符或 path traversal。CLI MUST 禁止交互 prompt、credential helper 与 token 存储；private HTTPS 若不能在该 non-interactive Git sandbox 中访问，MUST 返回 `registry.unavailable`，且不得建议把 token 写进 locator。

#### Scenario: GitLab-style HTTPS remote is accepted
- **WHEN** 用户以 `https://gitlab.example.com/platform/team-packs.git` add 或作为一次性 `--registry` locator
- **THEN** CLI MUST 将它作为 remote Git repository 读取 descriptor，不得因非 GitHub host 而拒绝，也不得尝试 GitHub raw URL

#### Scenario: Nested SSH repository path and port are accepted
- **WHEN** 用户传入 `ssh://git@git.example.com:2222/group/subgroup/team-packs.git`
- **THEN** CLI MUST 保留该 remote Git identity、namespace path 与 port，并通过 SSH Git transport 读取 descriptor

#### Scenario: A single-segment SCP repository remains a remote locator
- **WHEN** 用户以 `--registry git@git.example.com:team-packs.git` 安装 Pack，且 `git@git.example.com` 不是保存 alias
- **THEN** CLI MUST 将整个值交给 remote Git locator resolver，而不得将它误判为 unknown alias

#### Scenario: A non-legacy GitHub HTTPS endpoint uses Git transport
- **WHEN** 用户传入 `https://github.com:8443/acme/team-packs.git`
- **THEN** CLI MUST 将该完整 endpoint 交给 Git transport，不得生成或请求 GitHub raw URL

#### Scenario: Unsupported transports and credential-bearing remotes remain rejected
- **WHEN** 用户传入 `file:///tmp/team-packs`、`git://git.example.com/team-packs.git`、直接 registry YAML URL、HTTPS userinfo 或 SSH password
- **THEN** CLI MUST 返回 `registry.invalid`，且不得发起 Git transport 或持久化 source

### Requirement: Local Git Registry remains local-only even for promisor worktrees

选择保存的 local Git Registry 时，descriptor 与 release materialization MUST 只读取该 canonical worktree
现有的 Git object database。local runner MUST 禁用 implicit lazy fetch、所有 network/helper protocol 与会
改写用户 repository 的 Git operation；它 MUST NOT clone、fetch、checkout、更新 ref 或修改 Git config。
若 descriptor、tree 或 blob 在本地 object database 中不可读，CLI MUST 返回 `source.unavailable`，不得尝试
从 remote 补取对象。

#### Scenario: A promisor worktree missing a required object does not access its remote
- **WHEN** 已保存 local Git Registry 的 object database 缺少 descriptor 或 selected release 所需对象
- **THEN** CLI MUST 返回 `source.unavailable`，且测试可观察到没有 network Git command、remote helper 或用户
  worktree mutation
