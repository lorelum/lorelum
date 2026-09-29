## Why

`lore pack list`、`query`、`get` 的默认 text 目前完整展开 JSON data，SessionStart Catalog 还为每个 Pack 常驻输出版本和绝对 root。Agent 在发现、选择、阅读全文的不同阶段反复接收不影响当前判断的元数据；但直接删 root 又会让 Pack 相对 `resource:` 链接失去可靠的定位来源。本变更引入新的 Agent 可读输出行为，不改变 canonical Practice、检索结果或 JSON 协议数据。

## What Changes

- **BREAKING**：默认 text 改为按命令决策阶段呈现，隐藏快照号、digest、Profile ID、默认 severity 等非决策字段；`--verbose` 显示完整现有 data 的 text，`--json` 的 schema、字段与语义不变。
- `pack list --details` 继续表示所有 Pack 的富元数据，不作为通用展开参数。显式 `pack list <name>` 保留可读 Pack root；`get` 默认为每个 source 保留原有 `packRoot` 与 Pack 身份，以便解析 `resource:` 和区分多来源。
- SessionStart Catalog 保留名称、描述和非空技术范围，不再常驻注入每个 Pack 的版本和 root；各宿主 Skill 改为从 `get` 的对应来源或显式 `pack list <name>` 获取 root。
- 覆盖普通、空、部分覆盖、准备中、降级、错误、多来源和资源链接的 text/JSON 回归；更新 CLI 与宿主说明，并记录基线与改后可比的上下文开销及资源可达性证据。

## Capabilities

### New Capabilities

- `agent-readable-output`：定义 list/query/get 的默认 text、按需完整 text 与 JSON 不变边界，以及资源 locator 的显示规则。

### Modified Capabilities

- `agent-integration`：调整注入 Catalog 的字段与 Skill 获取 Pack root 的路径。
- `retrieval-query`：使现有“默认 stdout JSON”文字与实际默认 text、显式 `--json` 合同一致，并约束精简 text 不误报检索状态。

## Impact

CLI renderer 与命令定义、Hook Catalog renderer、各宿主 Lorelum Skill、CLI/宿主文档和相应测试会变化。默认 text 是公开行为变化；JSON envelope、Engine/Backend、Store 与 Pack 格式不变。ProjectContext 来源的 `project-layer-N` 仍仅是逻辑 provenance，不在本变更中增加项目资源定位合同。
