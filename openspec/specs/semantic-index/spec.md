# semantic-index Specification

## Purpose
为每个 LocalStore 维护可重建、可恢复的 semantic index，使 semantic retrieval 能基于固定 Profile 安全读取派生向量，同时不把索引或后台任务误当成 Pack 内容的事实来源。

## Requirements

### Requirement: Store-scoped derived index status
semantic index SHALL 绑定 selected query context 和固定 embedding Profile；没有有效项目时，该 context 是 selected LocalStore。`--store-root` MUST 只选择 Store 基础语料，`--cache-root` MUST 只选择用户级 derived cache；两者均不得选择模型、模型缓存、Backend 地址或 runtime。canonical Store/局部 Pack source MUST 保持唯一内容事实来源。`lore index status` SHALL 只读取当前 context 的 complete index metadata 和持久 progress metadata，且 MUST 不启动 Backend、下载模型或构建 index。

index status MUST 在没有 complete index 时区分 `missing`、`indexing`、`stale` 与 `incompatible`；`indexing` MUST 返回当前 target 的 `indexedPracticeCount`、`totalPracticeCount`、operation ID 与非终态。ready index 仍必须表示完整 current context，而不得把 partial progress 标为 ready。

#### Scenario: Read-only status
- **WHEN** 调用方以 `--no-project` 对一个正在增量构建的 Store 执行 `lore index status`
- **THEN** 命令 MUST 返回 `indexing`、已完成/总 Practice counts 与 operation ID，且 MUST 不启动模型工作

#### Scenario: Read-only ProjectContext status
- **WHEN** 调用方在有效 ProjectContext 中执行 `lore index status`
- **THEN** 命令 MUST 返回该 context 的 keyword/semantic complete 或 progress 状态，且 MUST 不启动模型工作

### Requirement: Build and rebuild preserve consistency
`lore index build` MUST 在 complete index 已与当前 query context 和 Profile 一致时避免重复编码。Store 发生连续变更时，build SHALL 仅重新编码新增或 semantic projection 改变的 Practice；ProjectContext SHALL 复用相同最终语料的 artifact 与相同 projection 的 vector。删除、shadowed、ignored 或仅 metadata 改变的记录 MUST 不要求 embedding。历史缺失、index 不兼容、artifact 损坏或安全复用不能证明时，build MUST 从完整 current context snapshot 构建。`lore index rebuild` MUST 强制完整构建当前 target。所有构建 MUST 保留此前 ready index，并在完整 target 通过 manifest、vector、row count 与 integrity 校验后原子发布 complete index；失败 MUST 不把未完成 index 标记为 ready。

在完整 publish 前，build MUST 建立或恢复与当前 target digest 精确匹配的持久 progress index。它 MUST 按批次事务写入已验证 vector rows 及 ready count；这些 rows 可以被 semantic query 作为 partial coverage 使用，但只有其 Practice ID、content digest、projection digest、Profile 和编码仍与 current snapshot 匹配时才可见。每批完成的 vector SHALL 同时进入用户级可复用 vector cache；一个新 target 可以复用其中兼容 rows，但不得把不同 Profile 或不同 projection 视为可复用。

#### Scenario: Ready index is a no-op
- **WHEN** `lore index build` 发现 complete index 已完整覆盖当前 context 且 Profile 兼容
- **THEN** 命令 SHALL 返回 ready index，且 MUST 不请求 document embedding

#### Scenario: Incremental update
- **WHEN** Store 的连续 revision history 可以安全覆盖 active index 之后的变更，且本次目标有 20 条需要 embedding
- **THEN** build SHALL 仅编码这 20 条；每个已提交 batch MUST 增加 current progress coverage，而完整 target 仍只在全部 20 条完成后原子发布

#### Scenario: Equivalent ProjectContext artifact is reused
- **WHEN** 任意其他 ProjectContext 已发布相同 index kind/version、active Practice 语料与 Profile 的 complete semantic artifact
- **THEN** build MUST 复用该 artifact，且 MUST 不请求 document embedding

#### Scenario: Changed source never leaks through progress
- **WHEN** progress build 期间 target snapshot 改变
- **THEN** 旧 target 的后续 batch MUST 停止写入；只有同时匹配新 target manifest 的已完成 vector 才能被新 target 复用，且旧 progress MUST 不作为新 query 的候选来源

#### Scenario: Failed replacement leaves current index usable
- **WHEN** full 或 incremental 构建在 progress、embedding 或完整发布前失败
- **THEN** 系统 MUST 不把未完成 index 标记为 ready，且此前 ready artifact 或 active Store index MUST 保留

### Requirement: Legacy baseline invalidates derived indexes
当 LocalStore 完成 legacy canonical projection baseline recovery 时，任何基于旧 projection 的 keyword 或 semantic derived index MUST 被丢弃，不得继续报告为可安全使用。后续 keyword 或 semantic index 操作 MUST 从 recovered Store snapshot 重建；semantic index 的 staging validation、snapshot fence 和 atomic publication 仍适用，且 canonical Pack commit MUST 不因 derived-index 重建失败而回滚。

#### Scenario: Semantic index is not reused after a legacy baseline reset
- **WHEN** Store 在 legacy baseline recovery 前存在 active semantic index
- **THEN** recovery 完成后该 index MUST 不再被视为 ready，且后续 build MUST 以 recovered Store snapshot 建立新的 index

### Requirement: Pack installation does not depend on derived index success
`lore pack install` MUST 先完成 canonical Pack commit，再对同一 Store 提交普通 semantic index build。安装结果 SHALL 在 `indexSync` 中报告 `ready`、`pending` 或 `failed`；`pending` MUST 含可读取的 operation ID。派生 index 的准备、失败或取消 MUST 不回滚已成功提交的 Pack。

#### Scenario: Installation returns while index is preparing
- **WHEN** Pack 已完成 canonical commit，而其 index build 正在准备模型或构建
- **THEN** install MUST 成功返回 Pack 结果及 `indexSync.state: "pending"`，并保留可查询的 operation ID

### Requirement: Persistent target index operations and queryable progress
`lore index build` 和 `lore index rebuild` SHALL 向 Backend 提交 daemon-owned、持久且可恢复的 target operation。target MUST 表示 Store-only 或 ProjectContext 的一个完整 current snapshot、固定 Profile 和安全的 opaque identity；持久 task state MUST 不保存 Practice body 或 project absolute path。CLI 只在调用方的前台观察预算内读取结果；ready 可直接返回，仍在执行的 operation MUST 返回 `waiting-for-source`、`preparing`、`queued` 或 `building`、operation ID 与 indexed/total counts，已确认失败 MUST 返回 error envelope。CLI 中断不得取消它。

同一 Store target 或 project root target 的连续请求 MUST 合并为最新 current corpus；相同 artifact target 的请求 MUST 加入同一 operation；不同 target MUST 排队而不得向正常调用方返回 transient `backend.busy`。progress 的每个已提交 batch MUST 在重启后保持可验证、可查询或可安全丢弃的状态；cache prune MUST 不删除被 active operation 或 progress query 使用的内容。Backend 重启后，未完成 ProjectContext target MUST 保留 progress 并进入 `waiting-for-source`；后续从具有相同 projectRootId 的目录执行 query/build/rebuild 时 MUST reattach 并继续，而 Backend MUST 不扫描任意目录或持久化 project path 以自动定位它。

#### Scenario: Model preparation continues the accepted operation
- **WHEN** 已接受的 index operation 首次需要 embedding 而固定模型尚未 ready
- **THEN** Backend SHALL 将同一 operation 标记为 preparing，完成模型准备后重新执行该 operation，而前台观察预算结束时 MUST 返回该 operation 的 pending 状态

#### Scenario: High-frequency directory edits coalesce to the latest target
- **WHEN** 同一 ProjectContext 目录在 semantic build 期间连续产生多个 index corpus
- **THEN** 系统 MUST 只追赶该 directory target 的最新 corpus，且不得为每次编辑保留独立的待执行 operation

#### Scenario: Distinct targets are queued rather than rejected
- **WHEN** 一个 Store 或 ProjectContext target operation 正在运行，另一个不同 target 请求 build 或 rebuild
- **THEN** 第二个请求 MUST 获得可观察的排队 operation，且 MUST 不返回 `backend.busy`

#### Scenario: A daemon restart waits safely for ProjectContext reattach
- **WHEN** daemon 在一个 ProjectContext target 已提交 50 条 progress vectors、但尚未完成时退出
- **THEN** 重启后的 operation MUST 校验这 50 条并进入 `waiting-for-source`；下一次从相同 projectRootId 调用 query 或 index 时 MUST 继续缺失 rows，且不得把未校验或不匹配 current target 的 row 计入 coverage

### Requirement: Terminal operation failures retain a stable public classification
daemon-owned semantic operation 进入 `failed` 终态时，Backend MUST 持久化并通过 `lore index operation <id>` 返回允许公开的稳定错误码。模型准备或 embedding 失败 MUST 保留原始 `embedding.*` code；Store busy/recovery failure MUST 保留既有 Store code；其他未分类失败 MUST 返回 `backend.failed`。终态 failure MUST 不被重新表示为 `waiting-for-source`、`queued`、`preparing` 或 `building`，不得泄露异常文本、绝对路径、模型下载来源、Practice 内容、凭据或 runtime identity。失败不得把未完成 artifact 标为 ready，且此前 ready artifact 的保留语义不变。

#### Scenario: Operation lookup exposes model preparation failure
- **WHEN** 一个已接受 operation 因 `embedding.resource-invalid` 进入 `failed`
- **THEN** `lore index operation <id>` MUST 返回该 operation 的 `failed` 状态与 `error: "embedding.resource-invalid"`，调用 CLI MUST 以 error envelope 和 exit code `2` 表示该终态

#### Scenario: Legacy failure record remains safely recoverable
- **WHEN** Backend 读取一个未记录公开错误码的既有 `failed` operation record
- **THEN** Backend MUST 将其作为 `backend.failed` 返回，而不得把它重新当作 pending work 或拒绝读取整个 journal

### Requirement: Project index discovery excludes the selected Store root
当 `lore index` 自动选择 ProjectContext target 时，系统 MUST 将 selected LocalStore root 作为 discovery 保留边界。Store root 及其上层祖先不得被解析为 project layer；位于该边界以下的有效项目 layer 仍 MUST 保持现有的 parent-to-child inheritance、cache 与 operation 行为。显式 `--project-root` 指向 selected Store root MUST 使用既有 invalid-project-root usage error，而不得创建 project semantic target 或后台 operation。

#### Scenario: Store-only index does not create a degraded project target
- **WHEN** 调用方从 selected Store root 的子目录自动运行 index，且不存在边界以下的有效项目 layer
- **THEN** 命令 MUST 使用 Store target，且不得从 Store root 的 config 或 Pack artifact 创建 degraded ProjectContext target

#### Scenario: Ordinary directory without a marker uses Store target
- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** index MUST 使用 Store target，不得创建 ProjectContext target、project-derived cache 或 context diagnostic
