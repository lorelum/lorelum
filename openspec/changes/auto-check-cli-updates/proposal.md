## Why

用户不应先记得运行 lore update 才能知道 Lorelum 有新版，也不应为检查更新等待网络或反复收到同一提示。本变更围绕 #130 引入异步版本发现：正常 Agent 调用启动短生命检查，后续调用取得结果，再由 Agent 在任务总结中顺带告知；用户路径见 [产品方案](./product.md)。

## What Changes

- 合格会话 Hook 和带现有可靠 host/session 绑定的成功检索调用只做本地 poll。到期时领取检查额度并启动 detached 短生命 worker，父调用不等待发行网络；后续可投递调用消费 ready 结果，没有结果就照常返回。
- 检查按本机用户、默认频道、平台与当前 CLI 版本分区：成功后 1 小时、失败后 15 分钟才可重新尝试；worker 整次网络预算 30 秒。没有调用不定时唤醒，没有 daemon 或永久队列。
- 提醒按规范化的 currentVersion/targetVersion 版本对在本机用户下最多发出一次。新 target 可在同一对话提醒；更新 CLI 后形成新起点，即使仍落后一版也可重新提示同一 target。同版本重装、换项目、换宿主不重置，旧 binary 不改写全局当前版本。
- Agent 会话绑定的成功 query/get/list/pack.list 文本可附固定短 prompt；JSON 可触发检查但不增加字段、不投递、不领取提醒。显式 query --mode keyword 保持离线，不 poll、不启动或领取提醒；管理命令、帮助、版本查询、工具 Hook、SubagentStart 与 compact 不参与。
- 原生 SessionStart 保留 Catalog 与宿主 envelope；omp main catalog bridge 返回独立一次性 updateNotice，不进入每次模型请求复用的 Catalog 快照。旧请求保持 Catalog-only，旧 CLI 的有效空对象仅允许一次 legacy 请求回退。
- prompt 明确先完成当前用户任务，结尾可顺带告知 Lorelum 新版与 lore update 入口；不自动执行更新、不立即追问升级。updates.autoCheck: false 同时关闭自动启动与投递，显式 lore update / --apply 的现查、输出和安装边界不变。

## Capabilities

### New Capabilities

- cli-update-notifications：异步检查、版本分区冷却、版本对去重、文本与 Hook 投递、关闭设置、失败降级与显式更新隔离。

### Modified Capabilities

- agent-integration：Agent 文本中的非阻塞提示、原生 Hook 的可选更新段落、omp bridge 扩展与一次性提醒消费。

## Impact

- CLI update 模块增加用户级状态、poll 编排及短生命 worker；复用 release-client、version-catalog 和既有 source/compiled 启动模式，不引入新依赖或 Backend 更新服务。
- CLI 成功响应与 Hook composition 接入本地 poll；普通 JSON envelope、diagnostics 和命令 data schema 不扩展。沿用现有 host/session 环境绑定，不新建主/子 Agent 身份体系。
- 用户状态属于 ~/.lorelum，不属于项目、Pack 或 LocalStore；实现后同步站点中英说明与内部 Hook/config 合同。更新指导只在实际 notice 中返回，不修改共享 Skill 或增加常驻上下文。
- 显式更新实现与 [对应变更](../define-cli-version-update-policy/proposal.md) 提供基线证据，后者不是自动接受的主规格。规格接受时协调其“仅显式检查／无缓存”范围，自动发现不复制或弱化安装合同。
- 本变更包含实现和验证，不授权发布 Release、改 release workflow、安装新版或公开 Issue/PR。
