## Context

See [proposal.md](./proposal.md) for the user problem. 当前 `loadRegistry(locator?)` 只把 GitHub slug 或 canonical GitHub HTTPS URL 转换为 `raw.githubusercontent.com` descriptor URL；`pack.install` 与 `pack.update` 把 `--registry` 原样交给它。当前 `materializeRegistryRelease()` 已按同一 repository 的 release `ref/path` 物化受限 Pack tree，但它只接受 remote Git URL。相应当前证据是 `packages/cli/src/install/load-registry.ts`、`install-command.ts`、`materialize-source.ts` 及其测试。

已接受 ADR 0008 将持久 `registry add`、本地 source、私有 Git 与其他 host 明确排除在 Phase 1 外；这不是遗漏。该 change 因而必须以新合同取代这条限制，同时保持一个 Registry 的 release 仍在同一 repository 内解释。Phase 1 的 `pack-management` release/version 解析和 LocalStore replacement boundary 不属于本 change 的重新设计范围。

`@lorelum/config` 的共享 `config.yaml` 当前只支持读取与首次创建，刻意不合并或改写已有用户文档，见 `packages/config/src/document/load.ts`、`initialize.ts`。project `.lorelum/config.yaml` 严格只拥有 `inherit`、`base`、`packs`，见 `packages/config/src/project.ts`。因此可变 Registry catalog 不能伪装成 LocalStore state、共享 config 的未知 section 或 project configuration。

PR #189 已审查的 Git descriptor reader 是此设计的实现基线依赖：在泛化 host 前，实施分支必须基于已合入的 #189，或在同一经过审查的实现中吸收其 partial-clone、非交互 Git 与资源回归测试，不能同时维护两套会分叉的 loader。

## Goals / Non-Goals

**Goals:**

- 用一个 CLI-owned catalog 保存 alias、明确 default 与所需的 source 类型，而不改变 Pack canonical data 的归属。
- 给 remote Git、local Git Registry 和 transient locator 各自清晰的解析、读取、物化和输出边界。
- 保留 GitHub 的默认/快捷使用体验及现有 public raw descriptor 合同，同时让其他 Git 平台只依赖 Git protocol。
- 让单次 Pack mutation 在 source 选择、descriptor、release materialization 和 JSON result 上保持同一 provenance，而不自动改源或漏出本地私密路径。

**Non-Goals:**

- 不接受本地 **Pack directory** 作为 Registry locator；它属于 `add-local-pack-directory-install`，不需要 Git 或 Registry descriptor。
- 不实现 Registry discovery、多个 source 的搜索/排序/fallback、mirror、lockfile、签名、checksum、credential provider、token storage 或 descriptor cache。
- 不把 `file:`、`git://`、remote helper、网页 URL 或任意 raw YAML URL 当作“任意 Git 平台”的一部分。

## Decisions

### 1. 用独立的严格 catalog 表达 source，而不是扩展 shared/project config

`@lorelum/config` 新增 Registry catalog store，路径从 `resolveLorelumPaths()` 派生为 `~/.lorelum/registries.yaml`。它是 CLI 专属文件：读取时不创建，缺失等价于无保存 source 且 default 为 `official`；`official` 不写入文件。建议的持久化模型为：

```yaml
schema_version: 1
default: team                 # 缺失或 official 均表示 built-in official
registries:
  team:
    kind: remote-git
    locator: ssh://git@git.example.com/platform/team-packs.git
  local-team:
    kind: local-git
    worktree: /private/canonical/path # 只在本机私有 catalog 保存
```

schema 不接受未知字段、空值、非法 alias、credential-bearing locator 或公开 source 类型外的记录。Remote record 保存 resolver 的 canonical 无凭据 locator；local record 保存 registration 时 canonicalized 的 worktree root。远端 descriptor `registry.name` 不能作为本地 alias，因为它可变且可以重名。

该 store 是 schema 校验、regular-file/symlink 防护、私有目录/文件权限、bounded lock、atomic durable replace 的唯一所有者。Mutation 在锁内重新读取最新 catalog、生成完整 target document、写入同目录临时 regular file、sync 后 replace，完成前任何错误保留旧文件。Lock 竞争只在有限时间内等待，失败为 typed busy；读取或写入损坏 catalog 不回退到 official。这避免把“配置读取失败”悄悄转化为另一条供应链。

不复用 shared `config.yaml`，因为其当前 contract 是各 consumer 读取自有 section、初始化不写已有文件；为此引入通用 YAML merge 会错误扩大未知字段、注释和并发覆盖责任。也不使用 project config，因为该文件可提交共享，而 team SSH access 通常是每个用户自己的私有环境。

### 2. Selector 先决定 provenance，再让 reader/materializer 做一种 source 的工作

CLI 将 `--registry` 和 catalog 解成内部 `RegistrySelection`，而不是继续在 install handler 内传递裸 string：

```ts
type RegistrySelection =
  | { kind: "official"; alias: "official" }
  | { kind: "saved-remote"; alias: string; locator: RemoteGitLocator }
  | { kind: "transient-remote"; locator: RemoteGitLocator }
  | { kind: "saved-local"; alias: string; worktreePath: string };
```

解析顺序固定：只有不含 `/`、`:` 或 URL delimiter 的 lowercase kebab-case token 才是 alias candidate；`official` 先选择内置 source，已保存 candidate 选择该 alias，不存在的 candidate 返回 `registry.alias-not-found`。含 SSH/SCP delimiter、URL 或 slash 的输入必须先由 remote locator resolver 解释，因此 `git@git.example.com:team-packs.git` 即使 repository path 只有一段也不会被当作 alias。显式 `--registry` 覆盖 default；无 flag 使用保存 default 或 official。`registry add` 永不修改 default，`remove` default alias 与恢复 `official` 在同一 catalog mutation 中完成。选中 source 缺 Pack、release 不存在或不可访问时就返回该 source 的错误，不搜索别的 catalog entry，也不 fallback official。

选择前先确立 alias/provenance 可避免临时 locator 被误写入 catalog，也让最终 JSON result 不必从 remote descriptor 或 LocalStore 反推“本次从哪来”。它比“每次 add 自动改 default”和“安装时搜索所有 Registry”多一个明确操作，却不会引入 Pack 重名、优先级、网络 fan-out 与不透明来源。

### 3. Remote locator 只放开常见安全 Git endpoints，不放开 Git 的全部 transport 面

`RemoteGitLocator` resolver 是 CLI 的唯一 remote 输入校验点。它接受 GitHub shorthand、HTTPS Git URL、SSH URL 与 SCP-style SSH；保留 custom host、port、SSH user 和 nested repository path。GitHub shorthand 被转为 GitHub remote，未提供 source 时 official 也解析为 GitHub remote。Generic path 不强行补/删 `.git`、不 lower-case repository path，也不把 SCP relative path 重写为 SSH URL，因为这些变换不能保证对任意 server 等价。

resolver 在 URL 规范化前验证原始输入，拒绝 whitespace/control character、NUL、backslash、empty path、dot traversal、query/fragment、HTTP userinfo/password 与 SSH password。SSH `user@host` 是允许的访问身份，并非 HTTPS credential；`file:`、`http:`、`git:`、`git://`、`ext::`、unknown scheme、bare local path 和 known raw `.lorelum/registry.yaml` locator 都在 spawn Git 之前拒绝。SCP IPv6 不作为本期 promise；用户可用 bracketed `ssh://` URL。

Remote Git spawn 使用 argument vector，不经 shell；继承 #189 的非交互 environment，禁用 global/system Git config、credential helper 和 askpass，保留正常 SSH agent/known-host verification，不设置 `StrictHostKeyChecking=no`。显式 Git config 将 protocol 默认设为 deny，并只允许 HTTPS/SSH，防止 `insteadOf` 或 remote helper 改写到 file/helper transport。private HTTPS 无法在该 sandbox 中访问时返回 generic `registry.unavailable`；文档建议检查 repository 的 non-interactive access，不要求或储存 token。

### 4. GitHub legacy descriptor 保持 raw 路径；generic remote 使用 Git，不在两者之间猜测 fallback

`owner/repository` 与严格匹配 `https://github.com/<owner>/<repository>[.git]` 的 canonical HTTPS 继续通过 GitHub raw/CDN 读取 `.lorelum/registry.yaml`，保持当前 public source 的性能与错误兼容。判定不匹配时（包括 github.com custom port、非两段 path 或任何 SSH form），已接受 locator 一律通过 sandboxed Git descriptor route：对默认 branch 请求 shallow partial clone，并以 `git show HEAD:.lorelum/registry.yaml` 在严格输出上限内读取。

descriptor decode 仍使用 `RegistrySchema`。Generic reader 不构造 `raw.githubusercontent.com` URL；raw 读取失败也不尝试 SSH/credential-helper fallback，Git reader 失败也不重新猜 raw 地址。`--filter=tree:0` 只是向支持的 server 请求 partial clone；descriptor 输出上限和 command timeout 是硬边界，但初始网络传输不是跨所有 server 的严格字节上限。测试必须覆盖 server 忽略 filter 的兼容结果，并如实记录这一限制。

Remote release materialization 延用已经受限的 Git tree/blob route，且使用 descriptor 所属的同一 validated remote locator；不得让 Registry descriptor 指向第二个 repository。对 remote result，legacy GitHub 继续输出 `owner/repository`；generic remote 输出 host-inclusive、无凭据 display locator，防止不同 host 的同一路径在日志/JSON 中混淆。

### 5. `registry add --path` 是受限 local Git Registry，不是 `file:` remote

`--path` 与 add 的 positional locator 互斥。CLI 先解析输入为当前 cwd 下的 absolute path，随后用受控 filesystem/Git checks 取得 `git rev-parse --show-toplevel` 的 realpath；这允许用户从 worktree 子目录注册，但 catalog 固定保存其 top-level canonical root。验证 `HEAD` 可读且 `git -C <root> show HEAD:.lorelum/registry.yaml` 能通过 descriptor schema 后，才可以写 catalog。

选择 local Git source 时，descriptor 从该 worktree 的 current `HEAD` 读取。local runner 必须禁用 implicit lazy fetch、所有 network/helper protocol 与会改写 repository 的 Git operation；因而 promisor worktree 中缺失的 descriptor/tree/blob 直接映射 `source.unavailable`，不从 origin 补取。release materialization 在同一 worktree/object database 内 resolve release ref 到 commit、检查 tree 并以现有受限 tree/blob materializer 写入一次性 temporary Pack directory；它不得 clone、fetch、访问 network、checkout、更新 ref 或修改 Git config。随后仍交给 `decodePackDirectory()` 和 LocalStore；temporary source 从不成为 Store provenance。local result branch 为 `registry: { name, alias }` 与 `source: { type: "local-git", ref, commit }`，没有 `registry.repository`、worktree path 或 temporary source path；既有 Store `packRoot` 保持其原有语义。

该 route 让团队能持续从本机工作副本验证一个 Registry catalog，又不会把任意目录或 `file:` transport 混入 remote locator 的安全规则。直接目录 Pack install 明确留给另一个 change：它既不检查 Git，也不读取 `.lorelum/registry.yaml`。

### 6. JSON protocol 与错误在选择边界清楚地区分输入、catalog 与读取失败

新增 registry command definitions 必须像现有命令一样声明 result schema、visible error allowlist、describe metadata 与 `[0, 2]` exit contract。建议 CLI 层将 config store typed errors 映射到 `registry.catalog-invalid` / `registry.catalog-busy`，将 selector errors 映射到 `registry.alias-not-found` / `registry.alias-conflict`；remote locator/descriptor、release、source、Pack 和 LocalStore 保持它们已有的稳定错误码。错误不包含 Git stderr、home/worktree path 或 credential。

Registry-backed success 保持 remote 的 `registry: { name, repository }` shape，并可增加 alias。Generic remote 的 repository identity 含 host，GitHub legacy 继续是 `owner/repository`。由于 local worktree 没有可公开 repository identity，local Registry 使用 schema 的另一个 result branch：`registry: { name, alias }`、`source: { type: "local-git", ref, commit }`，不伪造 remote URL 或 worktree path。这样旧 remote consumer 不因新 feature 改变字段含义，而新 local consumer 也不会收到私密 source。

## Risks / Trade-offs

- [catalog 被手工破坏会阻断 default install] → 严格校验、原子写入和稳定 `registry.catalog-invalid`；站点文档提供备份/恢复 catalog 的单一可执行步骤，不静默换到 official。
- [两个 CLI 同时 add/remove/default] → catalog store 对 read-modify-replace 使用 bounded cross-process lock，busy 时返回可重试错误，而非 last-writer-wins。
- [generic Git server 的 partial clone/OID fetch 支持不同] → descriptor output、time 和 Pack tree/blob budgets 始终受限；用支持/忽略 filter 与失败的 fixture 区分兼容性，不将 filter 写成绝对下载上限。
- [default source 让用户误以为会自动回退 official] → result、docs 和测试固定 selected alias 与 no-fallback；只有显式 `set-default official` 或 remove-default 会回到 built-in source。
- [local Git Registry 与本地 Pack directory 混淆] → command 形态和 source types 分离；Registry `--path` 必须是 Git worktree，Pack `--path` 不读取 Registry/Git，分别在两个 change 验收。
- [降级到不认识 catalog 的旧 CLI] → catalog 与 LocalStore 分离；旧版本不会删除它。发布说明写明旧 CLI 忽略 default，用户可用仍受支持的 explicit legacy GitHub locator 恢复确定来源。

## Migration Plan

1. 在实现 generic remote reader 前，rebase 到已合并的 #189，或以唯一审查分支吸收其 descriptor Git reader 与测试；不得让两套 loader 竞争同一入口。
2. 不迁移 LocalStore、已安装 Pack、shared `config.yaml` 或 project config。缺少 catalog 的用户继续使用 official，因此未配置用户的无 flag command 行为不变。
3. 首次成功 add 创建私有 catalog；验证 add/list/remove/default 的原子性、权限、并发、失败恢复与 local path redaction。
4. 将 install/update 改为 selector 驱动的 Registry route；同步 result schemas、describe、错误 allowlist、site 双语文档和 maintainer-facing ownership docs。
5. 回滚实现时保留 catalog 和已安装 Pack，不自动删除用户 state；旧 CLI 仍可用 explicit supported locator，但不承诺理解或应用 user default。
