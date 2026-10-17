## MODIFIED Requirements

### Requirement: Canonical point read

`lore get <practice-id>` SHALL 通过 Engine 从 selected ProjectContext 读取一个完整 canonical Practice；未发现或禁用项目时，该 context 仅由 selected LocalStore 构成。非法 ID MUST 在 Store 或项目 source I/O 前失败；合法但不存在的 ID SHALL 返回明确的缺失结果；已返回 Practice MUST 通过 canonical 内容、digest 与当前 winner provenance 校验。

#### Scenario: Missing or invalid Practice ID

- **WHEN** 调用方请求非法 Practice ID 或当前 context 中合法但不存在的 ID
- **THEN** 非法 ID MUST 在打开 Store 或项目 source 前返回 usage error，而合法缺失 ID MUST 返回可区分的缺失结果

#### Scenario: Local winner is returned by get

- **WHEN** active 局部 Practice 覆盖 selected Store 的同 ID Practice
- **THEN** `lore get` MUST 返回局部 winner 及其安全 provenance，而不得返回 Store 旧内容

### Requirement: Consistent and bounded read

point read 与 query MUST 从一致的 ProjectContext snapshot 读取 canonical 数据。Store publication recovery、活跃 writer、重复 Store snapshot 变化或任意 context layer source 在读取期间改变时，系统 MUST 安全收敛或返回恢复/忙碌语义，而不得混合前后状态。读取一个目标 Practice MUST 不因无关 SQLite row、无关 Pack artifact 或无关局部 Pack 损坏而进行全库 audit。

#### Scenario: Interrupted publication during get

- **WHEN** point read 遇到可恢复的中断 Store manifest publication 或活跃 journal writer
- **THEN** 系统 MUST 先安全收敛或等待，并在不能获得一致 snapshot 时返回显式 Store error，而不得返回半状态 Practice

#### Scenario: Local file changes before a result is assembled

- **WHEN** ProjectContext 在 get 读取后、返回前发现任意 layer source 已改变或失效
- **THEN** 系统 MUST 放弃旧 snapshot 并重新解析或返回可区分的恢复状态，且不得将旧 source 伪装为当前 winner

## REMOVED Requirements

### Requirement: Keyword query remains Store-derived

**Reason**: keyword retrieval 现在以一致 ProjectContext 为候选语料，Store-only 只是没有项目 context 时的特例。

**Migration**: 调用方继续使用 `lore query --mode keyword`；需要强制旧 Store-only 行为时传入 `--no-project`。

## ADDED Requirements

### Requirement: Keyword query remains canonical-context-derived

keyword retrieval SHALL 在同一个 selected ProjectContext 的一致 snapshot 上建立或复用派生 index，并以 canonical Practice source 组装摘要。keyword query MUST 保持离线，MUST 不改变 LocalStore canonical 内容、局部 Pack 文件或 provenance，且 MUST 不将 index 作为正文事实来源。

#### Scenario: Context keyword index requires recovery

- **WHEN** ProjectContext keyword index 缺失、损坏或无法安全复用
- **THEN** 系统 MUST 从一致 context snapshot 重建派生 index，并 MUST 仍以当前 canonical winner 返回结果
