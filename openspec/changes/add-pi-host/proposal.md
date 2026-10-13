# Proposal

## Why

仅安装 Lorelum Skill 不能保证 Pi 在会话开始、恢复或压缩后发现已安装的工程知识包。本变更新增第一方 Pi 集成产品行为，使用原生 Extension 衔接生命周期，保持 Skill 的按需 query/get 和 CLI-first 边界。

## What Changes

- 在 `plugins/pi/lorelum/` 提供单个 Pi Package，一起声明 Lorelum Extension 与 `skills/lorelum/`，显式入口使用 Pi 原生 `/skill:lorelum`，不另加 `/lore`。第一版采用克隆仓库后 `pi install <checkout>/plugins/pi/lorelum` 的原生本地路径安装，不假设 Git 子目录支持，也不发布 npm 包。
- 会话开始、切换和成功压缩后的模型请求获得有界、metadata-only Installed Pack Catalog；自动压缩后的重试也必须覆盖，不依赖仅在新用户轮次触发的事件。
- CLI 负责共享 Catalog 读取与渲染，Pi Extension 只做进程调用和上下文适配，不导入 Engine/Backend 或读取 Store。
- CLI 缺失、旧 CLI 不支持集成、Store 失败和超时均不阻断正常 Pi 任务；空 Store 明确显示没有已安装 Pack，而不是检索失败。
- 以 `product.md` 定义安装、信任、首次使用、恢复、更新和移除路径；实施完成后新增匹配的中英文站点用户页，维护者资料只说明 API 与验证边界。

## Capabilities

### New Capabilities

无；复用现有能力边界。

### Modified Capabilities

- `agent-integration`: 纳入 Pi 原生 Extension 生命周期适配、压缩恢复、非阻塞降级与共享 CLI Catalog ABI。
- `plugin-distribution`: 为没有 marketplace registration 的 Pi 定义原生 Package 分发例外，保持唯一产品身份和宿主源码根目录。

## Impact

- 预计涉及 `plugins/pi/lorelum/`、CLI Hook adapter/dispatch 和对应测试、Skill guidance fixtures、Plugin layout tests、插件维护规范及站点 Agent 入口与 Pi 双语页。
- 不改变现有宿主 envelope、Pack/Practice schema、query/get 语义、Backend host 枚举、身份注入策略或 Session Tracking。
- Pi 包不携带 Lorelum CLI 或原生模型运行时；CLI 与 Pack 由用户按现有工作流独立安装。不得修改发布流程或发布 npm 包。
- 新增 ABI 仅服务 Catalog，不提供第二条检索路径；实际实现前应评审本提案与 `design.md`。

## Non-goals

不实现子 Agent 候选传递、已读 Practice tracking、工具调用改写、自动 query/get、自动安装 CLI/Pack、后台 watcher、定时刷新、本地 MCP、通用宿主平台或新 marketplace。
