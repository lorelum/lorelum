## Purpose

为维护者提供按 CLI 和宿主 Plugin 独立选择版本的仓库内准备入口，集中同步必要镜像并提供可审阅结果；将源码候选与公开安装推荐分开推进，保留既有发布审批、原生版本权威和历史样例。

## ADDED Requirements

### Requirement: Explicit independent artifact selection

仓库 SHALL 提供 `bun run release:version prepare`，支持显式选择 `cli`、`codex`、`zcode`、`cursor`、`workbuddy`、`claude`、`omp` 及各自不带 `v` 的有效 SemVer。命令 MUST 至少选择一个发布物，不得默认联动未选择的发布物；同一请求可使用不同目标版本。无效版本、未知或重复参数 MUST 在写入前报错。

#### Scenario: CLI and Codex use different target versions

- **WHEN** 维护者只指定 `--cli 0.1.0-alpha.7 --codex 0.1.0-alpha.8`
- **THEN** 工具 SHALL 只更新 CLI manifest、CLI lockfile 镜像及 Codex manifest，且其他发布物、文档公开推荐和历史样例 MUST 保持不变

#### Scenario: Invalid request

- **WHEN** 请求不含发布物、重复选择同一发布物、包含未知参数或无效版本
- **THEN** 工具 MUST 非零退出并指出错误参数，且不写任何文件

### Requirement: Native version authority and owned mirrors

每个发布物 MUST 保持自己的原生 manifest 作为版本权威。CLI SHALL 只同步自己的 lockfile workspace 版本；ZCode、Cursor、WorkBuddy、Claude Code、omp SHALL 只同步本宿主既有 marketplace entry。Codex MUST NOT 被要求新增 marketplace version。预检 MUST 要求所属镜像原值等于本次原生 manifest 的版本，不得通过更新掩盖已有不一致。

#### Scenario: A single host is prepared

- **WHEN** 维护者单独选择 ZCode、Cursor、WorkBuddy、Claude Code 或 omp
- **THEN** 工具 SHALL 只更新所选宿主的原生版本和对应 marketplace entry，且不得改变 CLI 或其他宿主

#### Scenario: Codex has no entry version

- **WHEN** 维护者只选择 Codex
- **THEN** 工具 SHALL 更新其 manifest，且 MUST 不在其 marketplace 新增或要求 version 字段

#### Scenario: A mirror has an unexpected original value

- **WHEN** 本次选中发布物的镜像版本不等于其原生 manifest 版本
- **THEN** 工具 MUST 在任何写入前非零退出，列出路径、字段、预期值和实际值

### Requirement: Separate explicit public installation recommendation

`prepare` MUST 不推进公开安装推荐。仓库 SHALL 以单一公开推荐数据保存文档所用的 CLI 版本，并提供独立的 `docs --cli <version>` 只更新该推荐值，MUST 不逐页修改文档或更新 manifest。该动作 SHALL 要求维护者显式指定公开目标，MUST 不从源码版本推断默认值。公开推荐 SHALL 允许不同于源码版本。

维护者流程 MUST 将 `docs` 安排在公开发布及支持安装路径 smoke 之后。此命令 SHALL 只承诺本地文档同步，不自动查证发布/安装状态，不发布或部署，也不将本地成功报告为已公开可安装。

#### Scenario: The next candidate is not yet published

- **WHEN** 源码准备了新 CLI 版本，尚未执行公开推荐更新
- **THEN** 公开文档 MUST 保持原有安装目标，且本地一致性检查 MUST 允许候选版本领先于公开推荐

#### Scenario: A published version is recommended while source is ahead

- **WHEN** 维护者已公开并完成目标版本的安装 smoke，显式执行 `docs --cli <该版本>`，而源码已在准备另一版本
- **THEN** 工具 SHALL 只将单一公开推荐值更新至显式目标，不改动源码 manifest 或文档正文

### Requirement: Shared concrete installation content

站点双语 installation、agents 的当前安装内容 SHALL 复用单一推荐值生成精确版本命令。网页显示、复制内容与 Agent Markdown 输出 MUST 使用同一条具体命令，不得留下未展开的 JSX 或版本占位符。README SHALL 提供本语言安装指南入口，不复制当前版本安装命令；README 与 Quickstart 的 Agent setup 提示 SHALL 不写当前版本，并继续指向可用的 Agent 参考文档。

#### Scenario: Public recommendation changes

- **WHEN** 单一公开推荐值更新并构建部署站点
- **THEN** 双语网页、复制结果和 `agents.md` SHALL 使用该目标版本，且不要求逐页编辑或更新 README

#### Scenario: An installation component is invalid

- **WHEN** 文档安装内容使用未知平台、额外属性、动态属性或不支持的 children
- **THEN** 站点构建 MUST 报告文档文件及位置，不得静默输出未展开的安装节点

### Requirement: Bounded current-version ownership

自动化 MUST 只处理声明过的原生字段、镜像和单一公开推荐数据。已知文件/字段缺失、结构无法识别或原值不匹配 MUST 在写入前报告路径和字段，不得猜测新位置。检查范围 MUST 不被描述为发现任意新文件或任意自然语言版本声明。历史记录、独立协议 fixture、升级测试版本、release notes 历史比较、依赖及未选发布物 MUST 不被全仓替换。

#### Scenario: The public recommendation has an unknown structure

- **WHEN** 公开推荐数据文件缺失、其字段不符合约定或版本无效
- **THEN** `docs` 与 `check` MUST 非零退出并报告文件/字段，且 `docs` 不写任何文件

#### Scenario: Historical test values match the old source version

- **WHEN** 发布物更新前的版本号也出现在旧版本测试、独立协议样例或历史记录中
- **THEN** 工具 MUST 保留这些内容，不因字符串相等就更新

### Requirement: Reviewable idempotent edits and local checks

`prepare` 和 `docs` SHALL 展示旧/新版本及实际改动文件，支持只预览不写入的 `--dry-run`；目标已满足时 SHALL 成功报告无改动并保持原始字节。`check` SHALL 离线检查全部已登记原生版本关系与公开推荐数据格式，不修改文件、不要求候选与公开推荐相等，也不要求每次检查都构建站点。

写入前 MUST 完成本次范围的全部预检并检查目标内容未变。普通写入失败 MUST 非零退出并尝试恢复本次已尝试写入的原始内容，明确报告恢复失败路径。工具 MUST 不覆盖无关 worktree 编辑，不要求整个 worktree 干净，也不自动执行 Git 回退；文档 MUST 说明强杀/断电不具备跨文件原子性及按精确路径回退的方法。

#### Scenario: Preview and repeated application

- **WHEN** 维护者先预览，再写入，再重复执行相同目标
- **THEN** 预览 MUST 零写入，首次写入 SHALL 与预览范围一致，重复执行 SHALL 报告无改动且不产生字节变化

#### Scenario: A normal file write fails

- **WHEN** 预检通过后的某个文件写入部分完成后失败
- **THEN** 工具 MUST 尝试恢复已尝试写入的本次文件，包括失败文件，报告原始错误、恢复结果与未恢复路径，并非零退出

#### Scenario: An unselected artifact has an independent mismatch

- **WHEN** 维护者准备一个一致的发布物，而未选发布物存在镜像不一致
- **THEN** `prepare` SHALL 不修改或替它修复未选发布物，且全量 `check` SHALL 报告该独立问题

### Requirement: Existing release authority remains unchanged

版本工具 MUST 不自动 commit、push、打 tag、创建/公开 Release、发布 registry 或部署站点。CLI 的 `v<CLI version>` 校验、资产命名、同 commit provenance、draft 验证和人工公开关口 SHALL 保持现有合同。版本关系测试 SHALL 从各自权威读取预期值，不要求每次发版重复修改当前版本字面断言；固定测试输入 SHALL 保持独立。

#### Scenario: A prepared candidate needs publication

- **WHEN** `prepare` 成功完成
- **THEN** 工具 MUST 只报告本地准备结果，维护者仍须按既有发布流程审核与发布，且 MUST 不将准备成功声称为用户已能安装

### Requirement: Discoverable maintainer command entry

命令实现交付时，根 `AGENTS.md` SHALL 在全局命令部分提供 `prepare`、`docs`、`check` 和 `--dry-run` 的简短用途及维护者发布手册链接。完整操作、公开推荐推进时机、发布关口和回退 SHALL 由 `docs/development/release.md` 说明；AGENTS MUST 不复制整套流程或要求维护每次变化的当前版本值。

#### Scenario: A developer discovers the release command

- **WHEN** 开发者从根 `AGENTS.md` 查找版本准备方法
- **THEN** 其 SHALL 能识别版本准备、发布后推荐推进与离线检查的入口，并沿链接找到与已实现命令一致的完整用法及回退说明
