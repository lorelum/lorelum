## Why

`lore hook` 的五宿主文件主要是类型别名和转发，宿主协议差异却集中在 `host-hook.ts`，而 `main.ts` 为六宿主重复参数解析、日志和执行流程。修改某宿主协议需要触碰公共编排，已有共享功能也缺少明确的按操作依赖边界。

本 change 固化已讨论的代码架构，实施保持现有行为的内部重构；不引入生命周期模型或新产品功能。

## What Changes

- 将一次 Hook 调用拆为参数识别、依赖组装、公共运行外壳、宿主 endpoint 和共享能力；宿主模块真正负责输入解释、协议编码及降级。
- 保留六宿主原生事件、字段、权限流程与交付时序；omp 使用独立 bridge 类型，不并入通用宿主 payload。
- 共享 Catalog、shell 会话关联和已读候选能力；使用窄接口和函数组合，不创建 `BaseHook`、统一生命周期事件或布尔能力大表。
- 明确短进程 Hook、omp 扩展和 Backend 各自的状态归属；统一依赖在入口组装，移出 `model/commands.ts` 中的通用 Backend 连接工厂。
- 在 [design.md](design.md) 写接口、目录、映射、调用全链路及迁移决定；在 [acceptance.md](acceptance.md) 写行为保真与架构验收，避免实施依赖对话记忆。

## Capabilities

### New Capabilities

无。不新增用户可见能力。

### Modified Capabilities

无。保留 `agent-integration` 和 `plugin-distribution` 的现行要求；本 change 使用 `skip_specs: true`，不把内部目录和接口重构伪装成 capability delta。内部约束及验收属于本 change 的设计与验收文件，不同步进 stable specs。

## Impact

- 拟影响 `packages/cli/src/main.ts`、`hook/`、`practice-hints/backend.ts`、Backend 连接工厂位置、包内调用者及 colocated tests。
- 复用 Engine ListService / LocalStore 和 Backend sessions / practice-hints，不修改其存储或检索语义。
- 保留 `plugins/<host>/lorelum/` 原生分发形态，尤其 omp 的扩展快照和身份传递；不改插件安装、设置、版本或发布流程。
- 不增加依赖，不改 CI、锁文件、MCP、Hook 自动 query/get、遥测或重试策略。
- 代码依据为主线 `963963e`，包含 omp；重构以包含该版本的分支为基线，不把旧分支缺失功能当成待新增能力。
