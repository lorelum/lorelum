## ADDED Requirements

### Requirement: Terminal semantic operation failures are observable query errors

`data.state: "preparing"` 与 `data.state: "indexing"` SHALL 只表示已接受的 semantic operation 仍处于非终态且调用方尚未获得可用结果。若当前 query target 的 operation 已确认失败，`lore query` MUST 返回 `ok: false` 的 error envelope 并以 exit code `2` 结束，不得把失败伪装为 pending、空结果或 keyword result。若失败具有允许公开的稳定 `embedding.*`、`store.busy` 或 `store.recovery-required` code，query MUST 保留该 code；其他失败 MUST 使用 `backend.failed`。错误不得包含异常文本、路径、模型来源、Practice 正文、凭据或 runtime 身份数据。

#### Scenario: Model preparation failure is not reported as indexing

- **WHEN** 当前 target 的已接受 operation 因 `embedding.download-failed` 终态失败，且调用方在观察期内或随后查询时读取到该终态
- **THEN** `lore query` MUST 返回 `ok: false`、`error.code: "embedding.download-failed"` 与 exit code `2`，且不得输出 `data.state: "indexing"` 或 “Retry shortly” 的 pending message

#### Scenario: Zero observation budget preserves only genuine pending work

- **WHEN** 调用方使用 `--max-wait-ms 0`，operation 刚被接受且尚未进入任何终态
- **THEN** query MAY 返回 `data.state: "indexing"`；但若读取状态时 operation 已确认失败，query MUST 返回对应 error envelope 而不是 indexing
