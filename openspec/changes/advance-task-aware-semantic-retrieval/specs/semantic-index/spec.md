# Spec Delta

> 多视角表示与兼容规则写在 requirement 内，并只在选择 `multi-view-vector` 时适用；当前 encoding-input schema/version 见 [持久化维护说明](../../../../../docs/development/persistence.md#semantic-encoding-input-schema)。


## MODIFIED Requirements

### Requirement: Build and rebuild preserve consistency

`lore index build` MUST 在 complete index 已与当前 query context 和 Profile 一致时避免重复编码。Store 发生连续变更时，build SHALL 仅重新编码新增或 semantic projection 改变的 Practice；ProjectContext SHALL 复用相同最终语料的 artifact 与相同 projection 的 vector。删除、shadowed、ignored 或仅 metadata 改变的记录 MUST 不要求 embedding。历史缺失、index 不兼容、artifact 损坏或安全复用不能证明时，build MUST 从完整 current context snapshot 构建。`lore index rebuild` MUST 强制完整构建当前 target。所有构建 MUST 保留此前 ready index，并在完整 target 通过 manifest、vector、row count 与 integrity 校验后原子发布 complete index；失败 MUST 不把未完成 index 标记为 ready。

在完整 publish 前，build MUST 建立或恢复与当前 target digest 精确匹配的持久 progress index。它 MUST 按批次事务写入已验证 vector rows 及 ready count；这些 rows 可以被 semantic query 作为 partial coverage 使用，但只有其 Practice ID、content digest、projection digest、Profile 和编码仍与 current snapshot 匹配时才可见。每批完成的 vector SHALL 同时进入用户级可复用 vector cache；一个新 target 可以复用其中兼容 rows，但不得把不同 Profile 或不同 projection 视为可复用。

上述重新编码与复用规则同时适用于 `single-vector` 与 `multi-view-vector`。当所用方法为 `multi-view-vector` 时，增量单位是 view：未变化的 `full`、`task-card` 或 `body` views MAY 复用已验证 digest 的向量；多视角表示、表示组划分、分块配方、view 身份或兼容规则发生变化时，该方法与 encoding 绑定的 embedding Profile MUST 使其旧 index 不再被视为兼容，并按上述完整构建与校验规则建立完整且内部一致的新表示。这些多视角规则 MUST NOT 施加于默认 `single-vector`，其兼容性 MUST NOT 以缺少多视角 views 为由被否定，且该失效 MUST NOT 使 `single-vector` 的 index 失效或触发方法切换；两种方法的 Profile、artifact、progress 与 cache MUST 相互隔离。

#### Scenario: Ready index is a no-op

- **WHEN** `lore index build` 发现 complete index 已完整覆盖当前 context 且 Profile 兼容
- **THEN** 命令 SHALL 返回 ready index，且 MUST 不请求 document embedding

#### Scenario: Incremental update

- **WHEN** Store 的连续 revision history 可以安全覆盖 active index 之后的变更，且本次目标有 20 条需要 embedding
- **THEN** build SHALL 仅编码这 20 条；每个已提交 batch MUST 增加 current progress coverage，而完整 target 仍只在全部 20 条完成后原子发布

#### Scenario: Multi-view incremental update reuses unchanged views

- **WHEN** 本次请求选择 `multi-view-vector`，且连续 revision history 可以安全覆盖变更
- **THEN** build SHALL 只编码改变的内容视角，未变化 view 复用已验证 digest 的向量，并原子发布更新后的 index

#### Scenario: Equivalent ProjectContext artifact is reused

- **WHEN** 任意其他 ProjectContext 已发布相同 index kind/version、active Practice 语料与 Profile 的 complete semantic artifact
- **THEN** build MUST 复用该 artifact，且 MUST 不请求 document embedding

#### Scenario: Changed source never leaks through progress

- **WHEN** progress build 期间 target snapshot 改变
- **THEN** 旧 target 的后续 batch MUST 停止写入；只有同时匹配新 target manifest 的已完成 vector 才能被新 target 复用，且旧 progress MUST 不作为新 query 的候选来源

#### Scenario: Multi-view representation invalidates an older index

- **WHEN** 本次请求选择 `multi-view-vector`，而其待复用 index 基于单全文向量、旧 view 种类（如 `applicability`/`topic`/`guidance`）或不包含当前 view recipe 的旧 Profile 建立
- **THEN** 系统 MUST 不将其报告为 compatible ready，并且后续 build MUST 通过完整、一致的当前 Profile 表示原子发布新 index；该判定 MUST NOT 使 `single-vector` 的 index 失效或触发方法自动切换

#### Scenario: Failed replacement leaves current index usable

- **WHEN** full 或 incremental 构建在 progress、embedding 或完整发布前失败
- **THEN** 系统 MUST 不把未完成 index 标记为 ready，且此前 ready artifact 或 active Store index MUST 保留
