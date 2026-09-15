## MODIFIED Requirements

### Requirement: Query mode and input validation

`lore query <text>` SHALL 默认执行 semantic retrieval。调用方 MUST 使用 `--mode keyword` 明确选择 keyword retrieval；`--mode` 只能接受 `semantic` 或 `keyword`，`--top-k` 只能接受 1 至 50 的十进制正整数。semantic query 的用户级配置 `query.maxWaitMs` 和 `query.minCoveragePercent` MUST 分别为非负整数毫秒和 0 至 100 的整数百分比；未配置时默认分别为 `3000` 与 `0`。`--max-wait-ms` 和 `--min-coverage-percent` MUST 接受同样范围的十进制整数，并覆盖本次命令；`--require-complete` SHALL 等价于本次命令使用 `minCoveragePercent: 100`，且不得与 `--min-coverage-percent` 同时使用。命令 MUST 在连接 Backend 前验证 text、mode、top-k 与显式 options。

#### Scenario: Default semantic query

- **WHEN** 调用方执行未带 `--mode` 或 wait/coverage override 的有效 `lore query <text>`
- **THEN** CLI SHALL 选择 semantic retrieval，并使用用户级 `query.maxWaitMs` 和 `query.minCoveragePercent`；它不得把 semantic retrieval 降级为 keyword retrieval

#### Scenario: A caller overrides the wait budget in milliseconds

- **WHEN** 调用方执行 `lore query <text> --max-wait-ms 5000 --min-coverage-percent 80`
- **THEN** 本次 semantic query MUST 最多前台观察 `5000` 毫秒，并且只有当前可安全查询 Practice 覆盖至少 80% 时才能返回 partial result

#### Scenario: Invalid input avoids Backend work

- **WHEN** text 为空白、`--mode` 非法、`--top-k` 不在允许范围、毫秒/百分比 option 非法，或 `--require-complete` 与 `--min-coverage-percent` 同时出现
- **THEN** 命令 MUST 返回 `usage.invalid`，且 MUST 不连接 Backend

### Requirement: Explicit offline keyword retrieval

`--mode keyword` SHALL 直接通过 Engine 查询 selected ProjectContext 的派生 keyword index；未发现或禁用项目时，该 context 仅由 selected LocalStore 构成。该路径 MUST 不启动或连接 Backend、MUST 不加载模型，并且 MUST 不访问网络。keyword index 损坏、缺失或无法安全复用时，系统 MUST 从同一已验证 context snapshot 重建它；canonical Store/局部 Pack source 仍然是返回摘要的事实来源。

#### Scenario: Keyword query without a model

- **WHEN** Backend 未启动且本地模型缺失时，调用方执行有效的 `lore query <text> --mode keyword`
- **THEN** 命令 MUST 只执行 keyword retrieval，且 MUST 不触发模型准备或网络传输

#### Scenario: Keyword query includes a local winner

- **WHEN** 当前 ProjectContext 有 active 局部 Practice 覆盖 selected Store 的同 ID Practice
- **THEN** keyword results MUST 仅从 context winner 取得候选与摘要，且不得索引被 shadowed source

### Requirement: Semantic retrieval uses a safe Store-scoped index

semantic retrieval SHALL 以 selected query context 和固定 embedding Profile 为边界：未发现或禁用 ProjectContext 时，该 context 是 selected LocalStore；有效项目 context 存在时，它包含所有继承 layer resolver 选择的 current winners。查询 MUST 优先使用与 current snapshot 完全匹配的 complete semantic index。完整 index 缺失、落后、损坏或不兼容时，系统 MUST 提交或加入该 context target 的持久 index operation，而不是返回要求用户预先执行 index 的 `semantic.index-not-ready`。在 `maxWaitMs` 总预算内，系统 MUST 观察该 operation 的模型准备和增量进度。

预算结束时，系统 MAY 只从 current target 的已验证 vector rows 查询；每个 row MUST 同时匹配 current Practice ID、content digest、semantic projection digest、Profile 与编码约束。被删除、改变、被其他 winner 替换或不再属于 current snapshot 的 Practice MUST 不参与结果。它 MUST 不以 Store-only、旧 ProjectContext、keyword retrieval 或无法证明兼容的 vector 代替 current target。

#### Scenario: Missing or unsafe index

- **WHEN** `--no-project` 下 selected Store 没有 complete semantic index，或现有 index 与 current Store/Profile 的关系无法安全证明
- **THEN** semantic query MUST 提交或加入该 Store snapshot 的 index operation，并在 `maxWaitMs` 内观察 current progress；它不得要求调用方先单独执行 `lore index build`

#### Scenario: Partial coverage includes completed current rows

- **WHEN** current target 有 100 条可索引 Practice，观察预算结束时其中 50 条已在 progress 中完成并通过 vector 校验
- **THEN** 查询 MUST 只在这 50 条中进行 semantic retrieval，并返回 `coverage: "partial"`、`indexedPracticeCount: 50`、`totalPracticeCount: 100` 与 operation detail

#### Scenario: Partial coverage excludes changed Practices

- **WHEN** 某 Practice 在 progress row 写入后改变了内容、projection 或 winner，且新的 current target 尚未完成该 Practice
- **THEN** semantic retrieval MUST 排除该旧 row，且不得把它作为当前 Practice 的结果返回

#### Scenario: No eligible vector

- **WHEN** current target 没有已验证 vector，或已验证 vector 覆盖未达到 caller 的 `minCoveragePercent`
- **THEN** 命令 MUST 返回 `data.state: "indexing"` 与 operation detail，且 MUST 不伪造空的成功检索结果或请求 query embedding

### Requirement: Query result and preparing semantics

成功的 semantic 或 keyword query SHALL 在 stdout 输出 JSON protocol envelope，其中 results 只包含 Practice summary，不包含完整正文或内部 score；调用方 MUST 使用 `lore get <practice-id>` 读取 current context 的 canonical Practice。complete result 与满足 caller coverage policy 的 partial result MUST 以 exit code 0 结束。semantic partial result MUST 包含 `coverage: "partial"`、`indexedPracticeCount`、`totalPracticeCount` 和 non-terminal operation detail；complete semantic result MUST 包含 `coverage: "complete"` 且 indexed/total counts 相等。

`maxWaitMs` 从 semantic query 完成输入校验后开始，并包含 Backend 启动、共享模型准备、operation joining 与 progress 观察；预算耗尽 MUST 不取消 daemon operation。若 fixed model 的准备仍未完成，命令 MUST 输出 `data.state: "preparing"`、preparationId 和恢复提示，并以 exit code 1 结束。若没有满足 coverage policy 的 queryable progress，命令 MUST 输出 `data.state: "indexing"`、operationId、当前 indexed/total counts 和恢复提示，并以 exit code 1 结束。两种 pending 状态都 MUST 不伪造检索结果。失败 MUST 使用 `ok: false` 的 error envelope 并以 exit code 2 结束。

#### Scenario: A complete target finishes within the wait budget

- **WHEN** current target 的 complete semantic index 在 `maxWaitMs` 结束前发布
- **THEN** 命令 SHALL 返回 `coverage: "complete"` 的 semantic results，exit code MUST 为 0

#### Scenario: Query returns a usable partial result while indexing continues

- **WHEN** current progress 在 `maxWaitMs` 结束时达到 caller 的 coverage policy 但尚未 complete
- **THEN** 命令 SHALL 返回 semantic partial results、indexed/total counts 和 operation detail，exit code MUST 为 0，且 daemon operation MUST 继续

#### Scenario: Strict caller declines partial coverage

- **WHEN** 调用方使用 `--require-complete`，而 current progress 尚未 complete
- **THEN** 命令 MUST 返回 `data.state: "indexing"` 而不返回 partial results，exit code MUST 为 1

#### Scenario: Model preparation remains pending

- **WHEN** fixed model 的准备在 `maxWaitMs` 内未完成
- **THEN** 命令 SHALL 输出唯一的 preparing JSON envelope，exit code MUST 为 1，调用方可通过 `lore model status` 后重试

#### Scenario: Ready result is bounded and canonical

- **WHEN** semantic 或 keyword retrieval 成功完成
- **THEN** results MUST 至多包含请求的 top-k 个 summary，且每个 summary MUST 来自同一已验证 current query context snapshot 的 canonical Practice

## ADDED Requirements

### Requirement: ProjectContext semantic readiness

当有效 ProjectContext 存在时，semantic retrieval SHALL 使用与该 context 的 index corpus 和固定 embedding Profile 完全匹配的 complete artifact 或 exact progress target。artifact 未 ready 时，命令 MUST 提交或加入该 context target 的持久 operation；它只能在 current context 已验证 progress 达到 caller coverage policy 时返回 partial result。它 MUST 不以排除任意继承 layer active Practice 的不明 coverage、Store-only result 或 keyword result 代替该 context。

#### Scenario: Local edit produces a safely partial current query

- **WHEN** 有效 child layer Practice 改变，当前 ProjectContext 的 progress 已完成其他 50 条 Practice，但尚未完成该变更 Practice
- **THEN** semantic query MAY 返回只检索已完成 current rows 的 partial result，并 MUST 报告 `50 / total` coverage；它不得把变更前 Practice 作为当前 winner 返回

#### Scenario: Equivalent artifact is already ready

- **WHEN** 任意其他 ProjectContext 已发布当前语料的精确 semantic artifact
- **THEN** semantic query MUST 使用该 artifact 并返回 complete coverage，且不得创建重复 operation
