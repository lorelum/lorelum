# 版本更新实现验证记录

日期：2026-09-29。以下是本工作树的验证结果，不是公开发行状态或用户指南。

## 已验证

- 在包含 `origin/main` 的工作树上运行 `bun test --parallel=4 --max-concurrency=3`：1157 pass、17 skip、0 fail。跳过项包括本机不能运行的 Windows 平台测试。`bun run typecheck`、`bun run --filter @lorelum/site build` 通过；`bun run lint` 通过，有版本分页和进度流顺序读取的 `no-await-in-loop` 提示。
- `bun run build:release` 在 macOS arm64 构建候选 archive；打包测试验证同平台 `install.sh` 在 archive 中且被 `SHA256SUMS` 覆盖。现有 Unix installer fixture 集成测试覆盖校验、Backend 停止、切换及失败保留旧入口。
- 在独立临时 HOME 中用公开 `v0.1.0-alpha.4` 和原安装器安装，`lore --version` 返回 `0.1.0-alpha.4`。这只证明旧版可作为安装起点；公开 alpha.4 没有 `lore update`，不证明它能直接自更新。
- 用本工作树候选 archive 在另一个临时 HOME 中安装，确认版本目录有随包的 `install.sh`、默认命令入口通过 `--apply` 的来源检查。实际 GitHub 匿名 API 返回 HTTP 403（额度为 0），CLI 返回 `update.unavailable`，没有执行安装器或宣称“已是最新版”。
- 在完全隔离的临时源码副本和 HOME 中，将同一实现分别构建为测试版 `0.1.0-alpha.4` 与 `0.1.0-alpha.5` 的 release-staging binary，生成两个带原安装器逻辑的候选 archive。测试副本仅把 release API 与旧包内 installer 的下载地址指向本地 fixture，并换用独立 Backend 端口，避免接触真实服务；产品源码、公开 tag、正式安装均未修改。真实默认入口运行 `update --json` 报 `available/canApply: true`，`update --apply --json` 报 `updated/installedVersion: 0.1.0-alpha.5`，从新入口运行 `--version` 返回 alpha.5，新版本再检查为 `current`。通过故意传入无效 `LORELUM_INSTALL_RELEASE_BASE_URL` 验证 `--apply` 不继承来源覆盖。第一次普通 `build:cli` 测试 binary 因不能通过 Backend 停止检查而失败；改用 release-staging binary 并隔离端口后通过，原检查未被放宽。
- 英文/中文安装页与协议文档已对照 CLI text/JSON 字段；`bun run --filter @lorelum/site build` 通过。
- 在 Docker Desktop 的 `linux/amd64` 容器内（`uname -m` 为 `x86_64`，Bun 1.4.2、Debian 13，宿主 macOS arm64 提供 x64 仿真）完成 Linux x64 验证：容器中安装项目依赖、实际编译 Linux native runtime 并运行 `bun run build:release`，生成 `lore-0.1.0-alpha.4-linux-x64.tar.gz`。增加进度测试后，Linux 安装器测试以 `bun test --timeout 15000 scripts/release/install.integration.test.ts` 运行，为 14 pass、1 skip、0 fail；跳过项仅针对 macOS 宿主。标准 5 秒超时下曾有流式 fixture 和另一项测试在 x64 仿真环境超时；把 fixture 改为定时主动发送后，完整测试以 15 秒上限通过，不能据此声称独立原生 Linux 的性能。
- 同一 Linux x64 容器使用已验证的 native manifest 编译两个带更新命令的测试版，发行查询和旧版本内 installer 的下载地址仅在临时测试副本中指向容器内 fixture。默认安装入口检查返回 `available/canApply: true`；外部 binary 的 `--apply` 在查询前被拒绝；发行服务返回 503 时获得未泄漏测试代理凭据的单行 `update.unavailable` JSON；目标包 checksum 不符时返回 `update.apply-failed` 且 symlink 保持旧版；正常 `--apply` 返回旧 `currentVersion` 与 `installedVersion: 0.1.0-alpha.5`，新入口 `--version` 报 alpha.5，再运行 `--apply` 返回 `current`，不重复安装。测试时传入无效的 installer 来源覆盖，仍由随包 installer 从隔离 fixture 安装。该环境是 x64 容器仿真，不等同于独立原生 Linux runner；也没有验证真实代理连接故障或公开 Release 下载。
- 下载进度的 macOS/Linux 隔离 HTTP fixture 分别覆盖有 `Content-Length` 时的已下载量/总量/百分比/速度、未知总量时只有已下载量/速度、下载完成与 checksum 失败后的旧入口状态；CLI 测试确认只将固定格式进度转发到 stderr，不原样转发含测试密码的诊断。
- 在 macOS arm64 用本工作树 `install.sh`、隔离的安装根/bin 目录真实下载公开 `v0.1.0-alpha.4`：终端显示 `1.1 / 30.9 MiB (3%) at 1.1 MiB/s` 直至 100%，再显示 `downloaded archive: 30.9 MiB`；安装后默认入口的 `lore --version` 返回 `Lorelum 0.1.0-alpha.4 (protocol 2)`。隔离目录已移入废纸篓。这个测试证明安装器的公开下载路径和进度，不证明旧 alpha.4 自带新 `lore update`。

## 尚待验证

- Windows x64 的候选 archive、PowerShell/shim 路径及其新进度输出仍需在 Windows 目标环境运行；本机加密 Windows VM 需用户密码才可启动，macOS 和 Linux 的 Unix installer 验证都不能代替 Windows 实测。Linux 的独立原生 x64 runner 与真实代理连接故障也未覆盖。
- 两个**公开**且都包含此能力的发行版之间的 self-update，需要在发布验证时单独 smoke。候选版之间的本地 fixture 演练不能证明公开 Release 的下载与传播路径。
