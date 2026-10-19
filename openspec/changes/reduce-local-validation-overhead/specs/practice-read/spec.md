## MODIFIED Requirements

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
