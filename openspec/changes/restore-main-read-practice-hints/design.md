## Context

用户路径见 [product.md](./product.md)。已核实四个恢复入口：Claude Code 的 SessionStart compact 合同；Codex 0.162.0 的 `replace_compacted_history` 对本地和远端压缩排入 compact source，继续请求前运行 Hook；WorkBuddy 2.137.1 的 `sendContinueMessage` 等待 `emitSessionStart(session,"compact")` 再把 Hook context 注入输入；omp 18.13.1 提交压缩后派发 `session_compact`，每次 provider 请求前消费 `context` 返回消息。

ZCode 0.16.9 的 `runSessionStartHooks` 只有 startup/resume 调用且有会话级一次标记，Hook enum 没有压缩事件。Cursor 2026.10.22-27dcf5f 的 sessionStart 在初始化派发；preCompact 只传递用户提示。两者不接入本次恢复。

候选写入由 CLI 成功 get 尽力报告、Backend 会话 JSONL 单点拥有；`hook/services/read-hints.ts` 读取后调用 `practice-hints/render.ts`，最多 1800 字符。Catalog 默认 4000，renderer 已有可选预算。omp extension 已有 generation、abort、并发读取共享、临时消息及 WeakSet 去重。模拟旧 Main compact 回调不会请求 read-hints；真实 renderer 的大目录/候选直接拼接曾得到 5663 字符，超过 Codex 的 5000 Hook 限额。

## Goals / Non-Goals

- 共享候选语义、读取与预算，复用已有宿主事件，不另建 Hook、存储或通用 adapter。
- startup/resume 不新增候选，避免与 compact 同时发送；omp 只在压缩提交事件后刷新，后台准备阶段不做新工作。
- 不扩大到 ZCode/Cursor 的其他刷新时机；不增加自动 query/get、Backend 启动、配置、TTL、重试或全库验证。

## Decisions

### 1. 原生 Hook 的公共组合

`CatalogReader.readCatalog(options?: { readonly maxCharacters?: number }): Promise<string>` 将可选预算交给既有 Catalog renderer。`hook/services/catalog.ts` 增加 `readCatalogWithReadHints(services: CatalogReader & ReadHintReader, session: SessionRef): Promise<string>`：先取得已有最多 1800 字符的候选；候选异常按无候选处理；Catalog 预算为 `4000 - hints.length - 2`，无候选时为 4000；用空行组合。Catalog 本身失败保留既有 endpoint fallback。

Claude Code、Codex、WorkBuddy 仅在输入边界已验证会话身份且 source=compact 时调用该函数；其他 source 继续 `readCatalogWithUpdateNotice` 原流程。组装仍由 `createHookEndpoint` 拥有，不在 helper 新建 Backend 客户端。所有调用者使用共享 renderer 的 current task 中性文案，不维护主/子两份文案。

每次原生 Hook 是独立请求，不新建跨进程去重簿。避免重复的方式是只使用一个 compact 出口、只接受 compact source，不让 startup/resume 恢复候选；真正重复的压缩完成事件仍返回一份有界片段，而非累计以往提示。

### 2. omp 沿用现有快照和桥接

在 `extensions/catalog.ts` 加 generation 生命周期内的 `mainRecoverySessionId`。invalidate 一并清空；`session_compact` 完成时先失效旧快照，再仅为 Main 捕获实际 session ID。context 的候选目标为：sub 仍用 handoff 源头 Main；main 仅在捕获 ID 与当前 ID 相同且非空时用本会话；否则不读取候选。

继续复用 Promise.all 的 Catalog/read-hints 读取、abort 和 generation 检查。Catalog 4000、候选 1800 仍是独立 user metadata 片段，不改严格 read-hints bridge。普通请求共用同一 pending/snapshot；compact 替换本扩展旧消息，不追加持久历史；切换、tree、branch、shutdown 清除恢复资格。不同 ctx 的会话不可共享恢复状态。

后台压缩的摘要生成与提交是不同阶段。extension 不监听准备事件，只监听宿主提交压缩后已有的 session_compact；即使旧 CLI 读取在后台提交后才完成，generation 检查也丢弃它。上下文回调等待当前生命周期读取，不使晚到旧结果覆盖新候选。实现中若发现宿主合法消息转换影响身份去重，只修复已观察到的去重边界，不添加持久消息或全局状态。

### 3. 对比表与支持说明

`apps/site/content/docs/agent-setup{,.zh}.mdx` 的现有能力表转置为 host 列、功能行，行覆盖 Skill/query/get、Main Catalog、成功读取关联、子 Agent 候选、子 Agent Catalog、主 Agent compact 恢复等真实功能。`✓`、`△`、`✗`、`-` 有明确图例，部分能力链接 host 指南。Cursor Main Catalog 标明首轮时序差异，omp 子 Catalog 是显式 opt-in，不把它当作完整默认能力。

六个 host 指南和 Plugin README 分别解释已实现的内容与限制；root README 保持导航，不复制完整矩阵。维护者 Hook 文档说明 source 与预算；验收日志/版本只写专门验证记录，不混入长期指南。

### 4. 迁移与验证所有权

CLI 只迁移三个真实原生 compact 分支；ZCode/ Cursor 不改事件配置。公共 renderer 文案一起切换，不留旧别名。omp 来源继承与旧 bridge 不变，不改变 Backend/Engine。

按本次明确授权，真实 host 验收只由实施者负责 Codex、omp。Claude Code、WorkBuddy 依原生合同实现并运行对应测试；不将其未做实机检查标成功能未知。Codex 检查一次真实成功 get、compact、恢复请求及 startup/resume 不额外恢复；omp 检查前台/后台提交、并发/晚到、重复请求与切换。所有新增行为保留 colocated 回归测试；对比表在实际站点检查两种语言与窄屏横向阅读。

## Risks / Trade-offs

- 历史候选过时：明确历史含义，使用前重新 get，不扫描 Pack 当前内容。
- 原生恢复时目录空间缩减：保留既有 renderer 的名称/截断提示；不扩大 Hook 限额。
- Backend 停止或漏记：省略候选保留 Catalog，不把恢复变成前置条件。
- 后台提交与旧请求重叠：沿用单一 generation/abort 所有权，测试实际状态切换，不另建锁/重试层。
- 部分 host 无恢复入口：矩阵 `✗`，详细指南解释，不构造伪适配。

## Migration Plan

先修订本提案，再实现公共函数、三个原生入口和 omp 目标选择；测试后用目标 worktree CLI 与现有正常宿主配置验证 Codex/omp。完成后更新文档、验证矩阵实际呈现并同步受影响当前规格。无需数据迁移；回退代码不删除候选簿。不自动部署、发布或修改用户全局设置。
