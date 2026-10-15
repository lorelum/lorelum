## Why

为 omp 提供 Lorelum 插件安装、Pack Catalog 与 Skill 检索路径。omp 使用 TypeScript extension callbacks，不能直接消费现有宿主的 JSON Hook envelope；需要按其插件接口适配，数据访问仍由 Lorelum CLI 负责。

本 change 新增 omp 产品行为。pi 的考证保留在 research.md，pi 插件、CLI bridge、npm 分发与验收均不属于本次实施范围。

## What Changes

- 提供 omp artifact，保持产品与 Skill 名称 `lorelum`，源目录为 `plugins/omp/lorelum/`。
- 使用 `.omp-plugin/marketplace.json` 注册该 artifact。
- omp 主 Agent 在启动、重新加载、切换、branch/tree 与 compact 边界使 Catalog 失效，下一次模型请求读取一次；每次请求临时复用快照，不重复查询或永久保存。子 Agent 默认不接收 Catalog；`~/.lorelum/config.yaml` 的布尔配置 `agent.subagentPackCatalog` 默认 `false`，显式 `true` 才额外提供 Pack 目录元数据，不提供完整 Pack 或 Practice 正文。
- 在 CLI 增加 `lore hook omp` 的 extension bridge，复用现有 Catalog 服务和 renderer。Catalog 请求可带 `agentKind: "main" | "sub"`，省略按 main；CLI 读取配置，禁用的 sub 返回正常 `{}` 且不读 Store。extension 不直接读配置文件；主 Agent 不受该开关影响。
- 将原始 JSON Hook 与进程内 extension callback 的适配边界写入合同，保留所有现有宿主的行为。
- 支持成功 `lore get` 的 omp 会话记录，并向所有 task/eval 子 Agent（包括嵌套层级）提供源自主会话 Main 的成功读取候选。子 Agent 自己 get 仍归自己的会话，不自动并入 Main。候选与 Catalog 开关独立；不猜测缺失的 Main 身份，不增加工具或全局环境变量，不复制 Backend 存储。

## Capabilities

### New Capabilities

无。扩展既有宿主集成与分发能力，不新建重叠 capability。

### Modified Capabilities

- `agent-integration`：定义 omp extension 的 CLI bridge、Catalog 生命周期、临时注入和非阻塞失败行为；区分 shell JSON Hook 和进程内 callback。
- `plugin-distribution`：明确 omp 独立 marketplace 的身份、源目录及安装边界。

## Impact

- 新增 `plugins/omp/lorelum/` artifact 与 omp marketplace registration；现有宿主运行行为不变。
- CLI 的 `packages/cli/src/hook/` 与 `main.ts`/入口导出新增 omp bridge，复用 Catalog 数据获取和 `pack-catalog.ts`，不更改 query/get 合同。
- Backend 会话身份枚举增加 `omp`，复用既有成功读取记录与候选服务；不改 Engine、query/get 返回合同、MCP 或 release/publish workflow。
- 维护插件索引、插件约定、CLI Hook 文档、英文与中文 omp 用户指南，并以正常本机 omp 的真实安装和检索路径验收。
- 考证基线与历史实验见 [research.md](./research.md)，实际实现状态和验证结果在单独验证记录中保存。
