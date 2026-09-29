## Purpose

定义 Lore CLI 自身可预测的版本检查与受限更新合同：不带 `--apply` 时只读；明确带 `--apply` 时，仅默认官方 installer 管理的安装可以自动更新并核对新入口。其他来源不会被覆盖，也不会与 Pack 更新混淆。

## ADDED Requirements

### Requirement: Explicit read-only version check
不带 `--apply` 的 `lore update` SHALL 仅在显式调用时查询 Lore 的公开已发布发行版，报告当前版本、所选频道、候选最新版、是否有更新、release notes 和更新指引。它 MUST 明确告诉用户“本次检查没有修改安装”，MUST NOT 下载 archive、执行安装器、改动可执行文件、Backend 或 Store。`lore --version` MUST 保持纯本地、无网络；普通命令和 Hook MUST NOT 自动检查或应用更新。

#### Scenario: Explicit check finds a newer version
- **WHEN** 用户运行 `lore update` 且所选频道存在比当前版本更新的已发布版本
- **THEN** CLI MUST 报告更新可用、两个版本、release notes 以及该安装来源的操作指引，且本地安装保持不变

#### Scenario: Other commands remain offline for version discovery
- **WHEN** 用户运行 `lore --version` 或普通 Hook
- **THEN** CLI MUST 不为检查发行版发起网络请求，也不得提示或应用自更新

### Requirement: Channel selection and version ordering
CLI SHALL 从当前 CLI 的 SemVer 选择默认频道：稳定版本使用 `stable`，预发布版本使用 `prerelease`；用户可用 `--channel stable|prerelease` 显式覆盖。`stable` MUST 只考虑公开已发布且非预发布的 SemVer release；`prerelease` MUST 考虑公开已发布的稳定和预发布 SemVer release。候选版本 MUST 按 SemVer precedence 选择，而非 GitHub 页面/API 顺序、发布时间或字符串序；build metadata 不得改变 precedence。草稿、非 SemVer tag 和缺少预期平台 archive 或 `SHA256SUMS` 的发行版 MUST NOT 作为可安装候选；不得推荐降级或将同 precedence 的 build metadata 视为更新。

#### Scenario: Current alpha discovers a later alpha
- **WHEN** 当前版本为 `0.1.0-alpha.3`，公开发行同时有 `0.1.0-alpha.4` 且没有 stable
- **THEN** 默认频道 MUST 为 `prerelease`，并报告 `0.1.0-alpha.4` 可用

#### Scenario: Stable user does not opt into prerelease
- **WHEN** 当前版本稳定，公开发行只有更高版本的预发布版
- **THEN** 默认频道 MUST 为 `stable`，且 MUST 不推荐该预发布版

#### Scenario: No matching release
- **WHEN** 所选频道尚无符合平台条件的已发布版本
- **THEN** CLI MUST 返回成功的“无候选”结果，区分于已经是最新版，不得把未知状态说成已是最新版

### Requirement: Machine-readable result and failure
`lore update [--apply] --json` SHALL 复用普通 CLI protocol envelope；成功 `data` MUST 包含 `currentVersion`（发起命令的 CLI 版本）、`channel`、`latestVersion`（没有候选为 `null`）、`status`（`available`、`current`、`ahead`、`no-release` 或 `updated`）、`canApply` 和 `releaseNotesUrl`（没有候选为 `null`）。只有 `--apply` 完成安装且新入口版本核对通过时，`status` SHALL 为 `updated`，并有 `installedVersion`；其他成功结果 MUST 不包含 `installedVersion`，不能暗示已安装。默认官方 installer 入口的 `canApply` SHALL 为 `true`，其他入口为 `false`；text MUST 根据这些字段给出可操作的下一步并完整表达同一数据。无法可信完成检查时 MUST 返回非零错误 envelope，不得用“无更新”、过期结果或其他频道冒充成功。

#### Scenario: Default installation offers one-command apply
- **WHEN** 默认官方 installer 入口的只读检查发现新版
- **THEN** `canApply` MUST 为 `true`，text MUST 提示 `lore update --apply`（显式选了频道则保留该频道），而不要求用户复制远程安装脚本

#### Scenario: Source checkout is ahead of published releases
- **WHEN** 当前版本的 SemVer precedence 高于频道内最高可安装发行版
- **THEN** 状态 MUST 为 `ahead` 且 `latestVersion` MUST 为该频道最高可安装发行版，不得建议降级

#### Scenario: Check cannot reach release service
- **WHEN** 发行版查询超时、离线、代理连接失败或被限流
- **THEN** CLI MUST 返回明确的 `update.unavailable` 错误与稍后重试/检查网络的指引，不得声称已是最新版；错误不得泄露代理凭据

#### Scenario: Release metadata is not usable
- **WHEN** 服务响应成功但必要字段损坏或检查无法确认候选列表已完整读取
- **THEN** CLI MUST 返回 `update.unavailable` 错误，不得根据部分列表推荐更新；诊断可区分服务数据异常与网络失败

#### Scenario: Unsupported release target
- **WHEN** 当前运行平台没有 Lore 官方发布 archive
- **THEN** CLI MUST 返回 `update.unsupported-platform`，不得将该平台的候选缺失误报为频道暂无发行版

### Requirement: Default-installer-only apply
`lore update --apply` SHALL 是执行更新的显式同意，无需再次交互确认；它 MUST 在联网、下载、停 Backend 或修改文件之前验证：当前默认命令入口位于该平台**默认安装根与 bin 目录**、符合官方 installer 的受管理入口格式，并且确实指向此运行中的 CLI。无法证明上述条件时 MUST 返回 `update.apply-unsupported`，给原安装方式的下一步，且没有安装副作用。源码、自定义 installer 路径、手动解压、包管理器和来源不明的入口 MUST NOT 自动更新；只读检查仍可用。

#### Scenario: Default installer-managed CLI applies a newer release
- **WHEN** 用户在默认官方 installer 入口运行 `lore update --apply`，本次检查发现更高的匹配版本
- **THEN** CLI MUST 将该精确版本交给随当前 CLI 提供的同平台安装器，沿用其 archive/`SHA256SUMS` 校验、Backend 停止、版本目录与入口切换行为，并 MUST 从切换后的默认入口运行 `lore --version` 核对目标版本后才报告 `updated`

#### Scenario: No newer release to apply
- **WHEN** 默认 installer 用户运行 `--apply`，本次查询没有比当前版本更新的候选
- **THEN** CLI MUST 返回相应的 `current`、`ahead` 或 `no-release` 成功结果，MUST NOT 下载 archive、停止 Backend 或启动安装器，不得降级

#### Scenario: Custom or external installation requests apply
- **WHEN** 当前入口在自定义 installer 目录，或来自源码、手动解压、包管理器或无法确认来源，而用户传入 `--apply`
- **THEN** CLI MUST 在联网或启动安装器前返回 `update.apply-unsupported`，MUST NOT 触碰现有入口，并 MUST 提示用户用原安装设置或管理方式更新；只读检查不得输出会更新错误位置的命令

#### Scenario: Apply cannot safely start an installer
- **WHEN** 默认安装满足入口检查，但当前安装包中的同平台安装器不可用，或即将调用前默认入口已变更
- **THEN** CLI MUST 在任何安装动作前失败并说明旧入口未被本次操作替换，不得下载并执行另一份脚本

### Requirement: Apply outcome and recovery
`--apply` SHALL 每次重新查询发行版，不依赖先前的只读检查结果。它 MUST 把精确目标版本交给当前安装包中的安装器；安装器在切换前失败时 MUST 保持旧命令入口，CLI MUST 返回非零错误和一个重试/排障动作。安装器已报告成功但新入口核对失败时 CLI MUST 返回 `update.verification-failed`，明确入口状态可能已变化，MUST NOT 虚报更新完成或声称旧入口仍激活。成功的 `--apply --json` MUST 保持 stdout 单条最终 envelope；安装进度只可写 stderr，且错误/日志不得泄漏代理凭据。

`--apply` 下载发行包期间 SHALL 将安装器的已下载量、速度、可用时的总量/百分比以及下载完成提示显示在 stderr，不得把子进程任意错误输出当进度原样转发；下载完成不能作为安装成功的信号。

#### Scenario: Archive verification or backend stop fails
- **WHEN** 安装器在下载、checksum、布局校验或停止旧 Backend 时失败
- **THEN** 默认命令入口 MUST 保持旧版本，`--apply` MUST 返回失败而不是 `updated`；若 Backend 曾被停止，恢复指引 MUST 如实说明并给下一步

#### Scenario: New entry reports the expected version
- **WHEN** 安装器成功切换入口且从该默认入口启动的新进程报告目标版本
- **THEN** CLI MUST 返回 `status: updated`、旧的 `currentVersion` 和新的 `installedVersion`；调用进程的 envelope `toolVersion` 仍是旧版本

#### Scenario: Post-switch verification fails
- **WHEN** 安装器成功退出，但新默认入口未能启动或报告的版本与目标不符
- **THEN** CLI MUST 返回 `update.verification-failed`，说明不能确认当前入口的版本，并指引检查默认入口、必要时用原 installer 指定先前版本恢复；不得自动宣称回滚成功

### Requirement: No cached or implicit update state
每次显式检查（包括 `--apply`）SHALL 使用当次可获得的发行版数据；本阶段 MUST NOT 写入持久更新检查缓存或以离线缓存回答。用户的代理设置可影响网络连接，但不得被写入结果、日志或错误。自动安装 MUST 使用当前安装包中的安装器和官方发行来源，不得静默采用安装器环境变量改写根目录、bin 目录或 release 来源；本变更不得更改 release 发布、签名或验证资产的现行流程。

#### Scenario: Offline after prior success
- **WHEN** 一次检查成功后用户离线再次运行 `lore update`
- **THEN** 第二次 MUST 报告检查失败，而非返回此前的成功结果
