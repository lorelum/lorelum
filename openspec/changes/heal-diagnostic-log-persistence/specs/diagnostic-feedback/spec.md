## MODIFIED Requirements

### Requirement: Trace draft includes the complete ordinary local call chain by default

`lore feedback draft --trace-id <traceId> --kind <bug|improvement>` SHALL 从已保留且直接关联该 trace 的记录，以及由该 trace 的 correlation IDs 安全关联的匿名 shared lifecycle 记录中，默认写入全部 `error`、`warn`、`info` LogRecord。它 MUST 保留每条记录已写入的 message、source、time、correlation IDs、普通 context 与 Error stack。草稿 MAY 同时提供 diagnostic facts 作为摘要，但摘要 MUST NOT 替代完整记录。

该命令 MUST 只读取已有本机日志，MUST NOT 启动 Backend、重放调用、扫描其他 trace 或杜撰缺失 evidence。保留期、轮转、读取上限导致记录不可读，或该 trace 证据未持久化时，草稿 MUST 使用 `diagnostic-logging` 定义的统一 trace 证据状态说明证据缺口并标注记录位置；`missingEvidence` 条目 MUST 由该状态派生，草稿 MUST NOT 从空记录集合自行另造状态或原因。

#### Scenario: A failed query creates a useful default local draft

- **WHEN** 某个 trace 已写入包含 query context 与 Error stack 的 `info`、`error` 记录，用户不传 `--include-logs` 创建该 trace 的 bug draft
- **THEN** JSON 和 Markdown 本机草稿 MUST 包含这些完整记录及其原始 trace ID，且不得只输出窄化 diagnostic facts

#### Scenario: The selected trace has incomplete retained evidence

- **WHEN** 用户创建某个 trace 的 draft，但关联记录已被轮转、截断、未持久化或不存在
- **THEN** 命令 MUST 仍创建可审阅的本机草稿，并以与 `lore logs` 一致的证据状态准确标明缺口及记录位置，而不得以其他 trace 的内容补全或另造原因
