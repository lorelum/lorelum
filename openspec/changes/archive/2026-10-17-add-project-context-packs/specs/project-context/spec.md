## Purpose

为任意目录中的团队局部 Practice 提供可预测、可继承且不污染用户 Store 的 ProjectContext，使 Git 项目、多个 worktree 和普通目录都能按相同规则复用可重建的派生 cache。

## ADDED Requirements

### Requirement: ProjectContext discovery and explicit control

ProjectContext 的 layer 是直接包含 `.lorelum/` 的目录。未传 `--project-root` 时，`lore query`、`lore get` 与 `lore index` SHALL 从当前目录向上找到最近的 layer 作为 leaf，再按父到子顺序收集其祖先 layer；Git repository、worktree、submodule 或任何 Git metadata MUST 不影响发现结果。`--project-root <path>` MUST 选择一个存在且直接包含 `.lorelum/` 的 leaf directory；它不要求是 Git repository。`--no-project` MUST 禁用全部 layer discovery 并保持仅 Store 行为；`--cache-root <path>` MUST 只选择本次调用可见的用户级 derived cache，且不得选择 Store、模型、Backend、provider 或 runtime。

#### Scenario: An ordinary directory activates ProjectContext

- **WHEN** 调用方位于非 Git 目录树，且最近祖先目录直接包含 `.lorelum/`
- **THEN** query、get 与 index MUST 使用该 ProjectContext，且不得要求或探测 Git metadata

#### Scenario: No marker preserves current Store behavior

- **WHEN** 调用方目录及其祖先没有 `.lorelum/`，或传入 `--no-project`
- **THEN** 命令 MUST 只使用 selected LocalStore，且不得创建或读取 ProjectContext artifact

#### Scenario: Explicit project root is a directory contract

- **WHEN** 调用方以 `--project-root` 指向不存在的路径、非目录，或不直接包含 `.lorelum/` 的目录
- **THEN** 命令 MUST 返回可区分的 usage error，且不得猜测其他 project root 或开始 Backend 工作

### Requirement: Parent-to-child configuration inheritance

ProjectContext SHALL 默认从 parent layer 继承到 child layer。每个 layer 的可选 `config.yaml` MUST 先按父到子顺序 fold，再对缺失字段应用产品默认值；child 未声明的配置字段 MUST 继承 parent 的有效值。`base: user|none` 使用最近 child 的显式值覆盖 parent。`packs.<packName>.enabled` 与 `packs.<packName>.priority` MUST 按 Pack name 和字段增量合并；priority 是整数，值更高者优先。`inherit: false` MUST 使当前 layer 不加载任何 parent layer，但仍可使用其自身 config、Packs 与显式/默认 Store base。

#### Scenario: Child config overrides only its declared Pack settings

- **WHEN** parent layer 为 `platform` 设置 priority 10，child layer 只将该 Pack priority 设为 100 并新增 `payments` 设置
- **THEN** effective config MUST 保留 parent 的其他设置、使用 `platform: 100`，并同时包含 `payments` 设置

#### Scenario: Child layer explicitly isolates from parents

- **WHEN** child `.lorelum/config.yaml` 设置 `inherit: false`
- **THEN** parent layer 的 config 和 Pack source MUST 不参与该 child ProjectContext

### Requirement: Incremental Pack and Practice precedence

所有继承 layer 的有效 Pack source SHALL 共同参与一个 ProjectContext resolver。`packs.<packName>.enabled: false` MUST 排除该 Pack 的所有继承 source。对同 ID Practice，resolver MUST 按 effective explicit priority、随后 directory depth（child 优先于 parent）、再按稳定 Pack/source-directory 顺序选择一个 active winner；selected Store 仅在 effective `base: user` 时作为最低优先级来源。同名 Pack source MUST 不整体遮蔽 parent 或 Store 的同名 Pack：child source 只覆盖它实际提供的同 ID Practice，其他有效 Practice 继续继承或从 Store fallback。shadowed source MUST 保留安全 provenance，且这一 precedence MUST 不改变 LocalStore 对已安装 Pack 的冲突校验。

#### Scenario: Child Pack incrementally overrides a parent Pack

- **WHEN** parent 和 child layer 都有名为 `platform` 的有效 Pack，而 child 只提供一个与 parent 同 ID 的 Practice
- **THEN** 该 ID MUST 使用 child Practice，parent Pack 的其他有效 Practice MUST 继续参与 query、get 与 index

#### Scenario: Invalid local Practice falls through to a lower source

- **WHEN** child source 的某条 Practice 不能安全解析，而 parent 或 Store 有同 ID 的有效 Practice
- **THEN** 无效 child Practice MUST 不参与 precedence，较低优先级有效 Practice MUST 成为 active winner

### Requirement: Granular degradation and context observability

layer config、Pack metadata/root 与单条 Practice MUST 分别处理。config 无法安全解码时，系统 MUST 忽略该 layer 的 config 并使用可继承的 parent/default configuration；Pack metadata/root 越界或无法验证时，系统 MUST 忽略该 Pack；单条 Practice 无法验证时，系统 MUST 只忽略该条 Practice。普通 query、get 与 index MUST 使用剩余有效来源、将 context 标记为 `degraded`，且不得使用历史 stale source 伪造当前结果。`lore validate` MUST 返回被忽略 layer、Pack 或 Practice 的严格诊断。`lore context status` SHALL 返回 layer 顺序、effective config 摘要、active/shadowed/ignored provenance、warnings 与 keyword/semantic 状态，但 MUST 不泄漏 project absolute path、模型配置、凭据或完整 Practice 正文。

#### Scenario: One broken Practice does not hide its Pack neighbors

- **WHEN** 一个有效 Pack 有 10 条 Practice，其中 1 条格式或字段无效，其余 9 条有效
- **THEN** 系统 MUST 加载其余 9 条，并仅将坏 Practice 标为 ignored；query 和 index MUST 不因该条失败而跳过整个 Pack

#### Scenario: Invalid child config inherits safely

- **WHEN** child layer 的 `config.yaml` 暂时无效，parent layer 与 child Pack source 仍可安全读取
- **THEN** 系统 MUST 使用 parent/default effective config 和安全的 child Pack discovery 继续解析，并返回 degraded warning

### Requirement: Content-addressed derived cache and directory reuse

ProjectContext 的 keyword artifact、complete/progress semantic artifact 与 reusable embedding vector SHALL 是用户级 derived state。它们 MUST 不写入项目目录、`.lorelum/`、Git metadata（若存在）或 LocalStore，且 canonical Practice/provenance MUST 不以 cache 为事实来源。`projectRootId = SHA-256(realpath(leaf directory))` 只用于同一目录的高频 target coalescing；complete artifact identity MUST 只由 index kind/version、固定 Profile（semantic）、以及 ordered active `(practiceId, contentDigest, projectionDigest)` 内容决定，MUST 不包含 project path、Git identity、Store root path、branch、commit、mtime 或 source provenance。相同最终语料的任意目录 MUST 复用 ready artifact；相同 Profile/projection 的 vector MUST 复用。shadowed 或 ignored source MUST 不进入 artifact、progress 或 embedding cache。

#### Scenario: Equivalent ordinary directories reuse an artifact

- **WHEN** 两个无关目录解析出相同 active Practice ID、content 与 semantic projection
- **THEN** 第二个目录 MUST 复用 ready keyword/semantic artifact 或 shared vector，且 MUST 不重复请求 embedding

#### Scenario: Cache loss does not alter canonical sources

- **WHEN** ProjectContext cache 丢失、损坏或被 prune
- **THEN** 后续 query 或 index MUST 从当前有效 layer/source 安全重建 derived state，且 MUST 不修改 LocalStore 或项目 Pack 文件
