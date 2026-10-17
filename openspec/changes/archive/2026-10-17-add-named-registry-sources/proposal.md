## Why

当前 `--registry` 只在一次 `lore pack install` 或 `lore pack update` 调用中选择来源。常用团队或社区 Registry 要求用户每次重复输入 Git locator，既容易出错，也无法明确表达“日常默认从哪个来源安装”。同时，Phase 1 把 custom Registry 限定为公开 GitHub 仓库，无法覆盖 GitLab、Gitea、企业自建 Git 或本地团队 Registry worktree。

本 change 引入用户级、可命名的 Registry source catalog 和一个显式 default。它扩展的是 Registry 的保存和选择方式，而不是把 Lorelum 扩展成自动搜索多个 marketplace 的包管理器。

## What Changes

- 新增用户级 named Registry source catalog，以及 `lore registry add`、`list`、`remove`、`set-default` 命令。
- `lore pack install` 与 `lore pack update` 在没有 `--registry` 时使用用户显式设置的 default source；未设置时继续使用内置的 GitHub official Registry。
- `--registry` 同时支持已保存 alias 与一次性 remote Git locator；显式 flag 始终覆盖 default，且一次性 locator 不会被自动保存。
- custom remote source 接受任意平台的安全 HTTPS、SSH URL 或 SCP-style SSH Git repository locator。GitHub 保留为内置 official source 和 `owner/repository` shorthand 的默认 host；既有 GitHub shorthand 与 canonical GitHub HTTPS 保持 public raw descriptor 读取兼容，其他 remote descriptor 走受限 Git transport。
- `lore registry add <alias> --path <repository>` 可保存一个本地 Git Registry worktree。它与直接从本地 Pack directory 安装是两种独立 source：前者要求 Git worktree 与 `.lorelum/registry.yaml`，后者由 `add-local-pack-directory-install` 处理。
- source catalog 使用 CLI 专属的用户级持久化边界，不写入 LocalStore 或 project `.lorelum/config.yaml`，不保存凭据，也不接受 `file:`、`git:`/`git://`、任意 HTTP/raw descriptor 或多 source 自动搜索。
- 补充稳定 JSON envelope、错误恢复、英文/中文用户文档以及 CLI/config 测试覆盖。

## Capabilities

### New Capabilities

- `user-registry-sources`: 用户级 Registry source 的命名、持久化、默认选择、删除恢复和可观察 JSON 管理合同。

### Modified Capabilities

- `pack-management`: install/update 的 Registry 选择扩展为已保存 alias、一次性 locator 和显式 default 的稳定优先级，同时保留既有 GitHub locator 兼容性。

## Impact

- 受影响代码：`packages/cli` 的 generic Git locator resolver、descriptor/materialization route、command registry、install/update 结果和错误映射；`packages/config` 的用户级 catalog 读写与原子恢复；对应单元/命令测试。
- 受影响合同：新增顶层 `lore registry` 命令组；用户设置 default 后，不带 `--registry` 的 install/update 会从该明确来源选择 Pack。
- 受影响文档：`apps/site/content/docs/` 的英文与中文安装/Registry 指南；维护者侧 CLI 与 configuration 文档只说明实现归属并链接用户文档。
- 不新增依赖、本地 MCP、远程 service、project-level Registry、lockfile、签名/信任系统、凭据 provider 或多 Registry aggregation。
