## Context

推荐一个维护入口、三个动作：`prepare` 只准备所选发布物，`docs` 只推进公开 CLI 安装推荐，`check` 只检查本地关系。用户路径见 [product.md](./product.md)，动机和范围见 [proposal.md](./proposal.md)。

### Observed evidence

| 已核对位置 | 事实及设计影响 |
| --- | --- |
| `packages/cli/package.json`；`packages/cli/src/output/protocol.ts` 的 `toolVersion` | 运行时已从 CLI manifest 读取实现版本，无需再生成版本模块 |
| `bun.lock` 的 `workspaces["packages/cli"].version` | 是 CLI workspace 镜像，需要同步；不更新其他 package/dependency 版本 |
| `plugins/<host>/lorelum/` 原生 manifest；`docs/development/plugin-conventions.md`；`openspec/specs/plugin-distribution/spec.md` | 已有六宿主原生分发合同，不能退回 Issue 举例时的四宿主集合；各宿主独立版本 |
| `plugins/scripts/plugin-layout.test.ts` 的 `assertMarketplaceVersion` | ZCode、Cursor、WorkBuddy、Claude 已测试同宿主镜像一致；Codex 没有 entry version；omp 需要补上相同关系的测试 |
| `packages/cli/src/index.test.ts`；`output/protocol.test.ts`；`output/protocol-envelope.fixture.json` | 主测试不再断言字面当前版本；golden fixture 只验证协议结构，版本不要求与实现相等，不是待同步的当前版本 |
| `scripts/release/install.integration.test.ts`、`install-ps1.integration.test.ts`、`assets.test.ts` | 固定版本承担安装、升级、命名的测试输入，不是当前发布声明 |
| 两个 README；站点 `installation`、`quickstart`、`agents` 的双语文档 | 含精确版本安装命令、推荐说明或交给 Agent 的 setup 提示，构成本次文档管理范围 |
| `apps/site/src/features/docs/content/registry.ts`；`server/source.ts#getLLMText`；`routes/$lang/docs/{$}[.]md.ts` | 文档启用 `includeProcessedMarkdown`，Markdown 路由读取 `getText("processed")`，不是抓取 React 渲染结果；安装内容必须在共享编译阶段展开 |
| `apps/site/vite.config.ts` 的 `fumadocsMdx()` | 是现有 Fumadocs preset 接入点；在其 Markdown 编译配置中加入安装内容转换，保留默认插件 |
| 根 `AGENTS.md` 的 Global commands and verification、release guardrails | 已有发布手册链接，但没有版本准备命令入口；命令实现与简短入口必须一起交付 |
| `install.sh` 的 `resolve_latest_tag`；`install.ps1` 的 `Resolve-LatestTag` | 无参数走 GitHub `/latest` stable，不能用删除版本参数来替代 alpha 安装命令 |
| `.github/workflows/release.yml`；`scripts/release/assets.ts`；`scripts/release/package.ts` | tag 与 CLI manifest 一致、资产由 CLI version 命名；保持不变 |
| `docs/development/release.md` 的 Normal prerelease path | 产物版本、安装推荐与发布说明同 PR 准备；Release 构建和一次站点部署不互为前置，产物校验与公开安装 smoke 保留 |

现状的一条完整路径是：维护者逐处改 manifest、镜像、文档，提交准备 PR；workflow 读取 CLI manifest 校验 tag，打包函数读取同一版本命名资产；维护者公开后运行 installer smoke。问题在人工编辑没有区分候选和公开推荐，不在现有打包/发布合同。

## Goals / Non-Goals

**Goals:** 一次显式请求只更新所属发布物的必要位置；预检失败不写入；公开推荐只保存一个值并允许落后于源码；网页与 Agent Markdown 使用同一条实际安装命令；开发者能从根 AGENTS 找到用法。

**Non-Goals:** 不建设通用 monorepo release 管理器，不生成 changelog，不改变 installer channel、release workflow、Plugin 分发或站点部署；不新增持久 plan、锁、备份目录、全仓版本账本、README 模板流水线和网络服务。

## Decisions

### 1. 原生 manifest 与公开推荐分开拥有，只有一个命令入口

根 `release:version` 运行 `scripts/release/versions.ts`，不进入用户 `lore` command registry。参数及退出行为见 [spec](./specs/release-preparation/spec.md)，维护用法见 [发布手册](../../../docs/development/release.md)。输入处复用现有 `normalizeVersion` 校验完整且不带 `v` 的 SemVer，内部受控调用不重复验证同一目标。

| 选择 | 唯一原生版本源 | 同步的镜像 |
| --- | --- | --- |
| CLI | `packages/cli/package.json#version` | `bun.lock#workspaces["packages/cli"].version` |
| Codex | `plugins/codex/lorelum/.codex-plugin/plugin.json#version` | 无；不改 `.agents/plugins/marketplace.json` |
| ZCode | `plugins/zcode/lorelum/.zcode-plugin/plugin.json#version` | 根 `marketplace.json` 的 Lorelum entry |
| Cursor | `plugins/cursor/lorelum/.cursor-plugin/plugin.json#version` | 根 `.cursor-plugin/marketplace.json` 的 Lorelum entry |
| WorkBuddy | `plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json#version` | 根 `.codebuddy-plugin/marketplace.json` 的 Lorelum entry |
| Claude Code | `plugins/claude/lorelum/.claude-plugin/plugin.json#version` | 根 `.claude-plugin/marketplace.json` 的 Lorelum entry |
| omp | `plugins/omp/lorelum/package.json#version` | 根 `.omp-plugin/marketplace.json` 的 Lorelum entry |

表在脚本内是固定路径/字段清单，不保存任何当前版本值，不自动发现并接管其他 package。marketplace 按 `name: lorelum` 与宿主 source 识别所属 entry，不盲改数组第零项。

### 2. 公开推荐只存一处，文档复用安装内容

新增 `apps/site/content/public-release.json`，结构只有一个 `cli` 字符串，例如 `{ "cli": "0.1.0-alpha.6" }`。它只拥有推荐安装版本，不拥有源码候选或任何 Plugin 版本，不要求等于 CLI manifest。`docs --cli V` 仅更新这个字段，不逐页替换文档；`check` 离线检查该文件结构和版本合法性。

站点安装内容的作者用法与 README 取舍见 [product.md](./product.md#文档作者怎么写)。`remark-public-release.ts` 把 `CliInstall` 展开为标准 `code` 节点，保留 Unix `--version V` 和 PowerShell `-Version V` 的现有安装语义，不新增客户端组件或运行时请求。

`docs --cli V` 显式指定推荐目标，不从源码推断默认值、不按版本大小选择，也不联网判定发布状态。CLI 发版时与 `prepare` 一起执行、同 PR 合并，不以 publish 或 installer smoke 为文档编辑前提。命令只承诺本地推荐值修改；正常合并和手动部署后页面才使用新推荐。

不选择标记或上下文匹配：两者仍把多份当前版本文字当作需要维护的状态，并会让文案调整影响同步规则。不选择自动安装最新 prerelease：那需要改变 Unix/PowerShell 安装器的公开频道和 Release 选择规则，超出本工具所需边界。

### 3. 共享编译路径保证网页与 Agent Markdown 一致

在 `vite.config.ts` 的 Fumadocs `globalOptions.mdxOptions.remarkPlugins` 接入转换器，保留默认 preset；转换必须先于代码高亮与 processed Markdown 保存。`registry.ts` 的 `includeProcessedMarkdown` 保持开启。页面和复制按钮消费生成的代码块，`getLLMText` 从同一编译结果读取 processed Markdown，供 `agents.md` 返回。

普通 React 组件或围栏内的 `{version}` 表达式不能代替这一步。实施验收必须实际比较双语页面代码块、复制结果和 `agents.md`；插件配置类型可用不等于执行顺序已被验证。

`prepare` 仍只预检本次选中发布物：原生字段合法且镜像原值相等。即使镜像恰好等于目标而不同于原生值，也先报错，不隐藏半更新。未选发布物的独立错误不阻断本次操作，用全量 `check` 报告。原生字段、镜像或公开推荐结构变形时指出文件和字段，不猜测新位置。

自动化不扫描全仓 SemVer，不替换 archive、研究、release notes、依赖、protocol fixture 或升级测试。未知参数/宿主由维护脚本拒绝，安装内容的未知属性/平台由编译器拒绝；不声称能够发现任意新文件中的任意自然语言版本声明。新增当前安装内容应复用已有节点，固定历史示例继续按其自身用途保留。

### 4. 小脚本拥有整个用例，内存修改集只服务预览和有限回退

`versions.ts` 内保存静态位置清单和私有 helper，用 `import.meta.main` 隔开入口与测试。不建设 provider、注册体系或通用编辑库；read/write 函数注入只服务内存 fixture 测试。

`planVersionChange` 是单次调用作用域：`prepare` 读取选中原生字段与镜像，`docs` 读取公开推荐数据，先形成完整修改集，不写文件。文件内容保留在内存，仅包含真正变化的路径。由同一修改集生成预览和写入后的改动摘要，避免两套推导。`FileEdit` 因本任务真实要求 dry-run 和写入失败回退而存在，不持久化、不允许重放存盘 plan。

根路径相对脚本目录确定，不依赖 shell cwd。`check` 复用字段读取逻辑，只检查本地已登记关系，不启动 Backend、访问 Store 或运行站点构建。报告直接使用初次读取的旧版本，不从修改前文本重新解析和推导。

普通 JSON 用 `JSON.parse`，lockfile 用 `Bun.JSONC.parse`；一次读取负责语法、字段和版本预检。文本定位沿实际对象键/数组元素识别所属字段，正确跳过字符串转义及 JSONC 注释，不再以全局文本锚点查找 CLI workspace。定位结果与旧版本一起复用，修改只替换目标字符串 token，保留其他字节；不整文件序列化，也不运行 `bun install`。

校验放在实际边界：输入处校验目标；准备处确认文件结构、所属字段和镜像原值；提交处检查磁盘内容是否改变并处理 I/O 失败。内部 helper 不重复解析同一内容或再次验证上游已保证的目标/原值。转换器只检查文档作者可写错的平台、属性、children 和块位置，不防御编译器违反 AST 类型。

规划预检全部通过后才写。写入前比较目标文件与捕获的 `before` 字节，发现编辑器在其间修改则停止而不覆盖。写入使用逐文件替换；发生可捕获 I/O 错误时尝试恢复本次已尝试写入文件的原始字节，包括可能只写了一部分的失败文件，并分别报告原错误和恢复失败路径。恢复只针对本次写入，不操作整个工作树。进程强杀/断电不承诺跨文件原子性，由 Git diff 审阅和选择性回退处理；不加崩溃日志和后台恢复机制。

### 5. 删除每次发版的人工同步职责，保留真正的发布验证

不再要求改测试/fixture 的“当前版本字面值”。已用 `toolVersion` 的测试保持；补一条 `toolVersion === CLI manifest.version` 关系断言即可。golden protocol fixture 保留独立样例版本；安装/升级/资产命名测试中的固定输入不变。Plugin 测试保留自己的原生合同断言，补 omp 镜像关系，不能只让 checker 与测试共享同一份位置表然后互相证明正确。

保留 release notes 的 `__RELEASE_VERSION__` / `__RELEASE_TAG__` 现有替换；不把 notes 的历史比较与升级说明加入本脚本。不保留并行的手工版本清单作为另一套同步规则；runbook 引用命令及其输出。

根 AGENTS 只保留简短入口，完整发布流程和回退由发布手册拥有，不在设计中另复制一套步骤。

## Risks / Trade-offs

- 公开推荐与产物版本在同次发布准备中修改，站点部署可能先于发行包公开完成；不为这段发布窗口增加第二个 PR 或部署。
- `docs` 不证明输入版本已公开；真正可安装性由既有 publish/smoke 流程验证，不把该验证变成文档编辑的等待条件，也不新增远端状态检查。
- README 不再直接提供当前版本安装命令，手动安装多一次点击；用明确的本语言安装指南入口承接，不另建生成流程。
- MDX 转换顺序若不正确，可能导致 Markdown 导出残留 JSX；用真实编译和双语页面/Markdown 对照验证，不用纯 React 渲染测试代替。
- 跨文件写入仅有预检和普通错误恢复，不具有崩溃事务保证；Git 提供可见 diff 和回退，不引入持久事务系统。

## Migration Plan

一次实现完成维护脚本、根 package 入口、公开推荐数据、安装内容转换、文档迁移、关系测试及根 AGENTS/维护手册入口，不做半套正式入口。初始化公开推荐数据时保留原有文档推荐值，不从源码候选或未经验证的远端状态重新选版本；若原文档不一致，先报告并确认正确公开目标。

行为验收用隔离临时 checkout/fixture 覆盖 CLI-only、每宿主、混合不同版本、未选文件字节不变、dry-run、重复执行、旧推荐落后源码、非法版本/原值/公开数据零写入、一次部分写失败回退。用真实维护入口在临时 checkout 演练 `prepare`、`docs --dry-run`、`docs`、`check` 和 Git diff，确认 docs 只改一个公开推荐文件；这里的本地演练不构成公开发布声明。

结构验收直接检查所有权和 diff：manifest 仍是发布物版本源，公开推荐只在一个 JSON 中定义，安装命令只由一个内容模块生成；维护脚本不依赖发布服务或站点运行时，没有改 workflow、installer、协议版本、历史 fixture 或未选发布物。依照实际改动运行 focused tests、lint/typecheck 和站点 build，实际验证页面、复制命令和 Markdown 导出的相同版本及可执行命令；从根 AGENTS 跟随链接走到完整用法。无需为本变更重建三平台发布资产。

维护演练一：新增公开安装说明只需引用 `CliInstall`，不增加版本存储或替换规则。维护演练二：源码进入下一候选，但要继续推荐上一公开版本；只运行带明确目标的 `docs` 更新推荐值，不需要修改 manifest、文档正文或 release tag。两者都无需新增状态机。

回退实现使用正常 Git revert；回退一次版本准备使用本次输出的精确路径选择性还原。不移动已存在 release tag，不把退回推荐文档当成撤销已发布资产。
