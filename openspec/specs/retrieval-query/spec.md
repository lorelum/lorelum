# retrieval-query Specification

## Purpose
为已安装 Practice 提供稳定、可机读的默认 semantic retrieval 与显式离线 keyword retrieval，使调用方能在不依赖过期设计文档的前提下选择、理解和恢复查询结果。

## Requirements

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
semantic retrieval SHALL 以 selected query context 和固定 embedding Profile 为边界：未发现或禁用 ProjectContext 时，该 context 是 selected LocalStore；有效项目 context 存在时，它包含所有继承 layer resolver 选择的 current winners。查询 MUST 优先使用与 current snapshot 完全匹配的 complete semantic index。完整 index 缺失、落后、损坏或不兼容时，系统 MUST 提交或加入该 context target 的持久 index operation，而不是返回要求用户预先执行 index 的 `semantic.index-not-ready`。CLI MUST 先安全完成本地 Backend 接入和 query 提交；Backend 接受请求后，系统 MUST 在 `maxWaitMs` 总预算内观察该 operation 的模型准备和增量进度。

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
成功的 semantic 或 keyword query SHALL 默认在 stdout 输出 Agent 可读 text；显式 `--json` SHALL 在 stdout 输出完整 JSON protocol envelope。results 只包含 Practice summary，不包含完整正文或内部 score；调用方 MUST 使用 `lore get <practice-id>` 读取 current context 的 canonical Practice。complete result 与满足 caller coverage policy 的 partial result MUST 以 exit code 0 结束。semantic partial result 的 data MUST 包含 `coverage: "partial"`、`indexedPracticeCount`、`totalPracticeCount` 和 non-terminal operation detail；complete semantic result 的 data MUST 包含 `coverage: "complete"` 且 indexed/total counts 相等。

`maxWaitMs` 是 Backend 接受 semantic query 后，观察共享模型准备、operation joining 与 progress 的非负整数毫秒预算；它不是本地 Backend 启动、连接、身份校验或一次 query 提交的 transport deadline。值为 `0` MUST 表示不额外等待模型或 progress：命令仍 MUST 安全提交或加入 operation，并返回可用的 complete result、`data.state: "preparing"` 或 `data.state: "indexing"`，而不得返回 `backend.deadline-exceeded`。预算耗尽 MUST 不取消 daemon operation。若 fixed model 的准备仍未完成，命令 MUST 返回可识别的 preparing 状态与恢复提示，并以 exit code 1 结束；JSON 中 MUST 包含 `data.state: "preparing"` 与 preparationId。若没有满足 coverage policy 的 queryable progress，命令 MUST 返回可识别的 indexing 状态、当前 indexed/total counts 与恢复提示，并以 exit code 1 结束；JSON 中 MUST 包含 `data.state: "indexing"` 与 operationId。两种 pending 状态都 MUST 不伪造检索结果。失败 MUST 以 exit code 2 结束；JSON 使用 `ok: false` 的 error envelope，默认 text 显示 code、message 及适用的 recovery。

#### Scenario: Zero observation budget remains usable
- **WHEN** 调用方执行有效 semantic query 并传入 `--max-wait-ms 0`
- **THEN** CLI MUST 允许本地 Backend 接入和 query 提交；若当前 target 未 ready，它 MUST 返回可观察的 `preparing` 或 `indexing` 状态，若当前 target 已 ready，它 MUST 返回 complete result，且不得将该合法预算映射为 `backend.deadline-exceeded`

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
- **THEN** 默认 text SHALL 明确显示 preparing 与恢复提示，`--json` SHALL 输出唯一的 preparing envelope，exit code MUST 为 1，调用方可通过 `lore model status` 后重试

#### Scenario: Ready result is bounded and canonical
- **WHEN** semantic 或 keyword retrieval 成功完成
- **THEN** results MUST 至多包含请求的 top-k 个 summary，且每个 summary MUST 来自同一已验证 current query context snapshot 的 canonical Practice；默认 text 与 JSON MUST 对应同一组结果

### Requirement: ProjectContext semantic readiness
当有效 ProjectContext 存在时，semantic retrieval SHALL 使用与该 context 的 index corpus 和固定 embedding Profile 完全匹配的 complete artifact 或 exact progress target。artifact 未 ready 时，命令 MUST 提交或加入该 context target 的持久 operation；它只能在 current context 已验证 progress 达到 caller coverage policy 时返回 partial result。它 MUST 不以排除任意继承 layer active Practice 的不明 coverage、Store-only result 或 keyword result 代替该 context。

#### Scenario: Local edit produces a safely partial current query
- **WHEN** 有效 child layer Practice 改变，当前 ProjectContext 的 progress 已完成其他 50 条 Practice，但尚未完成该变更 Practice
- **THEN** semantic query MAY 返回只检索已完成 current rows 的 partial result，并 MUST 报告 `50 / total` coverage；它不得把变更前 Practice 作为当前 winner 返回

#### Scenario: Equivalent artifact is already ready
- **WHEN** 任意其他 ProjectContext 已发布当前语料的精确 semantic artifact
- **THEN** semantic query MUST 使用该 artifact 并返回 complete coverage，且不得创建重复 operation

### Requirement: Terminal semantic operation failures are observable query errors
`data.state: "preparing"` 与 `data.state: "indexing"` SHALL 只表示已接受的 semantic operation 仍处于非终态且调用方尚未获得可用结果。若当前 query target 的 operation 已确认失败，`lore query` MUST 返回 `ok: false` 的 error envelope 并以 exit code `2` 结束，不得把失败伪装为 pending、空结果或 keyword result。若失败具有允许公开的稳定 `embedding.*`、`store.busy` 或 `store.recovery-required` code，query MUST 保留该 code；其他失败 MUST 使用 `backend.failed`。错误不得包含异常文本、路径、模型来源、Practice 正文、凭据或 runtime 身份数据。

#### Scenario: Model preparation failure is not reported as indexing
- **WHEN** 当前 target 的已接受 operation 因 `embedding.download-failed` 终态失败，且调用方在观察期内或随后查询时读取到该终态
- **THEN** `lore query` MUST 返回 `ok: false`、`error.code: "embedding.download-failed"` 与 exit code `2`，且不得输出 `data.state: "indexing"` 或 “Retry shortly” 的 pending message

#### Scenario: Zero observation budget preserves only genuine pending work
- **WHEN** 调用方使用 `--max-wait-ms 0`，operation 刚被接受且尚未进入任何终态
- **THEN** query MAY 返回 `data.state: "indexing"`；但若读取状态时 operation 已确认失败，query MUST 返回对应 error envelope 而不是 indexing

### Requirement: Query discovery excludes the selected Store root
自动 ProjectContext discovery SHALL 将 selected LocalStore 的 `--store-root` 作为保留边界。若祖先目录中的 `.lorelum` 对应 selected Store root，`lore query` MUST 不将该目录作为 ProjectContext layer，也不得越过该边界继续读取更高层祖先的 `.lorelum`。若没有该边界以下的有效 project layer，query MUST 使用 Store-only behavior，且不得因 Store 的全局 config、Pack artifact、cache 或 runtime 文件输出 context degraded warning。比较 MUST 基于规范化的绝对/real path，支持任意 selected Store root，不得依赖 home 路径、目录名、Git metadata、config 形状或 Pack 内容。

#### Scenario: Query below a user Store remains Store-only
- **WHEN** 调用方在 selected Store root 的子目录中运行 query，且该 Store root 以下不存在其他有效 ProjectContext layer
- **THEN** query MUST 使用 selected LocalStore，且结果不得包含由 Store root 产生的 `config.invalid`、`pack.invalid` 或 degraded context

#### Scenario: Explicit Store root is not a project root
- **WHEN** 调用方以 `--project-root` 显式选择其 `.lorelum` 正好等于 selected Store root 的目录
- **THEN** query MUST 返回既有 invalid-project-root usage error，且不得猜测其他 project root、连接 Backend 或创建 ProjectContext cache

#### Scenario: Ordinary directory without any marker remains Store-only
- **WHEN** 调用方目录及其所有祖先均没有 `.lorelum`，且未传入 `--project-root`
- **THEN** query MUST 使用 selected LocalStore，不得返回 ProjectContext、degraded warning 或 project-derived cache；semantic query 的正常模型与 Store index 生命周期不受影响

### Requirement: Semantic query follows actionable errors without implicit recovery
semantic query SHALL 返回 Backend 的具体错误码及完整可执行 message，不自动停止不匹配实例、不传播 compatibility recovery policy、不自动 keyword fallback。text 与 JSON error.message MUST 同文；适用的 resource 与 diagnostics MUST 保留。既有按需启动、ready、preparing 与退出码合同 MUST 保持。

#### Scenario: Query encounters another build or protocol
- **WHEN** 原 semantic query 遇到已验证的 build/protocol mismatch
- **THEN** 它 MUST 返回对应 backend.build-mismatch/backend.protocol-mismatch，message MUST 给出 `lore backend stop --if-idle`、仅 stopped 后 `lore backend start`、成功后重试相同原 query 的完整步骤；query 自身 MUST 不执行 stop

#### Scenario: Deferred refusal does not schedule background work
- **WHEN** AI 按 query 错误消息执行 guarded stop，结果为 active-long-task 或 unknown-activity deferred
- **THEN** AI MUST 保留另一任务和实例，说明无法安全恢复，不后台重试、不自动退避、不未经用户明确同意使用普通 stop 或 kill，也不把失败说成空检索结果

#### Scenario: True query retry after stop and start
- **WHEN** 真实隔离 smoke 对 mismatch query 完成 guarded stopped、旧 daemon 退出、当前 backend start
- **THEN** 相同文本、参数及 semantic 模式的原 query MUST 真正再次执行并产生真实 ready 结果或 preparing；验收 MUST 不以不同命令、keyword 查询或静态 JSON 替代原 query

#### Scenario: Backend start fails during explicit recovery
- **WHEN** stopped 后显式 backend start 返回 unavailable、listener、ownership、认证或其它具体启动失败
- **THEN** 调用方 MUST 报告真实错误及下一步，不伪造 query 成功、不自动重新启动旧 build、不重放 query 或切换 keyword

#### Scenario: Resource failure is preserved
- **WHEN** query 返回 embedding/model/native 资源校验失败
- **THEN** failure MUST 保留安全 resource 与 diagnostics，message MUST 针对资源问题；删除 compatibility recovery policy MUST 不删除资源故障信息或把它替换成 mismatch 指导

#### Scenario: Existing preparation remains visible
- **WHEN** retry query 真实进入模型或索引准备
- **THEN** query MUST 返回既有 preparing state 与操作信息，而不得将恢复步骤完成当成 ready 或隐藏仍未完成的准备

### Requirement: Store target freshness uses committed identity
Store-only semantic query SHALL 从一致 canonical snapshot 建立内容寻址 target，并在结果返回前通过轻量、已对账的 Store 提交身份确认语料仍有效。系统 MUST 不仅为确认语料未变化再次读取并验证完整 Practice corpus。实际 effective corpus 改变时 MUST 沿用 current target 的重取、pending 或忙碌语义，MUST 不返回混合结果。generation 或来源变化但 effective corpus 未变时 SHALL 保留既有语义索引复用能力。

#### Scenario: Unchanged Store completes a semantic query
- **WHEN** 所选方法的 complete artifact 可用，且查询期间 Store effective corpus 未改变
- **THEN** 系统 SHALL 返回该方法的 complete 结果，收尾检查 MUST 不重新物化完整 corpus

#### Scenario: Store changes during query
- **WHEN** 查询期间 active Store 的 effectiveRevision 改变
- **THEN** 系统 MUST 不把旧 target 当成 current，且 SHALL 沿用重取 target 或可观察 pending/忙碌的既有行为

#### Scenario: Direct project edit is still detected
- **WHEN** ProjectContext 局部来源在查询期间被编辑器修改，但 Store revision 不变
- **THEN** 系统 MUST 继续发现项目来源变化，不得使用 Store-only 版本检查跳过项目重新解析或 winner 更新

### Requirement: Trusted internal query data is not revalidated at every forwarding step
查询 SHALL 在外部输入、native response 和索引发布边界验证所属契约；已验证的同进程数据在内部转发时 MUST 不重复进行完整 canonical 摘要或向量数值质量扫描。正常输出字段、coverage、所选 retrievalMethod、top-k 和排名语义 MUST 保持，keyword MUST 继续离线且不接入 Backend。

#### Scenario: Both semantic methods keep their results
- **WHEN** 同一已准备语料分别使用 single-vector 与 multi-view-vector 执行相同查询
- **THEN** 减少重复校验 MUST 不改变每种方法自身的 query views、评分规则、Profile 隔离、结果排序和 coverage 解释

### Requirement: CLI query settings share an invocation document snapshot

单次 CLI 调用的 logging、query 控制项与所需的 semantic method 设置 SHALL 在需要读取配置时使用同一配置文档快照。不同消费者 MUST 仅验证自己使用的 section；显式参数优先级、无效输入在 Backend 连接前失败、keyword 离线及既有配置错误语义 MUST 保持。配置在该次读取之后发生的修改 SHALL 从下一次 CLI 调用生效，不得使一个调用混用两个配置版本。

#### Scenario: Query controls and method use the same file version

- **WHEN** semantic query 需要 query 控制项及配置中的 retrieval method，且文件在两者消费之间被修改
- **THEN** 本次调用 MUST 使用同一已读取文档中的值，下一次调用 SHALL 读取新文档；显式 option SHALL 继续覆盖本次设置

#### Scenario: Keyword ignores unrelated method errors

- **WHEN** 显式 keyword query 的所需控制项有效，而 semantic method section 非法
- **THEN** keyword SHALL 保持原离线行为，MUST 不因未使用的 method 配置失败，也不得连接 Backend 或加载模型

#### Scenario: Invalid CLI input keeps its error precedence

- **WHEN** query 文本或显式 option 非法，同时配置文件可能不可读或无效
- **THEN** 调用 MUST 保留既有 usage error，MUST 不为共享配置读取而提前连接 Backend 或改变无效输入的优先级
