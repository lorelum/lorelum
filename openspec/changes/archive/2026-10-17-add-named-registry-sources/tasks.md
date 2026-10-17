## 1. 基线与 platform-neutral Git source

- [x] 1.1 在改动 generic transport 前，将实现分支 rebase 到已合并的 #189，或在同一经审查实现中吸收其 partial-clone descriptor reader；验证 `load-registry` 只保留一套 Git reader 与既有资源回归。
- [x] 1.2 实现并测试 `RemoteGitLocator`：GitHub shorthand、任意 host HTTPS、`ssh://`（含 port/nested path）与 SCP-style SSH；验证 HTTPS userinfo/SSH password、`file:`、`http:`、`git:`/`git://`、helper、raw descriptor、control character 与 traversal 都在 spawn 前被拒绝。
- [x] 1.3 保留 official、GitHub shorthand 与严格 canonical GitHub HTTPS 的 raw descriptor compatibility；对 non-GitHub HTTPS、GitHub non-legacy HTTPS 与所有 SSH 使用 sandboxed partial-clone + `git show`，验证 host-inclusive identity、无 credential/error leakage、无 fallback，以及 filter 支持/忽略/失败时的真实边界。
- [x] 1.4 让 remote release materialization 使用 resolver 已验证的同一 remote，并以测试验证 GitLab nested path、custom port、single-segment SCP repository、non-`git` SSH user、GitHub non-legacy endpoint、server 拒绝按 OID fetch、generic failure message 与 GitHub legacy output 不互相污染。

## 2. 用户级 Registry catalog

- [x] 2.1 在 `@lorelum/config` 增加 `registries.yaml` path、严格 catalog schema、remote/local source model 和只读加载；用单元测试验证缺失等价 official、读取不创建文件、invalid/symlink/权限问题安全失败且 local path 不进入公开值。
- [x] 2.2 实现 catalog 专属 bounded lock 与 atomic read-modify-replace，覆盖 add/remove/set-default；用并发、写入失败、default 删除恢复、idempotent re-add、alias conflict 和无 partial state 的测试验证持久化语义。
- [x] 2.3 实现 `registry add <alias> --path <repository>` 的 local Git worktree resolver、canonical root persistence、HEAD descriptor 验证与同一 object database 的 no-lazy-fetch release materialization；用 local/promisor-missing-object fixture 验证没有 network/helper Git command、没有用户 worktree mutation、update、非法目录和 source-worktree path 脱敏。

## 3. Registry commands 与 Pack route 接入

- [x] 3.1 在 CLI command registry 增加 `registry add/list/remove/set-default` 的 JSON result schemas、visible error allowlists、describe metadata 和错误映射；用 protocol/command tests 验证 stdout 始终只有一个 JSON envelope。
- [x] 3.2 实现 add 先共享 source validation、后 catalog mutation 的流程，以及 list、remove、set-default、official protection、unknown alias、alias conflict、catalog invalid/busy 与 remove-default 恢复行为；验证失败后 catalog 保持不变。
- [x] 3.3 将 install/update 改为 selector 驱动，验证 `official`、saved alias 与 remote locator 的词法分流、saved alias 覆盖 default、无 flag 使用 default、直接 generic remote 保持 transient、保存的 local Git alias 使用仅本地 object database、`--store-root` 不携带 source state，且没有多 source fallback。
- [x] 3.4 扩展 remote/local Registry success schema branches：legacy remote `registry.repository` 保持兼容，generic remote 使用 host-inclusive identity，local Git Registry 报告 `{ name, alias }` 与 `{ type: "local-git", ref, commit }`；用 schema tests 验证不公开 source-worktree path、`file:`、temporary source 或 credentials，并保留既有 Store `packRoot` 含义。

## 4. 文档与验证

- [x] 4.1 在 `apps/site/content/docs/` 补充英文和中文 Pack/Registry 用户指南，验证 remote Git clone endpoint 与 raw/web URL 的区别、GitHub default/shorthand、SSH non-interactive access、default no-fallback、local Git Registry 与 local Pack directory 的区别、catalog recovery 和链接有效。
- [x] 4.2 更新受影响的 `docs/cli` 与 `docs/configuration` maintainer material，只说明 catalog ownership、transport/privacy、`--store-root` 隔离和站点入口；验证不重复用户操作流程也不把 proposal 写成当前合同。
- [x] 4.3 运行受影响的 `@lorelum/config` 与 `@lorelum/cli` 测试、`bun test`、`bun run lint`、`bun run typecheck`、相关文档/链接检查、`git diff --check` 与 `openspec validate add-named-registry-sources --strict`；记录任何与本 change 无关的既有失败。
