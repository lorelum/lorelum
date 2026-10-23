# 按发布物准备版本

## 推荐用法

维护者只需要记住一个入口：`bun run release:version`。发布前用 `prepare` 选择版本，发布后需要更换公开安装推荐时用 `docs`；`check` 随时检查本地一致性。以下是拟议用法，版本号仅用于说明，不表示相应版本已公开。

### 只更新 CLI 和 Codex

在正常开发 checkout 中运行：

```sh
bun run release:version prepare --cli 0.1.0-alpha.7 --codex 0.1.0-alpha.8 --dry-run
```

预览列出每个发布物的旧/新版本和实际文件，不写文件。例如在两者原值均为 `0.1.0-alpha.6` 的 checkout 中：

```text
CLI    0.1.0-alpha.6 -> 0.1.0-alpha.7
  packages/cli/package.json
  bun.lock [workspaces.packages/cli.version]
Codex  0.1.0-alpha.6 -> 0.1.0-alpha.8
  plugins/codex/lorelum/.codex-plugin/plugin.json
公开安装推荐保持不变；未选择的发布物保持不变。
预览完成，未写入文件。
```

去掉 `--dry-run` 即写入，不再二次询问；也可以直接写入后审阅 Git diff：

```sh
bun run release:version prepare --cli 0.1.0-alpha.7 --codex 0.1.0-alpha.8
bun run release:version check
git diff
```

CLI 与 Codex 可以使用不同目标版本。ZCode、Cursor、WorkBuddy、Claude Code、omp 的文件不变；Codex marketplace 没有对应 version 字段，因此不写它。协议版本、独立 golden fixture、历史升级样例和 release notes 不跟着替换。测试从 manifest 读取当前实现版本，不要求维护者更新测试中的字面值。

工具不提交代码、不生成 release notes、不替代发布准备 PR。版本准备通过检查、审阅后，仍沿现有流程由维护者触发站点部署和 Release、检查 draft、人工公开、运行安装 smoke。发布前部署的站点可以包含功能说明，但安装推荐仍指向上一个公开可用版本。

### 只更新一个宿主

```sh
bun run release:version prepare --zcode 0.2.0
```

只改 ZCode manifest 及其 marketplace entry。`--cursor`、`--workbuddy`、`--claude`、`--omp` 同理；omp 使用原生 `package.json`，其他宿主使用各自原生 `plugin.json`。可以在一次命令里选择多个发布物；没有 `--all`、自动推断版本或默认联动。

Plugin-only 准备不要求发布 CLI，也不要求运行 CLI Release workflow；发布渠道和宿主安装/更新验证仍由各自既有流程负责，不更新公开 CLI 推荐。

### 发布后更新公开安装推荐

新 CLI 已公开且支持的安装路径 smoke 成功后，执行：

```sh
bun run release:version docs --cli 0.1.0-alpha.7 --dry-run
bun run release:version docs --cli 0.1.0-alpha.7
bun run release:version check
git diff
```

工具只更新 `apps/site/content/public-release.json` 的 `cli` 字段，显示旧/新推荐版本和文件名，不逐页编辑文档正文。它不更新 manifest，不要求源码版本等于推荐版本：即使源码已在准备 alpha.8，也可以推荐刚公开并通过 smoke 的 alpha.7。

`docs` 是维护者主动推进推荐的操作，工具只检查本地文档一致性，不联网推断发布进度，也不宣称自己验证了可安装性。发布并完成 smoke 是本操作的流程前提，不增加新的确认参数。公开推荐可以继续停留在旧版本；无需每个 Plugin 更新后执行它。

推荐数据改动仍需正常审阅合并，并手动部署站点；命令成功只表示本地文件更新成功，不表示网页已上线。已公开版本的 GitHub Release 说明沿用精确版本安装命令，不随下一次准备而改变。

## 文档作者怎么写

公开推荐值只定义一次，例如：

```json
{ "cli": "0.1.0-alpha.6" }
```

站点英文/中文 installation、agents 页不手写当前版本和安装命令，而是按平台复用安装内容：

```mdx
<CliInstall platform="unix" />

<CliInstall platform="windows" />
```

构建时生成包含精确版本的普通代码块。读者复制到的是可直接执行的完整命令；Agent 读取 `agents.md` 时得到同一条具体命令，不是 JSX 标签。正文写“以下命令使用推荐的公开版本”即可，精确版本由命令展示。新增安装内容不需要加定位标记、登记替换位置或新增一份版本字面值。

README 保留平台说明和对应语言安装指南入口，不复制带当前版本的安装教程；README 与 Quickstart 中交给 Agent 的提示也不再指定版本，继续让它按 `agents.md` 完成配置。手动安装因此多一次点击，但不需要给静态 GitHub README 建模板或生成流程。

开发者从根 `AGENTS.md` 的全局命令部分找到版本准备入口：那里简述 `prepare`、`docs`、`check` 和 `--dry-run`，并链接 `docs/development/release.md`。发布时机、完整操作、审阅和回退只在维护者手册中说明，不把整套流程复制到 AGENTS。

## 出错、重复执行与回退

| 情况 | 可见结果与保留内容 | 下一步 |
| --- | --- | --- |
| 同一目标重复执行 | 输出“无改动”，文件字节不变；无需重复改版 | 继续审阅或发布 |
| 非法版本、未知参数/宿主、同一发布物重复参数、未指定发布物 | 非零退出，指出参数；不写文件 | 修正命令 |
| manifest 与本宿主 marketplace/CLI lockfile 原值不一致 | 非零退出，列出路径、字段、预期值和实际值；不写任何文件 | 修复报告的不一致后重试 |
| 公开推荐文件缺失、结构不符合约定或版本无效 | `docs` / `check` 非零退出，指出文件和字段；不写任何文件 | 修复该文件后重试 |
| 安装内容组件的平台或属性不符合约定 | 站点构建失败，指出文档位置；不生成含未展开标签的安装说明 | 将组件用法改为支持的平台与属性 |
| 更新已选发布物时，未选发布物存在独立的一致性错误 | 不替它修改；该命令只检查本次处理范围 | 用 `check` 查看并单独处理 |
| 写入期间发生普通文件错误 | 非零退出，尝试恢复本次已尝试写入文件的原始内容，包括可能只写入部分的失败文件；报告恢复结果 | 处理权限/磁盘错误后重试 |
| 进程强杀、断电，或恢复本身失败 | 不承诺跨文件崩溃原子性；Git diff 可见实际改动，错误中列出未恢复路径（若进程仍能报告） | 审阅 diff，按文件回退本次修改后重新执行 |

预览不是必须的审批关口；写入后的 Git diff 同样可审阅。工具保留目标文件里的无关编辑，不要求整个 worktree 干净。需要回退时，用 `git diff` 和 `git restore -p -- <本次列出的路径>` 选择性撤销；只有确认文件无其他个人编辑时才整文件还原。工具不自动 stash、reset 或 checkout。

## 保持不变的边界

版本权威仍是每个发布物自己的 manifest；公开安装推荐数据不成为全局版本。SemVer 幅度、是否发布、release notes、tag/asset 验证、人工公开、宿主验证和站点部署仍由维护者按既有流程决定。工具不接管 `lore update`，不自动安装或更新用户的 CLI、Plugin、Pack 或模型。
