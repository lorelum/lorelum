## ADDED Requirements

### Requirement: Successful empty queries provide an evidence-bounded explanation

ready 且 `results: []` 的 query SHALL 保持 exit `0` 及原字段，增加 `empty: {reason, nextAction, message}`。`reason` MUST 为 `empty` 或 `corpus-empty`；只有同一本次完整 canonical snapshot 证明可检索 Practice 为零时才使用后者，否则 MUST 使用前者。空候选或空结果本身不得证明空 corpus，也不得据此猜测语义失败、无匹配、未安装 Pack 或 query 写错。

`nextAction` MUST 为 `refine-query`，建议补充决策、约束及技术上下文后改写一次，不表示 CLI 自动执行。空 corpus 的 message MUST 明确当前 context 没有可检索 Practice，且改写不会增加 Practice。Harness MUST 不解析 message 获取机器语义。

#### Scenario: Proven empty corpus

- **WHEN** complete semantic query 的完整当前 corpus 已证明为零
- **THEN** 输出 MUST 保留 mode/coverage，使用 `corpus-empty`，说明查询成功而非 semantic 失败

#### Scenario: Keyword miss without corpus evidence

- **WHEN** keyword query 仅取得空候选，没有完整 corpus 为空的证据
- **THEN** 输出 MUST 使用 `empty` 和 `refine-query`，不猜知识源缺失

#### Scenario: Partial empty preserves its limits

- **WHEN** ready 空结果为 partial，且没有更具体证明
- **THEN** 输出 MUST 使用 `empty`，保留原 coverage、已有 counts/operation，不称为 complete no-match或断言全部向量被排除

### Requirement: Empty text is concise and does not trigger extra work

default text SHALL 先用一小段说明查询成功但没有返回 Practice，再显示 mode、semantic coverage 与适用的原 counts，最后提供首选建议。存在 degraded context 或 warnings 时 MUST 说明来源限制并保留同一份原 warnings。`--verbose` MUST 保留完整 data 与说明，JSON MUST 不受 text 视图影响。

生成 explanation MUST 不增加状态调用、模式 fallback、全库扫描或 embedding；非空 ready、pending、terminal error MUST 不加 `empty`，并保持原输出及 exit code。

#### Scenario: Degraded empty result

- **WHEN** ready 空结果携带 degraded context 或 warnings
- **THEN** 段落 MUST 引用来源限制，原 warnings MUST 保留，不另建冲突状态

#### Scenario: Other query outcomes stay unchanged

- **WHEN** query 返回非空 ready、pending 或 error（包括非空 target 的零 eligible progress）
- **THEN** 输出与退出码 MUST 不变，不增加 explanation、诊断调用或另一模式的查询
