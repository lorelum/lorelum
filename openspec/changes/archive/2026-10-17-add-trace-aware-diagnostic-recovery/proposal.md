## Why

当前每次普通 CLI 调用都会产生本机 `traceId`，但默认 text 失败只显示 error code、message 和 recovery，用户无法从**原始失败**直接查看该调用链的日志；要求改用 `--json` 重现既可能改变现场，也可能触发新的 operation。与此同时，只有 generic、Codex 和 ZCode Skill 有非打断式反馈说明，Cursor 与已进入主线的 WorkBuddy 缺少同等规则，且用户文档没有一条从错误到日志、受限重现和本地反馈的完整操作路径。

## What Changes

- 普通 CLI 的 text failure SHALL 在原有结构化错误后显示该次调用的本机 `traceId`，使用户无需重现即可执行 `lore logs --trace-id ...`；raw Host Hook stdout ABI 不变，不附加此字段。
- 引入受限的 Agent 排查路径：只有 Lorelum 故障阻塞当前任务，或用户明确要求诊断时，Agent 才可读取当前 trace 的日志；不得扫描其他 trace、自动预检 runtime、自动上传、建 Issue 或为了收集 detail 擅自重现。
- 当当前 trace 证据不足时，Agent SHALL 说明限制，并建议用户选择后续最小复现（例如 `lore --debug <command>`）；只有用户明确同意时才把已存在的同 trace detail 加入本地 feedback draft。
- 对齐 generic、Codex、ZCode、Cursor 与 WorkBuddy Skill，使五种命令型 Agent 路径都先完成可继续的主任务、最多一次非打断式反馈询问，并遵循相同的 trace-bounded 排查边界。
- 新增中英文面向用户的排障指南，并从 CLI、Troubleshooting 和 Agent 文档链接；说明 text error trace、`lore logs`、`--debug`、证据缺口与本地 feedback draft 的关系。

## Capabilities

### New Capabilities

- `diagnostic-recovery`: 为普通 CLI error 提供可直接使用的本机关联 ID，并定义从当前调用链日志到受控 debug 重现和本地反馈草稿的用户排障路径。

### Modified Capabilities

- `agent-integration`: 使所有受支持宿主的 Skill 遵循统一、trace-bounded 且不打断主任务的诊断与反馈流程。

## Impact

- 影响普通 CLI text failure 渲染、协议/渲染测试和 CLI 文档；JSON envelope、退出码、error code 与 raw Hook stdout ABI 不变。
- 影响 generic Skill 以及 Codex、ZCode、Cursor、WorkBuddy Plugin Skill；Host Hook 仍只提供 metadata，不主动 query、读取日志或生成反馈。
- 新增站点中英文排障用户指南及相关导航链接；维护者日志接入文档只补充交叉引用，不取代用户操作手册。
- 不新增依赖、网络上传、自动 Issue 创建、本地 MCP 或新的后台服务。
