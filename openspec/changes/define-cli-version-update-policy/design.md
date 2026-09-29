## Context

先看 [产品方案](./product.md) 中“检查 → 阅读 release notes → 显式 `--apply` → 从新入口核对版本”的用户路径。本文件只解释为了交付这条路径，需要哪些代码边界和取舍；它不代替产品文档。设计依据是现有 CLI 和安装器的以下边界：

- `packages/cli/src/registry.ts` 将 `--version` 定义为静态 `protocolVersion/toolVersion` 响应；`packages/cli/src/main.test.ts` 覆盖 text 和 JSON。命令注册和结果 schema 属 CLI，不需 Backend/Engine。`docs/cli/README.md` 约定普通 CLI 的完整 text 与单行 JSON envelope、成功 0/可见错误 2。
- `install.sh` 和 `install.ps1` 从 GitHub Releases 下载平台 archive 与 `SHA256SUMS`，验证摘要、包布局与目标平台，然后切换受管理入口；切换前尝试停止旧 Backend。Unix 入口是指向 `versions/<version>/lore` 的 symlink；Windows 是受管理的 `lore.cmd` shim。自定义安装根和 bin 目录由环境变量配置。`openspec/specs/cli-distribution/spec.md` 已要求原子且不覆盖外部入口。
- `.github/workflows/release.yml` 从带版本号的 annotated tag 构建三个目标，检查 archive，创建人工审批的 prerelease draft；`docs/development/release.md` 把发布 draft 和公开可安装状态分开。archive metadata 和 `SHA256SUMS` 生成于 `scripts/release/package.ts`，没有签名资产。
- `scripts/release/package.ts` 将 CLI、native、license/notices 放进同一个发行包；现有两个安装器接受同一包内的额外普通文件，安装后保留完整版本目录，并支持精确版本选项。把当前平台的安装器脚本作为发行包普通文件即可复用其校验、停旧 Backend 和入口切换，无需改两条 binary 编译路径或 release workflow。
- GitHub Releases `/latest` 排除 prerelease；用它检查 prerelease 频道会漏掉预发布版本。版本选择需要读取 release 列表，并用 API fixture 与公开发行 smoke 验证，不将固定版本写进代码。

本设计新增 `cli-version-management`，并为 `cli-distribution` 补充下载反馈要求；原子安装与 `pack-management` 的现行合同保持不变。用户已经明确选择增加 `--apply`，但只授权默认 installer 管理的安装自动更新：它复用当前 binary 随附的安装器，而非另造一套 archive 校验与替换实现。

下载体验的补充要求同时覆盖直接运行安装器和 `--apply`。Unix 安装器从同一次 GET 的响应头读取最终 `Content-Length` 并观察下载文件大小；Windows 从响应对象读取长度、分块写入并按时间节流输出。两端用相邻采样计算速度，不额外请求 HEAD；总大小不可用时不显示百分比。下载完成提示与安装成功分开，Windows 不恢复 PowerShell 5.1 曾拖慢下载的内建逐块进度 UI。CLI 子进程只把符合固定格式的进度行转到 stderr，其他安装器诊断仅用于失败分类，不原样转发，以免输出代理凭据。原有 checksum 和入口切换不变。

## Goals / Non-Goals

**Goals:** 用户能只读检查版本，也能明确传 `--apply` 在默认 installer 安装上完成真实更新；成功前从新默认入口验证版本。alpha/stable 默认频道清晰，非默认入口在任何下载或停 Backend 前拒绝，失败不虚报成功。

**Non-Goals:** 自动后台检查或提示、持久缓存、自定义目录自动更新、包管理器/源码/手工安装更新、CLI 自写第三套解包/切换逻辑、独立签名链、自动回滚、改变发布 workflow、Pack 更新或新增 Backend 服务。

## Decisions

### 1. 一个命令，两种明确模式

不带 `--apply` 时只查询，不读 Store，不启动 Backend，也不改安装。带 `--apply` 时先确认**默认 installer 入口指向当前进程**；不满足立即返回错误，不先联网。满足才重新查询公开发行：有更高版本时安装精确版本，没有时原样成功退出。`--apply` 本身是用户同意，不加第二道提示。`--version`、Hook 和 Pack 命令不变。

公开结果只需 `currentVersion`、`channel`、`latestVersion`、`status`、`canApply`、`releaseNotesUrl`；成功更新额外给从新入口核对的 `installedVersion`。`status: updated` 已表达本次应用成功，不再增加 `mode` 和 `applied`；每次都现查，不需要 `checkedAt`；`--apply` 只识别默认入口，不需要四类安装来源枚举。text 根据 `status` 和 `canApply` 显示 `lore update --apply` 或原安装方式的指引，不把一段命令文字再做成公开 JSON 字段。旧进程 envelope 的 `toolVersion` 仍是旧版，不能当安装结果。

实现只需 CLI 内一条检查/更新流程，发布查询与安装器调用分别是可替换的测试输入；不预建通用 release-source、installer 类层级或持久状态。版本比较复用现有 CLI 已用的 `Bun.semver.order`，不引入第二个 SemVer 实现或依赖。输入输出和错误以 [delta spec](./specs/cli-version-management/spec.md) 为准。

### 2. 从公开 release 列表选版本，检查必须完整

使用 GitHub Releases list API，逐页读取直到没有下一页；只接受 `draft=false`、有效 SemVer tag、所选 target 的 archive 和同一 release 的 `SHA256SUMS`。stable 过滤 `prerelease=false` 且版本无 prerelease 段；prerelease 允许稳定和预发布；元数据标志与版本段冲突时排除该 release。按 SemVer precedence 排序，不用发布时间、API 顺序或字符串序；build metadata 不构成更新。从同一合格 release 取得 release notes URL，并约束为官方 GitHub Releases 页面。`current`、`ahead`、`no-release` 与 `available` 各有明确含义，不能从 HTTP 失败推断。

按需请求 GitHub 官方 release 列表并跟随其分页；任何页失败或数据不能可靠读取时返回 `update.unavailable`，不拿部分列表宣布“最新版”。请求设置超时，不要求用户配置 GitHub token。本阶段每次显式调用现查，不建立 TTL、ETag 持久状态；若真实限流频繁，再量化查询频率并讨论缓存与 stale 语义。

网络不可达、代理失败、HTTP 限流或发行数据不可用统一为 `update.unavailable`，text/JSON 给重试及检查网络的下一步；本机日志可区分原因。异常不得包含带凭据的代理 URL、响应 body 或请求 header。验证当前 Bun 网络调用在常见代理环境下的行为；若不支持，则清楚报告连接失败，不为本功能新增代理框架。

### 3. 默认入口是 `--apply` 的唯一门槛

以运行时平台的**默认**路径定位入口：Unix 为 `$HOME/.local/bin/lore` → `$HOME/.local/share/lorelum/versions/<version>/lore`；Windows 为 `$env:LOCALAPPDATA\Lorelum\bin\lore.cmd` → `$env:LOCALAPPDATA\Lorelum\versions\<version>\lore.exe`。沿用现有安装器的 symlink/shim 格式与路径规则，并核对目标确实是当前运行的 CLI。这个判断保护默认入口不被错误覆盖；无需再加独立的 PATH 扫描、额外的源码/编译态判断或从目录名推断一个新的安装身份。

只读检查可向所有非默认来源统一提示“按原安装方式更新”；`--apply` 对它们一律在联网前返回 `update.apply-unsupported`。这条门槛只允许 default。安装器调用前廉价地再读一次入口，确认它仍指向当前进程；安装器自己也会检查其受管理入口。成功之后通过**默认入口**启动全新进程查询版本，不读当前进程的常量。

默认入口发现新版时，text 提示 `lore update --apply`；其他来源不猜具体包管理器或提供可能更新错位置的命令。`--apply` child process 不继承会改写安装根、bin、发行 API/下载来源的 `LORELUM_INSTALL_*` 覆盖值（保留正常网络代理配置），始终作用于当前核对过的默认入口。即便本机版本较高或无候选，也不建议降级。保留 `lore pack update`，根命令不转发给它。

### 4. 发行包带一个对应平台的现有安装器

`scripts/release/package.ts` 给 macOS/Linux archive 加入 `install.sh`，给 Windows archive 加入 `install.ps1`，与 CLI、native、notices 一起进入现有 archive checksum。官方安装器已经安装整个版本目录且允许额外普通文件，因此旧的手动安装路径不用改变；只有带新命令的发行版需要这个同版本脚本。`--apply` 从当前运行的版本目录读取那个固定文件，以参数数组调用 `/bin/sh` 或 Windows PowerShell，传入经过 SemVer 解析的精确 `--version` / `-Version`。文件缺失则在下载前失败。不能从 `main` 动态抓脚本，也不能从工作目录找同名文件；不需要修改编译器、嵌入资产或临时提取脚本。

安装器仍从官方 release 下载 archive 与 `SHA256SUMS`，校验后才停旧 Backend、安装版本目录、切换 symlink/shim。运行中的旧 CLI 不需要覆盖自身 executable：版本目录独立，默认入口指向新目录。安装器在切换前失败时入口保持旧版，虽然若 Backend 已停止则可能需要按原方式重启；CLI 把错误归类为 `update.apply-failed` 并给一个恢复动作。安装器退出 0 后，CLI 从新入口运行 `--version`，确认目标；失败返回 `update.verification-failed`，承认默认入口可能已经变化，不虚报旧版仍激活，也不承诺自动回滚。旧版本目录仍保留，可用官方安装器显式指定旧版恢复。

当前 SHA-256 只能检测 archive 与同源发布摘要是否一致，不能独立证明发布者身份。本变更沿用已支持安装器的信任边界，不把它误称为签名认证。独立签名或 attestation 若成为新要求，必须另行设计信任根、构建与发布验证；本方案不修改 release workflow 或静默扩大安装来源。相比新增第三套 TypeScript 解包/切换实现，随发行包附带现有安装器保持验证与恢复规则唯一；代价是发行包多一个平台脚本，并需要验证三个平台都能从安装目录调用它。

## Risks / Trade-offs

- [每次检查访问 GitHub 可能触发限流/企业网络失败] → 仅显式调用，明确错误而非假“最新版”；以后有频率证据再讨论缓存。
- [默认入口判断漏判] → 拒绝 `--apply` 而不改安装；只读检查继续给精确版本和原安装方式的指引。不能为了让 apply 成功而猜管理者。
- [安装器执行成功但新入口异常] → 从新入口二次验证，失败明确是切换后状态不确定；旧版本目录仍可用于手动恢复，不谎称自动回滚。
- [旧进程的 JSON envelope 仍显示旧 `toolVersion`] → `data.currentVersion` 指发起版本，成功时额外给 `installedVersion`；文本也明确说明从新进程核对的版本。
- [发行包漏带脚本或脚本无法在目标系统执行] → 打包测试断言对应平台文件存在；三个目标的候选 archive 在隔离路径验证读取与启动，不能只跑源级测试。
- [Windows 策略阻止本地 `.ps1` 执行] → 在目标 runner 先验证现有安装器的本地调用方式；确实被策略阻止时报告 `update.apply-failed` 和手动安装路径，不预建通用执行策略绕过机制。
- [release metadata 完整不等于 artifact 可信签名] → `--apply` 仍走现有下载与 checksum 校验；公开 smoke 验证实际发行 asset，不宣称独立签名保证。

## Migration Plan

1. 先完成只读检查和默认入口识别，再给发行包加入当前平台的安装器脚本并接上 `--apply`；用可控 release/安装器 fixture 验证 no-op、拒绝、错误和 JSON，旧命令保持纯本地。
2. 沿 [产品方案](./product.md) 更新站点中英安装页面；内部 schema 留在 `docs/cli`。PR 验收在三个目标的候选 archive 上验证脚本存在、可执行、默认入口判断和 CLI 编排；现有安装器的 archive 校验/Backend 停止/切换继续跑隔离 fixture 测试。公开发行间的真实 `--apply` smoke 单列为发布验证，不作为代码 PR 的前置条件。需要动 `.github/workflows/release.yml` 时单独取得维护者批准。
3. 没有持久迁移或自动后台任务；禁用/回退新命令不会改现有安装器。`--apply` 单次失败在切换前由现有安装器保留旧入口；切换后异常需向用户报告当前入口并提供用旧版本安装器恢复的操作，而不是说整个功能可一键回滚。

建议将 #130 的后续工作拆为三个可评审范围（此处只是 Issue 草案划分，不在本轮公开创建）：

1. **CLI 检查与协议**：SemVer/频道、GitHub 分页、release notes、完整 text/JSON 和错误；真实结果能给默认安装用户一个准确的 `--apply` 下一步。
2. **默认入口判断与应用**：发行包带同平台安装器、拒绝非默认来源、精确版本调用、no-op、安装失败分类与新入口核对；用现有安装器测试及三平台候选 archive 验证。
3. **用户文档与发行验收**：站点中英正常/失败路径、跨平台候选验收；公开发布后的真实 smoke 属发布验证，不自动修改 workflow 或发布。
