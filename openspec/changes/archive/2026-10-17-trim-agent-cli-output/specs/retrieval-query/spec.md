## MODIFIED Requirements

### Requirement: Query result and preparing semantics
成功的 ready query SHALL 默认在 stdout 输出 Agent 可读 text；显式 `--json` SHALL 在 stdout 输出完整 JSON protocol envelope。results 只包含 Practice summary，不包含完整正文或内部 score；调用方 MUST 使用 `lore get <practice-id>` 读取 canonical Practice。ready result MUST 以 exit code 0 结束。若 semantic query 已接受共享模型准备但在短暂观察期内仍未 ready，命令 MUST 返回可识别的 preparing 状态与恢复提示，并以 exit code 1 结束；JSON 中 MUST 包含 `data.state: "preparing"` 与 preparationId，不得伪造检索结果。失败 MUST 以 exit code 2 结束；JSON 使用 `ok: false` 的 error envelope，默认 text 显示 code、message 及适用的 recovery。

#### Scenario: Model preparation remains pending
- **WHEN** semantic query 接受模型准备但在观察期内未完成
- **THEN** 默认 text SHALL 明确显示 preparing 与恢复提示，`--json` SHALL 输出唯一的 preparing envelope，exit code MUST 为 1，调用方可通过 `lore model status` 后重试

#### Scenario: Ready result is bounded and canonical
- **WHEN** semantic 或 keyword retrieval 成功完成
- **THEN** results MUST 至多包含请求的 top-k 个 summary，且每个 summary MUST 来自同一已验证 Store snapshot 的 canonical Practice；默认 text 与 JSON MUST 对应同一组结果
