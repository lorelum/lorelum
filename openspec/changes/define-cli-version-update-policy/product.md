# Lore CLI 版本检查与更新：产品方案（Proposed）

这份文档描述版本更新的用户路径。`lore update` 只检查；`lore update --apply` 则是用户明确要求更新。只有当前 CLI 能确认是**默认路径下由 Lorelum 官方 installer 管理**时，`--apply` 才会自动安装新版。其他来源仍能检查，但不能通过这个选项改动安装。`lore --version` 继续只报告本机版本，`lore pack update` 继续只更新 Pack。

## 用户要完成什么

用户已经装了 Lore，听说可能有新版。他希望先知道哪个版本适合自己；如果是用默认 installer 装的，决定更新后只需再运行一条 Lore 命令，不必复制远程安装脚本。仅检查时绝不能突然停止 Backend、下载软件或改动正在用的 CLI。

用户通常不会关心 GitHub API、SemVer 排序或 archive 的内部布局。他会看到三件事：**当前装的是哪版、有没有适合当前频道和平台的新版、下一步怎么做**。如果无法联网，产品只能说“本次没有查成”，不能说“你已经是最新版”。

## 正常路径：默认 installer 安装，检查后自动更新

以下用两个示例版本 `0.1.0-alpha.5` → `0.1.0-alpha.6` 演示输出。三个支持平台上的命令相同。`lore update` 默认沿用当前版本的频道：alpha 查包括预发布版在内的公开发行，稳定版只查稳定发行。

1. 用户在实际使用 Lore 的终端运行 `lore update`。命令联网检查发布信息，不修改本机安装。示例输出：

   ```text
   Lore CLI: 0.1.0-alpha.5
   Channel: prerelease
   Latest available: 0.1.0-alpha.6
   Installation: default Lorelum installer
   An update is available. Nothing was changed.

   Release notes: https://github.com/lorelum/lorelum/releases/tag/v0.1.0-alpha.6
   Review them, then run: lore update --apply
   ```

2. 用户阅读 release notes，决定更新，运行 `lore update --apply`。这个选项本身就是执行更新的明确同意，不再弹一次确认。CLI **先确认运行中的 binary 对应默认 installer 管理的入口**；符合条件才重新查询当前公开发行，选择精确版本，调用当前安装包中的同平台安装器。安装器下载 release archive 与 `SHA256SUMS` 并校验，必要时安全停止旧 Backend，随后切换入口。它不会使用上一次检查的缓存结果；两次运行之间如果有新发行，以这次实际检查到的版本为准。
3. 入口切换后，旧 CLI 进程会从默认入口启动一次新的 `lore --version` 核对目标版本。核对成功才显示更新完成，例如：

   ```text
   Updated Lore CLI: 0.1.0-alpha.5 → 0.1.0-alpha.6
   Verified default command: Lorelum 0.1.0-alpha.6
   Restart an already-open agent/editor if it still uses the old CLI.
   ```

4. 用户在自己的终端运行 `lore --version`，确认看到 `Lorelum 0.1.0-alpha.6 (protocol 2)`。如果 Agent/编辑器仍使用旧版，检查它的 `PATH`，必要时重启宿主。`--apply` 不会修改其他 shell、宿主或 Pack。

Windows PowerShell、macOS 和 Linux 都使用相同的 `lore update --apply`。CLI 内部只调用当前安装包内的该平台安装器；不会要求 Windows 用户运行 `install.sh`，也不会在安装失败时把脚本错误伪装成成功。Windows 的 `lore.cmd` 指向新版本后，仍要从该默认入口验证新 CLI。

## 没有需要安装的新版时

- **已经是最新**：显示本机版本、频道、检查到的相同版本和“当前频道已是最新版”；`--apply` 此时成功退出，但不下载、不停 Backend、不运行安装器。再次运行仍会重新联网检查。
- **本机版本比公开发行更高**：例如从源码运行尚未发布的版本，显示“本机版本高于当前频道的公开版本”；不建议降级。
- **频道里还没有可用发行版**：例如 alpha 用户显式运行 `lore update --channel stable`，而尚无稳定版，显示“stable 频道暂无适合本平台的公开版本”，不说“已是最新版”，也不回退到 alpha。`--channel prerelease` 可以主动查看包括预发布版在内的发行。
- **发行版未包含本平台的包**：不能给另一个平台的下载命令；明确说明本平台无受支持的发行包。如果运行平台本来不在支持范围，直接报告平台不受支持。

## 不是官方安装器管理的 CLI

如果 CLI 来自手工解压、其他管理方式或无法确认来源，`lore update` 仍可以报告可用版本，但下一步统一是“用原来的安装方式更新”。运行 `lore update --apply` 会**在联网、下载和停 Backend 之前拒绝**，说明无法确认这是默认 installer 安装；绝不改动可能属于另一个管理者的入口。源码用户按开发文档更新 checkout，不要求 CLI 猜测具体来源或包管理器，也不宣称 npm 安装可用。

如果用户当初给官方安装器设置过自定义安装根或 bin 目录，`--apply` **仍拒绝**：本阶段只自动更新默认位置，不能偷偷改另一个路径。只读检查显示精确版本，统一提醒按原安装方式更新；这类用户应沿用原来的 `LORELUM_INSTALL_ROOT`/`LORELUM_INSTALL_BIN_DIR` 手动运行安装器，不输出会更新错误位置的默认命令。Windows 同样遵守这个限制。

## 检查或安装失败，用户怎么继续

| 用户看到的情况 | 旧安装是否可用 | 下一步 |
| --- | --- | --- |
| `lore update` 联网失败、代理不可达或 GitHub 限流 | 是；检查没有改动安装 | 检查网络/代理，稍后重试；不能凭失败结果判断有无新版 |
| 发布信息损坏或列表不完整 | 是 | 稍后重试或查看官方 Releases；不根据部分结果安装 |
| `--apply` 发现不是默认 installer 入口 | 是；拒绝发生在网络和任何安装动作前 | 运行不带 `--apply` 的检查，再按原安装方式更新；自定义位置沿用原安装参数 |
| 安装器下载/校验失败，或无法安全停止旧 Backend | 旧命令入口保持不变；旧 Backend 可能已停止 | 按错误说明排查后重试 `lore update --apply`；需要 Backend 时按现有命令重新启动 |
| 安装器报告成功，但新入口的版本核对失败 | 不能断言旧入口仍激活；旧版本目录仍保留 | 错误必须说清当前状态未知/不一致，检查默认入口；必要时用官方安装器指定先前版本恢复，不能显示“已更新” |
| `--apply` 成功，但另一个宿主仍显示旧版 | 默认入口已核对；其他进程可能保留旧环境 | 检查该宿主的 `PATH`，新开终端或重启宿主后再运行 `lore --version` |
| 新版已启用但实际使用不合适 | 可用安装器显式安装先前版本；不承诺自动回滚 | 读取 release notes，用默认安装器指定先前版本，之后再次核对 `lore --version` |

`--apply` 调用的安装器来自**当前已安装的版本目录**，随已校验的发行包一起安装，不临时下载 `main` 分支脚本。安装器用现有 `SHA256SUMS` 核对 archive，但 archive 和摘要来自同一个发布渠道，不等于独立的发布者签名。只读检查不能被描述成“已验证并安装版本”；`--apply` 也只能在安装器完成且新入口版本核对通过后宣称成功。

## 命令和机器调用方

直接运行 macOS/Linux/Windows 安装器，或从默认安装入口运行 `lore update --apply` 下载发行包时，用户会约每秒看到一次下载进度。服务端提供文件大小时，例如 `lore install: downloading archive: 12.5 / 80.0 MiB (15%) at 3.2 MiB/s`；没提供时，例如 `lore install: downloading archive: 12.5 MiB at 3.2 MiB/s`，不编造百分比。下载结束会显示 `lore install: downloaded archive: 80.0 MiB`。这只代表文件已下载，仍需完成 checksum、切换和新入口核对；校验失败仍按失败处理。`--json` 的 stdout 仍只保留最终结果，进度走 stderr。Windows 不恢复会拖慢 PowerShell 5.1 下载的逐块进度 UI。

- `lore --version`：本机版本，不联网，也不提示更新。
- `lore update`：按当前版本默认频道做一次只读检查；没有自动后台检查、自动安装或持久缓存。
- `lore update --apply`：仅默认官方 installer 安装可用；重新联网查版本并使用当前安装包内的安装器自动更新。明确的 `--apply` 已表示同意，不另设确认提示。没有更新时不运行安装器；其他来源提前报错。
- `lore update --channel stable|prerelease`：显式指定本次看的频道，不改变后续默认值。
- `lore update --apply --channel stable|prerelease`：按指定频道检查并安装，但绝不降级。
- `lore update --json` / `lore update --apply --json`：每次只在 stdout 输出一条最终的普通 CLI JSON envelope；安装进度走 stderr。机器按 `status`、`canApply` 和 `error.code` 判断，不解析人类可读文字。只读检查的成功 `data` 示例：

  ```json
  {
    "currentVersion": "0.1.0-alpha.5",
    "channel": "prerelease",
    "latestVersion": "0.1.0-alpha.6",
    "status": "available",
    "canApply": true,
    "releaseNotesUrl": "https://github.com/lorelum/lorelum/releases/tag/v0.1.0-alpha.6"
  }
  ```

  自动更新成功时的 `data` 示例：

  ```json
  {
    "currentVersion": "0.1.0-alpha.5",
    "channel": "prerelease",
    "latestVersion": "0.1.0-alpha.6",
    "status": "updated",
    "installedVersion": "0.1.0-alpha.6",
    "canApply": true,
    "releaseNotesUrl": "https://github.com/lorelum/lorelum/releases/tag/v0.1.0-alpha.6"
  }
  ```

  `currentVersion` 是发起调用的旧 CLI，`installedVersion` 才是新入口核对的版本；`status: updated` 只在这次核对通过时出现。最终 envelope 的 `toolVersion` 仍来自旧进程，不能用它判断安装结果。实际响应还带现有 `protocolVersion`、`command`、`ok` 和 `diagnostics.traceId`。失败给出 `ok: false` 与可处理的 `error.code`；若默认安装位置不符合要求，错误为 `update.apply-unsupported`，同时说明用原安装方式更新。

## 本阶段不做什么

`--apply` 不处理自定义安装路径、包管理器或手工解压安装，不增加自动后台检查，不改 Pack，不承诺独立签名或成功后的自动回滚。它也不会每次都弹确认框：可修改安装的范围由“默认 installer 管理的入口”限定，是否执行由用户显式的 `--apply` 决定。此阶段不改变发布 workflow。

## 产品验收：让用户真的走完一次

在 macOS arm64、Linux x64、Windows x64 的默认安装路径上，从受管理的旧版本运行 `lore update`，看到新版和 `lore update --apply`；再运行 `--apply`，核对下载校验、Backend 停止/入口切换、新入口 `--version`，最后由用户再次运行 `lore --version`。分别试同版本、无 stable、离线、外部入口、自定义安装位置、校验失败与切换后验证失败：输出及入口状态必须与上面相符。候选构建和隔离 fixture 只能证明对应路径；两个公开发行版之间的安装 smoke 单独作为发布验证，不把它设为代码 PR 的前置条件。
