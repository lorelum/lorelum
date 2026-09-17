## MODIFIED Requirements

### Requirement: Query result and preparing semantics

成功的 ready query SHALL 产生一个包含 results 的结构化 result，其中 results 只包含 Practice summary，不包含完整正文或内部 score；调用方 MUST 使用 `lore get <practice-id>` 读取 canonical Practice。未传 `--json` 时 CLI SHALL 将这份 result 作为完整 text 写入 stdout；传入 `--json` 时 stdout SHALL 输出包含同一 result 的 JSON protocol envelope。ready result MUST 以 exit code 0 结束。若 semantic query 已接受共享模型准备但在短暂观察期内仍未 ready，命令 MUST 产生 `data.state: "preparing"`、preparationId 和恢复提示，且以 exit code 1 结束；它 MUST 不伪造检索结果。失败 MUST 使用已映射的 error code/message/recovery 并以 exit code 2 结束，输出目的地与格式由普通 CLI output contract 决定。

#### Scenario: Model preparation remains pending

- **WHEN** semantic index 可用但固定模型的准备在观察期内未完成
- **THEN** 命令 SHALL 产生唯一的 preparing result，默认 text SHALL 完整显示其 data，带 `--json` 时 SHALL 输出唯一 JSON envelope，exit code MUST 为 1，调用方可通过 `lore model status` 后重试

#### Scenario: Ready result is bounded and canonical

- **WHEN** semantic 或 keyword retrieval 成功完成
- **THEN** results MUST 至多包含请求的 top-k 个 summary，且每个 summary MUST 来自同一已验证 Store snapshot 的 canonical Practice；默认 text 与 `--json` MUST 保留相同结果顺序和全部公开 result fields
