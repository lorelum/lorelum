## Context

Issue #227 的根因是跨命令 mismatch 的恢复指引不够可执行，而不是缺少受管理升级架构。用户选择删除恢复策略、补全错误消息。本文件替代原安装升级与自动接管设计；既有目录名不意味着保留旧技术方案。

## Goals / Non-Goals

**Goals:** 错误 message 自包含、text/JSON 一致；AI 可以复用 guarded stop→start→原命令重试；deferred 安全拒绝；保持具体错误、diagnostics、resource 与 lease。

**Non-Goals:** 不改安装器和发布；不自动停止 query/status 遇到的进程；不新增 receipt、authority、callback、coordinator、registry、锁、持久化或后台恢复机制；不改模型资源、index operation、Store 或检索模式。

## Decisions

### 1. 从错误合同删除策略，而不是继续传播

BackendError 使用 `(code, options?, message?)`；CliError 使用 `(code, message, resource?)`；createFailureEnvelope 使用 `(command, code, message, diagnostics?, resource?)`。failure RenderableResult 不携带 recovery。所有调用方、schema、renderer、测试与文档同步迁移，不保留 shim 或策略别名。ResourceFailure 是独立合同，继续通过 error.resource 和模型/index 状态保留；diagnostics.traceId 保留。

### 2. Backend 拥有具体可执行默认消息

build/protocol mismatch 默认消息包含问题、`lore backend stop --if-idle`、只有 stopped 后才 `lore backend start`、再重试原命令，以及 deferred 时不后台重试、不未经明确同意使用普通 stop 的边界。unavailable 指示 start 后重试。CLI 原样传递 Backend message；text renderer 与 JSON error.message 不拆分或压缩指导。

ownership/权限、无关 listener、认证、配置及启动失败返回具体事实和对应修复方向；不把所有错误替换成通用 stop 建议，也不隐藏更具体的失败。

### 3. 复用既有安全控制，不增加恢复编排

恢复动作由用户或 AI 按可见消息执行，不由 query/status 自动执行。`backend stop --if-idle` 继续在既有 lifecycle lock 内检查私有 activity 和 task lease，只在可证明 idle 时停止已验证 lifecycle。active/unknown 返回 deferred，保持实例、记录和长任务不变。随后不后台轮询、退避重试或强停；未经用户明确同意不得退化成普通 stop。

只有 stopped 才调用 start，启动成功才重新执行原命令；发生新的错误则按该具体错误处理，不伪造成功。原查询参数和模式不变，不自动 fallback 到 keyword，不重放已提交的业务操作。只读状态仍不启动或停止进程，现有按需启动入口仍按原合同工作。

lease acquire/renew/release、模型准备 activity、index operation activity 和既有身份验证均保留，不以错误策略删除为由删掉安全机制。

## Validation and Documentation Gate

集中回归覆盖 query、model status/load、index status/build/rebuild/operation、backend start/status 的 build/protocol mismatch；同一 message 的 text/JSON、无策略字段、保留 resource/diagnostics；unavailable 与 ownership/listener/auth 具体失败；guarded stop 的 idle、active lease 和 unknown activity。

真实隔离 smoke 必须记录原命令失败→stop --if-idle 返回 stopped→旧实例确实退出→start 新实例→原命令真实结果或 preparing，同时证明 active lease 的 deferred 不触碰进程、不自动重试。不能仅用 JSON fixture 或替代命令宣称原命令恢复成功。smoke 通过后更新维护者合同、双语指南与六份 Skill reference，再运行相关回归及文档/OpenSpec 验证；完成证据记录在 tasks.md 中。

## Risks / Trade-offs

错误码适合机器分支，message 面向人及 AI 执行动作；删除策略是公开错误 schema 变化，必须端到端迁移。另一个任务 active 时当前调用可能暂时无法完成，这是安全拒绝而不是后台恢复承诺。历史旧提案保留为被替代记录，不用于描述当前方向。
