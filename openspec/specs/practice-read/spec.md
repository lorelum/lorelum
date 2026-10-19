# practice-read Specification

## Purpose
为 `lore get` 和 keyword retrieval 提供一致、可恢复的 LocalStore canonical Practice 读取合同，使调用方不会读取混合快照、损坏内容或与目标无关的全库数据。

## Requirements

### Requirement: Canonical point read
`lore get <practice-id>` SHALL 通过 Engine 从 selected ProjectContext 读取一个完整 canonical Practice；未发现或禁用项目时，该 context 仅由 selected LocalStore 构成。非法 ID MUST 在 Store 或项目 source I/O 前失败；合法但不存在的 ID SHALL 返回明确的缺失结果。已提交 Store 的 canonical 内容、contentDigest 和来源 SHALL 由提交时的验证确定；正常读取 MUST 保留目标 JSON/结构、ID、来源与当前 winner 自洽检查，但 MUST 不重新计算整个 Pack artifact 摘要或验证整个 Pack projection。项目 source 仍 MUST 在外部输入边界验证。绕过 LocalStore API 的任意内容篡改不属于正常 point read 的逐次审计保证。

#### Scenario: Missing or invalid Practice ID
- **WHEN** 调用方请求非法 Practice ID 或当前 context 中合法但不存在的 ID
- **THEN** 非法 ID MUST 在打开 Store 或项目 source 前返回 usage error，而合法缺失 ID MUST 返回可区分的缺失结果

#### Scenario: Local winner is returned by get
- **WHEN** active 局部 Practice 覆盖 selected Store 的同 ID Practice
- **THEN** lore get MUST 返回局部 winner 及其 provenance，而不得返回 Store 旧内容

#### Scenario: One Practice is read from a large installed Pack
- **WHEN** 调用方读取已提交 Pack 中一个 Practice，并需要其 packRoot
- **THEN** get SHALL 从一致快照返回目标 canonical 内容和来源 locator，MUST 不读取同 Pack 的其他 Practice 或资源来做完整性审计

### Requirement: Consistent and bounded read
point read 与 query MUST 从一致的 ProjectContext snapshot 读取 canonical 数据。Store publication recovery、活跃 writer、重复 Store snapshot 变化或 context layer source 在读取期间改变时，系统 MUST 安全收敛或返回恢复/忙碌语义，而不得混合前后状态。读取一个目标 Practice MUST 不进行全库或所属 Pack 的全量 audit。current locator 缺失或落后 SHALL 由 active manifest 收敛；非链接对象占位 MUST 不被覆盖。完整 Store open/reindex SHALL 保留所属的 artifact、projection 与 canonical 对账。

#### Scenario: Interrupted publication during get
- **WHEN** point read 遇到可恢复的中断 Store manifest publication 或活跃 journal writer
- **THEN** 系统 MUST 先安全收敛或等待，并在不能获得一致 snapshot 时返回显式 Store error，而不得返回半状态 Practice

#### Scenario: Local file changes before a result is assembled
- **WHEN** ProjectContext 在 get 读取后、返回前发现 layer source 已改变或失效
- **THEN** 系统 MUST 放弃旧 snapshot 并重新解析或返回可区分的恢复状态，且不得将旧 source 伪装为当前 winner

#### Scenario: Locator repair does not replace user objects
- **WHEN** get 发现 current locator 落后或缺失，或其位置被非链接对象占用
- **THEN** 可恢复链接 SHALL 根据 active manifest 修复；非链接占位 MUST 返回既有恢复错误而不删除用户对象

#### Scenario: Full audit detects bypassed canonical changes
- **WHEN** 显式完整 Store 审计发现 artifact/projection 与已提交 canonical 行不一致
- **THEN** 审计 MUST 返回 recovery-required，且不得把普通读取信任已提交数据解释为取消完整恢复能力

### Requirement: Legacy canonical projection recovery
当 selected LocalStore 保留 legacy SQLite projection 而没有当前 migration baseline 时，Engine MUST 只从 active manifest 和每个已验证、sealed Pack artifact 重建 canonical projection。重建成功后，Store MUST 暴露与 manifest 一致的 Pack 和 canonical Practice，并以一个新的完整 refresh 取代旧的 pending revision state；损坏的旧 journal 不得阻止此 baseline recovery。manifest、artifact digest 或 sealed projection 无法验证时，Engine MUST 返回 recovery-required，且不得删除或部分重写 canonical Pack 内容。

#### Scenario: Valid legacy Store is rebuilt from authoritative artifacts
- **WHEN** legacy LocalStore 的 manifest 与所有 active Pack artifact 可以验证，而旧 journal 无法读取
- **THEN** Engine MUST 重建一致的 canonical projection，并继续返回 manifest 中的 Pack 与 Practice

#### Scenario: Missing artifact blocks destructive recovery
- **WHEN** legacy LocalStore 引用的 active Pack artifact 缺失或无法验证
- **THEN** Engine MUST 返回 recovery-required，且不得删除现有 Pack artifact 或以不完整 projection 替换 Store

### Requirement: Keyword query remains canonical-context-derived
keyword retrieval SHALL 在同一个 selected ProjectContext 的一致 snapshot 上建立或复用派生 index，并以 canonical Practice source 组装摘要。keyword query MUST 保持离线，MUST 不改变 LocalStore canonical 内容、局部 Pack 文件或 provenance，且 MUST 不将 index 作为正文事实来源。

#### Scenario: Context keyword index requires recovery
- **WHEN** ProjectContext keyword index 缺失、损坏或无法安全复用
- **THEN** 系统 MUST 从一致 context snapshot 重建派生 index，并 MUST 仍以当前 canonical winner 返回结果

### Requirement: Automatic point-read context excludes the selected Store root
`lore get` 的自动 ProjectContext discovery MUST 将 selected LocalStore root 视为保留边界。它不得把 Store 的 `.lorelum` 目录、全局 config 或 Pack artifact 解释为项目来源；若边界以下没有有效 project layer，point read MUST 使用 selected Store 的 canonical Practice。显式 `--project-root` 指向 selected Store root MUST 返回既有 invalid-project-root usage error，不得猜测或回退到其他 project root。

#### Scenario: Point read below a Store root has no synthetic project warning
- **WHEN** 调用方位于 selected Store root 的子目录且没有边界以下的有效 project layer
- **THEN** `lore get` MUST 从 selected Store 读取 canonical Practice，且不得附加由 Store root 产生的 ProjectContext degraded provenance

#### Scenario: Point read in an ordinary directory remains Store-only
- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** `lore get` MUST 从 selected Store 读取 canonical Practice，且不得创建或附加 ProjectContext provenance
