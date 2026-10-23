# 实施验证记录

验证日期：2026-10-23。基线 commit：`cc99a05`。运行环境：macOS，Bun 1.4.2。

## 真实维护命令

从基线创建隔离 checkout，叠加新命令和公开推荐文件，实际执行 `bun run release:version`，
而非只调用导出函数。没有在工作仓库应用任何候选版本。

- `check` 接受已提交的原生版本及其镜像。
- 混合执行 `prepare --cli 0.1.0-smoke.7 --codex 0.2.0-smoke.1 --dry-run`，diff 为空。
- 应用同一选择后，只有 CLI manifest、所属 lockfile workspace 和 Codex manifest 变化。
  其他宿主、公开推荐、历史 fixture、安装器和 release workflow 不变；推荐落后于源码时仍通过 `check`。
- 重复执行同一请求，diff 的字节内容不变。
- `docs --cli 0.1.0-smoke.7 --dry-run` 没有写入；应用后只改变
  `apps/site/content/public-release.json`，重复执行不再产生改动。
- 分别更新 ZCode、Cursor、WorkBuddy、Claude、omp，每次只有该宿主的原生 manifest
  和所属 marketplace entry 变化，且通过 `check`。
- 带 `v` 的目标版本在零写入的情况下失败。主动制造 ZCode 镜像原值不匹配后，准备操作在
  写入前失败并指出 marketplace 文件；此问题不阻断 Codex-only 更新，全量 `check` 会报告它。

本地推荐更新只是临时 fixture 演练，不构成公开发布、真实安装器 smoke 或站点部署。

## 站点内容与复制行为

- `bun test apps/site/src`：180 项通过，0 项失败。
- remark 转换器的两项测试覆盖具体 Unix/PowerShell code 节点，以及无效语法的源文件位置错误；
  预期版本来自公开数据文件，不另写当前版本字面值。
- 站点 typecheck 通过。整改后 `bun run --filter @lorelum/site build` 通过，prerender 82 页，
  保留 Fumadocs 默认处理链；双语 `agents.md` 产物中的两条精确版本命令已重新核对。
- 初次验证时，真实浏览器中的四份中英文安装和 Agent 参考页面均显示两条具体命令，8 个复制按钮均出现成功状态。
- 点击安装页的 Unix 和 PowerShell 复制按钮后，将系统剪贴板与预期命令精确比较，均匹配。
  验证只输出布尔结果和长度，没有输出剪贴板内容。本轮没有改动复制按钮或安装命令，复用此路径证据。
- 对中英文 `agents.md` 开发路由的真实 HTTP 请求均返回 200，包含两条完整版本命令，
  没有 `<CliInstall>`。生产构建的对应 Markdown 文件也包含相同命令。

## 既有发布合同

以下命令的 3 项测试通过，0 项失败：

```sh
bun test scripts/release/assets.test.ts scripts/release/package.test.ts scripts/release/build-entrypoints.test.ts
```

Release workflow、安装器、资产命名实现及独立历史 fixture 均没有实现改动。

## 最终检查与审查

- 版本工具、remark、CLI 协议、Plugin layout 和发布合同的 focused tests：8 个文件，31 项通过，
  0 项失败。版本工具使用内存文件系统，并明确断言非法或缺失的公开推荐数据不会触发写入。
- `bun run lint` 通过，仅有本次改动范围外既有的 `no-await-in-loop` 警告。
- `bun run typecheck` 通过，包含最终测试文件。
- 所有改动 TypeScript/JSON 文件的定向 Oxfmt 检查和 `git diff --check` 通过。
- 工作仓库的 `bun run release:version check` 通过。
- `openspec validate prepare-independent-release-versions --strict` 通过。
- 整改后独立 Sol 复核通过；复核中发现的键后空白定位与行注释终止符问题均已修复并补回归。

## 审查整改

按 `agentic-coding.implementation.justify-added-checks` 合并重复目标、原值和结构校验，复用本次读取的版本与定位结果；必要检查的责任见 [design.md](./design.md)。版本工具从 963 行减至 758 行，转换器从 146 行减至 108 行，设计从 185 行减至 109 行，发布手册从 198 行减至 178 行；没有拆文件转移代码或新增依赖。

两份测试分别从 404/77 行增至 550/95 行，新增合法 JSONC 注释、实际结构路径、重复字段、转义版本 no-op、冒号前空白/注释及行终止符回归；关键回归在修复前已复现失败。整改后重新创建临时 checkout，含合法注释、CR 换行及原生/推荐键后空白，真实命令演练通过。写入前内容核对和部分写入失败的有限回退仍完整保留。

本次没有构建三平台发行包、执行公开安装器、发布 Release、打 tag、部署、commit 或 push。
这些操作不是验证本地维护工具的必要条件，仍遵循既有发布授权边界。
