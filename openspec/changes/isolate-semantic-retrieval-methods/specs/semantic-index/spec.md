## ADDED Requirements

### Requirement: Semantic indexes are isolated by retrieval method

semantic index 的兼容身份 MUST 包含所选向量检索方法及其文档、query 和评分配方身份，并与编码约束和当前语料绑定。相同 Store/ProjectContext 和模型下，`single-vector` 与 `multi-view-vector` 的完整索引、进度、目标身份及向量缓存 MUST 不被当作彼此可用。向量及编码输入 MUST 只属于方法派生的索引表示，不得作为 canonical Practice 的必需属性；canonical Pack 和项目 Practice MUST 不因方法切换而迁移或丢失。

#### Scenario: A ready artifact cannot satisfy another method
- **WHEN** 同一语料仅有 ready 的 multi-view-vector index，用户切换为 single-vector
- **THEN** single-vector 的 status MUST 不因该 multi-view-vector index 而报告 ready，single-vector query/build MUST 使用自己的兼容派生数据

#### Scenario: Equivalent same-method artifacts remain reusable
- **WHEN** 相同语料、方法配方及编码约束的 artifact 已完整发布
- **THEN** 同方法的普通 build MUST 复用该 artifact，不重复请求 document embedding

#### Scenario: Incompatible existing profiles require rebuilding
- **WHEN** 所选方法只有未绑定当前方法配方或 schema 不兼容的旧派生索引
- **THEN** 系统 MUST 不将其当作当前 ready index，后续构建 MUST 使用当前方法建立新索引，而不是要求用户删除 canonical 内容或重新安装 Pack

#### Scenario: A stable input address does not make changed content reusable
- **WHEN** 同一 Practice 的编码单元地址未变，但其文本或所属表示类别已经改变
- **THEN** 构建 MUST 依据当前配方与编码输入摘要重新判断向量复用，MUST 不仅凭该地址继续使用旧向量；相同地址出现在另一条 Practice 中也 MUST 不导致串用内容

#### Scenario: Index representations remain derived from canonical content
- **WHEN** 用户在同一 canonical Practice 上切换向量方法或执行 keyword 查询
- **THEN** 系统 MUST 保持 canonical Practice 内容与 schema 不变，MUST 不要求其中具有 views、编码输入或向量字段；keyword 查询 MUST 不因此请求 embedding

### Requirement: Semantic query and index commands select the same method

普通 CLI semantic query、index status/build/rebuild 及 Pack 安装后的语义索引同步 SHALL 使用同一用户级 `query.retrievalMethod` 选择规则，缺省为 `single-vector`。query 显式指定 `--mode multi-view-vector` 时 MUST 为本次请求及其自动构建选择实验方法的 Profile 和索引，不改变后续 index 命令或安装同步的配置选择。直接 Backend index target 请求的可选 `retrievalMethod` SHALL 采用同样的两个合法方法 ID，省略时 MUST 为 `single-vector`，旧规划名称不作为别名。status MUST 观察所选方法，build/rebuild MUST 构建所选方法，operation ID 查询 MUST 继续指向创建时的目标，不受之后配置影响。

#### Scenario: Status and build follow an experimental selection
- **WHEN** 用户配置 multi-view-vector，随后执行 index status 和 index build
- **THEN** 两次操作 MUST 针对 multi-view-vector 的派生索引，而不是默认 single-vector 的索引

#### Scenario: Installation sync uses the configured method
- **WHEN** Pack canonical 安装成功且配置选择 multi-view-vector
- **THEN** 安装后的 index sync MUST 对 multi-view-vector 提交普通构建；该同步失败 MUST 不撤销已经成功的 Pack commit

#### Scenario: Invalid method does not hide a successful installation
- **WHEN** Pack canonical 安装成功，但后续 index sync 发现非法方法配置
- **THEN** 安装 MUST 保持成功，并通过既有 indexSync failure 报告同步失败；用户修复配置后 SHALL 能显式 build，无需重新安装 Pack

#### Scenario: Index method errors have the existing boundary semantics
- **WHEN** CLI index status/build/rebuild 遇到非法方法配置，或 Backend index 请求携带非法方法
- **THEN** CLI MUST 在连接 Backend 前返回 `query.config-invalid`，Backend 请求 MUST 返回 `usage.invalid`；系统 MUST 不暗中选择另一方法

### Requirement: Retrieval methods share consistency without sharing mutable selection

每个已经接受的 semantic operation MUST 固定其方法、Profile 和语料目标。不同方法 MUST 共用已有模型资源及调度约束，但不得仅因方法配置变化互相取消、覆盖 progress 或 supersede。构建的增量复用、staging 校验、snapshot fence、原子发布和失败保留既有可用索引的规则 MUST 对两种方法保持一致。

#### Scenario: Two methods are requested in one daemon
- **WHEN** 同一 daemon 中多视角构建尚未结束，又接受同语料的简易方法请求
- **THEN** 两者 MUST 保持各自的方法和索引身份，并按既有调度约束执行；新请求 MUST 不把旧任务的投影或 Profile 切换为 single-vector

#### Scenario: A failed build cannot publish a mixed-method index
- **WHEN** 任一方法构建在 embedding、staging 校验或发布前失败
- **THEN** 未完成派生数据 MUST 不报告 ready，已有完整索引 MUST 保留，且 MUST 不从另一方法拼接向量伪造完成

#### Scenario: Partial coverage counts complete current Practices
- **WHEN** 多视角方法的某条 Practice 仅完成部分必要编码输入的向量，而单向量方法已有该 Practice 的向量
- **THEN** 多视角 partial coverage MUST 不把该 Practice 计为完成，也 MUST 不借用简易向量补齐

### Requirement: Corpus identity does not depend on a semantic method

Store/ProjectContext 的通用语料身份与 keyword artifact 复用 MUST 不依赖某一种 semantic 文档投影。仅改变 semantic 方法或其配方、而 canonical 内容和 keyword 规则未变时，keyword 查询结果及其可复用派生数据 MUST 不因该方法切换失效。一次版本化语料摘要迁移造成的旧缓存重建不改变这一稳定边界。

#### Scenario: Switching semantic methods leaves keyword retrieval unchanged
- **WHEN** 同一 canonical 语料已建立当前版本 keyword index，用户只切换 semantic 方法
- **THEN** keyword 查询 MUST 保持相同的语料与排序语义，且 MUST 不因该切换重新构建 keyword index
