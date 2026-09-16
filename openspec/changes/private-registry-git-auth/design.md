# Design: private-registry-git-auth

## Context（观察证据，均已在源码核实）

- install 回路使用认证能力不一致的两种传输：descriptor 拉取为匿名 HTTPS fetch，硬编码 `raw.githubusercontent.com`（`packages/cli/src/install/load-registry.ts:54`），无认证通道；release 物化 spawn 系统 `git`（`packages/cli/src/install/materialize-source.ts:64`）。
- 物化层 git 运行在白名单环境沙箱中（`materialize-source.ts:13-25`）：`GIT_CONFIG_GLOBAL=""`、`GIT_CONFIG_NOSYSTEM="1"`、`GIT_ASKPASS=""`、`GIT_TERMINAL_PROMPT="0"`。因此 **credential helper 与 `insteadOf` 不生效**；真正可透传的用户认证是 SSH 默认密钥、`~/.ssh/config`、known_hosts（由 ssh 进程自行读取）与 ssh-agent——但 `SSH_AUTH_SOCK` 目前**不在白名单**，macOS/Linux 的 agent 密钥不可用。
- `resolveRegistryRepository` 返回结构已含 `gitUrl` 字段（`load-registry.ts:8-12,51-55`，当前固定 `https://github.com/<slug>.git`）；HTTPS URL locator 已被归一化为 slug；slug 正则校验在 `load-registry.ts:48`。
- 错误码清单与可见错误白名单：`packages/cli/src/runtime/errors.ts:1-21`、`packages/cli/src/install/install-command.ts:192-200`。`registry.unavailable` / `registry.invalid` 已存在；git 超时上限 `GIT_TIMEOUT_MS = 60_000`（`materialize-source.ts:10`），HTTP fetch 超时 15s（`load-registry.ts:67`）。
- 本变更为上游 openspec 体系 consolidates（#159）后首个走完整流的 feature 变更，无既有先例可循。

## Goals / Non-Goals

**Goals:**

- 用户 git 已能访问的前提下，`lore pack install/update` 对 github.com 私有仓库端到端可用，认证完全委托用户自己的 SSH 配置。
- legacy locator 输入（slug、HTTPS URL）行为逐字不变，公开仓库匿名 raw fast path 零回归。
- 全程非交互、错误可行动、无凭据泄露，且上述性质有测试锚定。

**Non-Goals:**

- 凭据的存储/管理/生成；读取 `gh auth token` 等外部凭据缓存。
- HTTPS 凭据（credential helper / PAT）复用；`insteadOf`、`core.sshCommand` 生效。
- descriptor 本地缓存与 TTL。
- GHES / 自建 git host 支持（显式 deferred，见文末）。

## Decisions

**D1 — v1 仅 SSH 传输，host 仅 github.com。**
leader 定向即"复用用户自己的 git**ssh** 信息"；沙箱事实（`GIT_CONFIG_GLOBAL=""`）决定 HTTPS 凭据复用不可行，除非放开沙箱——拒绝该替代方案，因为它破坏既有沙箱语义，且会使同一仓库因输入形态不同而行为不同。github.com-only 与现有 HTTPS URL 校验立场一致（`load-registry.ts:34`）；GHES 列入 deferred。

**D2 — 错误分类复用 `registry.unavailable`，消息按 locator 形态区分。**
替代方案"新增 `registry.unauthorized`"被拒：GitHub 对"仓库不存在"与"无权限"故意返回同一错误，SSH 侧需解析 stderr（现被 ignore）才能猜测分类，新码会产生不可靠分类并扩大公共错误契约（`install-command.ts:192-200` 白名单）。稳定码 + SSH 形态追加 `ssh -T git@github.com` 指引，可诚实兑现 spec 的"不区分不存在/无权限"要求。

**D3 — SSH 首连 fail-fast：注入 `GIT_SSH_COMMAND="ssh -oBatchMode=yes"`。**
替代方案 `StrictHostKeyChecking=accept-new` 被拒：永久 TOFU 弱化。feature 前提是用户 git 已能访问该仓库，此类用户 known_hosts 已含 github.com，fail-fast 对目标人群近乎零成本；同时让 host key / passphrase 一切交互提示确定性快速失败，CI 安全。

**D4 — descriptor 不缓存，每次 install/update 现拉。**
替代方案 TTL 缓存被拒：需新增缓存位置、失效策略与陈旧投诉面，收益配不上复杂度；raw 路径本无本地缓存（仅上游 CDN ~5min 窗口），git 路径无 CDN、严格更新鲜。两种传输的缓存语义差异在 `docs/cli/packs.md` 文档化。

**D5 — locator 形态分流，legacy 输入永不改传输。**
`owner/repo` 与 HTTPS URL 继续走现有匿名 raw 代码路径（不共享 git 路径代码，避免回归面）；仅 SSH URL 新语法走 git 传输。兼容承诺写入 spec（Legacy locator compatibility）。

**D6 — 沙箱白名单增补 `SSH_AUTH_SOCK`；`HOME`/`USERPROFILE` 以测试锚定。**
`SSH_AUTH_SOCK` 透传使 macOS/Linux agent 密钥可用（Windows OpenSSH 走命名管道不受影响），是 leader 定向的自然组成。**已实现（2026-09-16）**：`HOME`、`USERPROFILE`、`SSH_AUTH_SOCK` 与 `GIT_SSH_COMMAND="ssh -oBatchMode=yes"` 均已落入 `gitEnvironment()`（`materialize-source.ts`），环境管线以单测锚定（透传取值、无额外变量继承、BatchMode 注入）；真实 ssh 的跨平台 `~/.ssh` 定位由 8.2 手动强证据覆盖。

**需求与代码锚点映射**（迁移要求 → 现有来源）：

| Spec 要求 | 锚点 |
|---|---|
| Registry locator transport | `load-registry.ts:24-56`（现有 locator 解析与 `gitUrl` 字段） |
| Legacy locator compatibility | `load-registry.ts:26-50`（现有 slug/HTTPS 归一化与校验）+ `load-registry.test.ts`（既有行为回归） |
| Non-interactive SSH transport | `materialize-source.ts:13-25`（`GIT_TERMINAL_PROMPT="0"` 既有非交互立场） |
| Registry descriptor freshness | `load-registry.ts:59-87`（raw 路径本无本地缓存） |
| Credential hygiene | `materialize-source.ts:13-25`（沙箱白名单）+ install 输出测试（新增断言） |

## Risks / Trade-offs

- [平台差异：`HOME`/`USERPROFILE` 未透传可能使 ssh 定位不到 `~/.ssh`] → 白名单已增补三个 SSH 相关变量，管线以单测锚定；真实跨平台解析由 manual 验证（tasks 8.2）覆盖。
- [git 传输延迟高于 raw CDN] → descriptor ≤256KB、shallow fetch；沿用 `GIT_TIMEOUT_MS` 上限；文档说明两种传输的新鲜度差异（git 路径严格更新鲜）。
- [`BatchMode` 下无 agent 的 passphrase 密钥不可用] → 快速失败 + 指引；`SSH_AUTH_SOCK` 透传让 agent 密钥可用覆盖主流场景。
- [openspec 流首例，维护者可能调整 PR 形态] → 提案 commit 与实现 commit 分离，可按需拆分 PR（见 PLAN 异常路径）。
- [私有仓库 install 失败被误报为网络问题] → 形态感知消息 + 失败注入测试覆盖无凭据/host key 未信任/不可达三类。

## Migration Plan

无数据迁移、无持久化状态变更：回滚 = revert PR 即可。发布随 CLI 常规 release；legacy 行为零变化，用户无迁移动作。

## Open Questions

无未决问题——四项开放决策（错误分类、SSH 首连、缓存、兼容承诺）已于 2026-09-16 对齐定稿，结论已落入 Decisions D2-D5。

**Deferred work**（不属本变更）：GHES/自建 host 支持；HTTPS 凭据复用；沙箱 registry E2E 测试基建（AzMilabo/lorelum#19，作为测试前置另行推进）。
