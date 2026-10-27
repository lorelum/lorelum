## Why

compact 后需要恢复本会话已读 Practice 的有界线索，让主 Agent 在有用时重新读取全文，而不是依赖摘要保留阅读记录。本变更新增产品行为，对应 [#217](https://github.com/lorelum/lorelum/issues/217)，同时把各 host 的功能边界清楚地展示在公共文档。

## What Changes

- Claude Code、Codex、WorkBuddy 复用已有 `SessionStart(source=compact)`；omp 复用已提交压缩后的 `session_compact` 和下一请求前的 `context`。不新增 compact Hook，不把 Practice 混入 Pack Catalog。
- 复用公共候选读取与 renderer；三个原生 Hook 使用公共预算组合函数，返回 Catalog 与历史候选。候选只含 ID、title、适用条件，提示可能相关、非采纳结论，使用前重新 get。
- startup、resume、clear、fork 不新增主 Agent 候选发送。omp 前台与后台压缩只在提交后刷新快照，保留取消、generation 隔离、临时消息去重，不增加持久提示。
- ZCode 与 Cursor 不新增 compact 恢复：ZCode 的 SessionStart 只运行于 startup/resume；Cursor 不在 compact 后重跑 sessionStart，其 preCompact 只提供用户提示。已有 query/get、Catalog、读取记录保持不变。
- 功能对比表改为 host 列、功能行：`✓` 完整实现、`△` 部分实现、`✗` 无此功能、`-` 未知；各 host 的英中指南写明完整支持内容、限制与恢复方式。表格表达功能能力，不把是否执行本次实机验收混作能力状态。
- 按用户要求只对 Codex、omp 做真实宿主验收；Claude Code、WorkBuddy 以及未增加恢复功能的 host 运行相关测试，不额外要求实机验证。

产品路径见 [product.md](./product.md)。不增加配置、持久化格式、TTL、逐请求轮询、自动 query/get、Backend 启动或模型/index 准备。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `agent-integration`：主会话压缩恢复、重复事件与后台压缩隔离、宿主功能对比及逐宿主支持说明。

## Impact

涉及 CLI Hook 公共服务、Claude Code/Codex/WorkBuddy 适配器、公共候选 renderer、omp extension 和 colocated 测试；更新 host README、公共功能对比表、英中 host 指南和维护者 ABI 文档。复用 Backend 的认证和会话候选簿，不增加依赖，不修改发布流程，不自动提交、推送或发布。
