## ADDED Requirements

### Requirement: Trace-bounded Agent diagnostic recovery and deferred feedback

generic Skill 以及 Codex、ZCode、Cursor、WorkBuddy 的宿主 Skill SHALL 对 Lorelum 故障使用一致的、以当前调用 trace 为边界的恢复路径。若故障没有阻塞主任务且用户没有要求诊断，Skill MUST 仅在当前任务保留候选事实，MUST NOT 自动读取日志、重新执行命令、写 feedback artifact、上传内容或创建/更新 Issue；它 MUST 在任务完成或用户可见里程碑最多一次非打断式询问用户是否需要反馈。

若 Lorelum 故障阻塞当前任务，或用户明确要求诊断，Skill MUST 先使用原始 failure 已显示或 JSON envelope 已提供的当前 `traceId` 执行受管理的同 trace 日志读取，并依据返回的 records 与 `missingEvidence` 说明可验证事实和证据缺口。Skill MUST NOT 扫描其他 trace、任意目录、环境、配置、完整 HTTP 内容或 native 原始输出，也 MUST NOT 在日志读取前为“预检”目的启动 Backend、模型、index 或 status 命令。

只有用户明确要求重现/诊断，或当前任务授权已明确包含安全的最小重现时，Skill 才可以建议或执行带 `--debug` 的后续调用；它 MUST 说明该调用产生的是新的 trace，且不得把新 trace 当成原始 failure 的证据。生成 feedback draft 仍 MUST 先取得用户明确同意；添加 `--include-logs info|debug` 仍 MUST 由用户明确选择。

#### Scenario: A non-blocking candidate is deferred

- **WHEN** Agent 发现清晰的 Lorelum bug、retrieval/guidance gap 或用户请求的缺失能力，但主任务可以继续且用户未要求诊断
- **THEN** Agent MUST 完成主任务，在最终总结或用户可见里程碑最多一次说明候选事实并询问是否需要本地反馈草稿，且不得自动读取额外日志或写 artifact

#### Scenario: A Lorelum failure blocks the task

- **WHEN** 当前 Lorelum failure 阻塞 Agent 完成已授权任务，且该 failure 提供当前调用的 trace
- **THEN** Agent MUST 先读取该 trace 的受管理日志、报告可验证事实与 `missingEvidence`，并在不执行广泛扫描或无授权重现的前提下选择恢复、请求用户决定或继续其他独立工作

#### Scenario: The user asks for a detailed reproduction

- **WHEN** 用户明确要求 Agent 重现或深入诊断，且现有同 trace 日志不足
- **THEN** Agent MAY 执行当前任务范围内安全的最小 `--debug` 重现，MUST 将其新 trace 与原始 trace 区分，并在需要把 detail 放入 feedback draft 前再次取得用户对 `--include-logs` 的明确选择

#### Scenario: A user approves a feedback draft

- **WHEN** Agent 已解释候选问题并且用户明确同意准备反馈
- **THEN** Agent MUST 只生成同 trace 的本地 feedback draft，展示 artifact 路径、included evidence、`externalReview` 与 `missingEvidence`，且不得将草稿视为上传、公开 Issue、triage 或产品变更授权
