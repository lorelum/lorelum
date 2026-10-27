## Why

维护者需要逐处同步独立发布物的版本，容易漏改，也容易把未选择的宿主一起升级。源码待发布版本与文档推荐的公开安装版本属于不同时间点，不能用一次全仓替换处理。关联 Issue：lorelum/lorelum#253。

## What Changes

本变更新增维护者使用的版本准备行为，不改变用户侧 `lore update`。

- 提供 `bun run release:version`，用 `prepare` 显式选择 CLI 和/或宿主及目标版本；未选择的发布物不变。
- 支持仓库已有的 `codex`、`zcode`、`cursor`、`workbuddy`、`claude`、`omp`，版本仍由各自原生 manifest 定义；只同步本发布物必要的派生字段。
- 用一份 `apps/site/content/public-release.json` 保存公开 CLI 安装推荐；独立的 `docs --cli <version>` 只更新这个值，`prepare` 不更新它。CLI 发版时两个动作在同一次准备中执行，产物版本、推荐和说明合入同一个 PR，不要求发布后补改。
- 站点双语 installation、agents 复用 `<CliInstall platform="unix" />` / `windows` 安装内容，在 Markdown 编译阶段生成具体代码块，使网页、复制命令和 `agents.md` 使用同一结果。README 和 Quickstart 不再写当前版本，README 安装段落改为安装指南入口。
- 两种更新支持 `--dry-run`，并提供离线 `check`；检查完成后才写文件，失败明确列出文件与恢复方式。
- 测试断言版本关系与更新结果，不把协议样例、升级旧版本和历史记录当成当前版本位置。
- 根 `AGENTS.md` 提供 `prepare`、`docs`、`check` 及预览方式的简短入口，并链接维护者发布手册；手册说明完整用法、发布时机和通过 Git 审阅/回退的路径。不建立全仓统一版本号、README 模板或发布自动化。

## Capabilities

### New Capabilities

- `release-preparation`：维护者按发布物独立准备版本、检查一致性，并在同一个发布 PR 中显式准备安装推荐。

### Modified Capabilities

无。保留 `cli-distribution` 的 tag、资产和人工发布合同，以及 `plugin-distribution` 的宿主原生版本规则。

## Impact

拟修改 `scripts/release/`、根 `package.json` 的脚本入口、CLI 在 `bun.lock` 的 workspace 版本、各宿主原生 manifest/marketplace、根 `AGENTS.md` 与维护者发布手册。站点新增公开推荐数据与安装内容编译插件，并迁移 README 和双语安装、入门、Agent 参考文档；后续推进推荐只修改公开推荐数据，不逐页改文档。具体用户路径见 `product.md`，规则和代码边界见 `design.md`。

不新增依赖，不修改 release/publish workflow、安装器或站点部署机制，不自动 commit、push、打 tag、发布 Release、发布 registry 或部署站点。
