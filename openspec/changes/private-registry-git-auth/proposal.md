# Proposal: private-registry-git-auth

> 对应上游 issue: lorelum/lorelum#168（feat(cli): 支持私有 Pack 仓库——复用用户 git 认证完成 descriptor 拉取与安装）

## Why

Pack 仓库目前事实上只能是公开仓库：Registry descriptor 以匿名 HTTPS 从 `raw.githubusercontent.com` 拉取（`packages/cli/src/install/load-registry.ts:54`），私有仓库直接得到 `registry.unavailable`。而用户对自己的私有 pack 仓库有完整 push 权限（tag 是他们推上去的），release 物化层 spawn 的系统 `git` 也能走用户 SSH 认证——唯独 descriptor 一步认证被截断，形成"能发布、不能安装"的能力不对称。团队约定每个成员维护自己的 pack 仓库做实践积累，对这类仓库私有才是自然默认态。

## What Changes

- **行为类型声明**：本变更**引入新 product behavior**——`--registry` locator 新增 SSH URL 形态并新增 descriptor 的 git 传输读取路径；同时**不改变任何现有可观察行为**：`owner/repo` slug 与 `https://github.com/owner/repo(.git)` 输入的行为（含错误消息）逐字不变，继续走现有匿名 raw fast path。
- `--registry` locator 接受 github.com 的 SSH URL（`git@github.com:owner/repo.git` 与 `ssh://git@github.com/owner/repo.git` 两种写法）；slug 从 URL 提取用于校验与展示；`gitUrl` 从用户 URL 派生而不再固定重写为 HTTPS。
- 对 git 传输的 registry，descriptor 经同一 git 传输读取（shallow fetch 后 `git show <rev>:.lorelum/registry.yaml`），复用现有物化沙箱环境；256KB 上限、schema 校验、错误分类与 HTTPS 路径一致。
- 物化 git 环境白名单增补 `SSH_AUTH_SOCK` 透传，并统一注入 `GIT_SSH_COMMAND="ssh -oBatchMode=yes"`：SSH 全程非交互，host key 确认、passphrase 等提示确定性快速失败。
- 访问失败维持错误码 `registry.unavailable`，消息按 locator 形态区分（SSH 输入追加 `ssh -T git@github.com` 验证指引）；不区分"仓库不存在"与"无权限"（避免探测泄露）。
- descriptor **不引入本地缓存**：每次 install/update 现拉（git 路径无 CDN，严格更新鲜）。
- **非目标（硬边界）**：lore 不存储/管理/生成任何凭据，不读取 `gh auth token` 等工具凭据缓存；credential helper、`insteadOf`、`core.sshCommand` 等依赖 git 配置的机制在现有沙箱下不生效、不承诺；HTTPS 凭据（PAT/credential manager）复用不在范围；SSH locator host v1 仅限 github.com（GHES/自建留作显式后续）；任何日志、错误输出、store 记录不得出现携带凭据的 URL。

## Capabilities

### New Capabilities

（无——本变更不引入新能力，仅扩展既有能力的要求。）

### Modified Capabilities

- `pack-management`: Registry locator 解析与传输语义变化——新增"Registry locator transport"要求（SSH URL 形态、github.com-only、git 传输 descriptor 读取、非交互 fail-fast、不缓存现拉、无凭据泄露），并补充现有错误分类（`registry.unavailable` 的形态感知消息边界）与传输新鲜度语义；现有 release 选择、update-required 边界要求不变。

## Impact

- `packages/cli/src/install/load-registry.ts`：locator 解析扩展、descriptor 读取路径分流。
- `packages/cli/src/install/materialize-source.ts`：`GIT_ENVIRONMENT` 白名单增补与 `GIT_SSH_COMMAND` 注入。
- `packages/cli/src/install/install-command.ts`：可见错误码白名单不变（不新增错误码）。
- `docs/cli/packs.md`：SSH URL 用法与缓存语义说明。
- 无 Practice/Pack schema、retrieval、backend 变更；无新依赖（复用系统 `git`，`fetch` 既有）。
