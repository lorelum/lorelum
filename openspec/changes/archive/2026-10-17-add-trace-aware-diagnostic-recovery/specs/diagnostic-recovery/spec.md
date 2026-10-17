## Purpose

让普通 CLI 调用在其原始 text failure 中提供可直接使用的本机关联 ID，并为用户定义一条不依赖重新执行故障命令的日志查看、受控 debug 重现和本地反馈草稿路径。

## ADDED Requirements

### Requirement: Text-mode failure exposes its local trace

除 raw Host Hook ABI 外，普通 CLI 调用的 text failure SHALL 在原有可读 error code、message 与 recovery 后，于同一 stderr 响应显示该次调用的 `diagnostics.traceId`。该值 MUST 与本次调用写入受管理本机日志所使用的 trace 相同；增加该显示 MUST NOT 改变退出码、error code、recovery、stdout 路由或 `--json` envelope。

#### Scenario: A normal command fails in text mode

- **WHEN** 用户未传 `--json` 的普通 CLI 命令返回可见 failure
- **THEN** stderr MUST 保留完整可读错误，并显示一个可复制的 `diagnostics.traceId`，使用户可直接执行 `lore logs --trace-id <traceId>` 而无需重现该命令

#### Scenario: A machine consumer requests JSON

- **WHEN** 用户以 `--json` 执行同类普通 CLI 命令且命令失败
- **THEN** stdout MUST 继续只输出单行 failure envelope，其中的 `diagnostics.traceId` 仍是本次调用的本机关联 ID，且 stderr 不得变成第二个 JSON envelope

#### Scenario: A raw Host Hook degrades

- **WHEN** `lore hook codex`、`lore hook zcode`、`lore hook cursor` 或 `lore hook workbuddy` 遇到可恢复故障
- **THEN** stdout MUST 保持该宿主既有的 raw degrade envelope，且不得插入普通 CLI 的 trace 或 diagnostics 文本

### Requirement: User documentation provides a trace-based recovery path

站点 SHALL 提供中英文用户排障路径，说明如何从原始 text 或 JSON failure 取得 trace、只查看该 trace 的受管理日志、理解 `missingEvidence`、在需要更多 detail 时受控使用 `--debug`，以及如何生成但不自动外发本地 feedback draft。该指南 MUST 从 CLI reference、Troubleshooting 与 Agent 文档可达，且 MUST 不要求用户直接解析 JSONL、读取 Backend 私有文件或重现原始 failure 才能取得 trace。

#### Scenario: A user follows a text failure into local logs

- **WHEN** 用户在终端看到带 `diagnostics.traceId` 的 text failure
- **THEN** 用户文档 MUST 给出 `lore logs --trace-id <traceId>` 的操作和解释，并说明日志读取不会启动 Backend、模型或新的 query

#### Scenario: Existing evidence is insufficient

- **WHEN** 当前 trace 的日志报告缺失、损坏、轮转或 detail 未记录
- **THEN** 用户文档 MUST 将其说明为证据限制，给出受控 `lore --debug <command>` 重现的选择，并不得把无关 trace 内容或猜测当作补充证据

#### Scenario: A user wants to report the observed problem

- **WHEN** 用户决定把一次排障结果整理为 bug 或 improvement
- **THEN** 用户文档 MUST 说明 `lore feedback draft --trace-id <traceId> --kind <bug|improvement>` 只生成本地可审阅 artifact，不上传数据、不打开 URL 且不创建 Issue
