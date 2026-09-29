## 1. 用户能只读查到正确的版本

- [x] 1.1 复用 `Bun.semver.order` 实现 alpha/stable 默认频道、release/平台 asset 过滤和 `available/current/ahead/no-release` 判定；用 colocated `bun:test` 覆盖 [产品方案](./product.md) 的正常与无候选路径、乱序、build metadata、草稿和缺包后勾选。
- [x] 1.2 增加显式调用时才联网的 GitHub Releases 查询、分页与 release notes URL；用 mock HTTP 验证离线、限流、损坏信息和分页中断均不会误报最新版、不会泄漏代理凭据，返回同一个可恢复的 `update.unavailable` 错误后勾选。

## 2. 只有默认 installer 安装能自动更新

- [x] 2.1 注册 `lore update [--channel stable|prerelease] [--apply]` 的 text/JSON/错误合同；只读结果明确未改动，默认入口显示 `--apply` 下一步，应用成功包含旧 `currentVersion` 与核对后的 `installedVersion`。在 `main.test.ts` 验证单行 JSON stdout、进度 stderr、退出码、`--version` 无网络和 Pack 命令独立，`bun test packages/cli` 通过后勾选。
- [x] 2.2 沿用现有 installer 格式验证默认 symlink/shim 指向当前 CLI；自定义安装、源码、手工解压、外部入口在联网/停 Backend 前拒绝 `--apply`。用隔离默认和非默认路径验证所有权判断及零安装副作用后勾选，不加 PATH 探测或新 provenance 状态。
- [x] 2.3 让 `scripts/release/package.ts` 只把对应平台的现有安装器脚本加入发行包；测试 archive 布局、checksum 与安装后版本目录中的脚本，确认不修改两条 binary 编译路径、不运行时下载脚本后勾选。
- [x] 2.4 默认入口有更高版本才将精确版本交给同目录 installer，屏蔽改写默认位置/发行来源的环境覆盖，再从新默认入口查版本。用可控 release/installer fixture 覆盖 no-op、入口变化、安装失败、切换后版本不符和成功；核对错误、旧入口状态与 JSON `status` 后勾选。

## 3. 让真实用户走完更新路径

- [x] 3.1 将已实现的 `lore update` 只读检查、默认入口 `--apply`、不受支持来源、无新版和失败恢复写入站点英文/中文安装页；`docs/cli/README.md` 只记 protocol，不复制用户指南。逐项比对 [产品方案](./product.md) 的 text/JSON 与真实 CLI 输出后勾选。
- [x] 3.2 用隔离 HOME/LOCALAPPDATA 的候选 archive 验证默认入口、同目录脚本启动、`--apply` 编排和新入口核对；另跑现有安装器的 fixture 集成测试覆盖 archive 校验、停旧 Backend 与切换。分别记录候选与安装器测试证明了什么后勾选，源级模拟不能替代候选检查。
- [ ] 3.3 在 macOS arm64、Linux x64、Windows x64 的候选包上完成平台脚本、no-op、非默认入口拒绝、切换前失败、单条 JSON 和代理错误验证；记录未覆盖的公开 Release 路径，将公开发行间的真实 `--apply` smoke 交给发布验证，不作为代码 PR 的前置条件。本项不授权改 release workflow 或发布。
- [ ] 3.4 直接运行两个平台安装器及 `lore update --apply` 时显示低频 archive 下载量/速度、服务端提供总大小时的百分比和独立的下载完成提示；未知总量不编造百分比，`--json` stdout 仍只有最终结果，Windows 不恢复缓慢的内建逐块 UI。以隔离下载 fixture 检查已知/未知大小、成功和下载/校验失败、CLI 只转发安全进度行；更新中英安装页并记录平台实测范围。
