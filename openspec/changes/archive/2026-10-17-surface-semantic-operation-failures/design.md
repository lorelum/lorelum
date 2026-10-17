## Context

见 proposal.md。当前 persistent target runtime 已在 `packages/backend/src/modules/query/content-addressed-semantic-runtime.ts` 将 operation rejection 写为 journal `failed`，但 journal schema（`project-operation-journal.ts`）未保存公开错误码；`queryTarget()` 等待时吞掉 task rejection，`pending()` 仅识别 `preparing`，因此会把已失败记录返回为 indexing。`IndexOperation` schema 已允许 `embedding.*`、Store code 与 `backend.failed`（`packages/backend/src/modules/index/model.ts`），但当前 record-to-result 映射固定使用 `backend.failed`。

现有 `EmbeddingService` 已保留“failed 后不自动重试、显式 `model load` 才重试”的生命周期边界（`packages/backend/src/modules/embedding/service.ts`）。本变更只修复已确认终态的观察和错误传播。

## Goals / Non-Goals

**Goals:**

- 使 query、index operation 与 operation journal 对同一个 terminal failure 给出一致、无敏感信息的稳定错误码。
- 明确 pending 只适用于非终态 operation，保持 `maxWaitMs: 0` 的非阻塞提交语义。
- 为 preparation 失败、重复 query、legacy journal 与显式恢复后的新 attempt 建立回归保护。

**Non-Goals:**

- 不修改下载源、模型文件校验、native runtime 启动、超时值或 embedding profile。
- 不让普通 query 自动执行 `model load`、自动重试失败模型或降级到 keyword。
- 不把异常 stack、下载 URL、文件路径或 Practice 内容写入 journal 或公开协议。

## Decisions

### 1. 为终态 operation 保存受限的 public error code

operation journal 的 `failed` record 新增可选的稳定 error code。写入路径只允许 index operation 协议已声明的 `embedding.*`、`store.busy`、`store.recovery-required` 和 `backend.failed`；未知异常统一归类为 `backend.failed`。这样恢复和 `lore index operation` 无需读取或重新执行已失败工作，也不会保存私有异常信息。

不选择持久化完整 exception 或模型状态快照：它们可能包含路径、来源或实现细节，且不能作为跨 daemon 的稳定协议。也不选择只在内存保留错误：daemon restart 后会再次使已确认 failure 变得不可解释。

### 2. 用 operation 的终态而不是 progress 猜测 query 状态

query 在观察预算内或构造 pending response 前读取 operation 状态。`waiting-for-source`、`queued`、`preparing` 与 `building` 才可映射为 pending；`ready` 继续走 current artifact 查询；`failed(error)` 立即转换为对应 typed public error。这样 query 在同一 operation 已失败时不再以 progress count 构造 indexing。

不选择把 operation failure 变成空结果或重新开始 model preparation：两者都会模糊错误和破坏现有“显式 `model load` 才重试”的模型生命周期。`maxWaitMs: 0` 仍然只表示不额外等待：若尚未观察到终态，仍可返回 indexing；若终态已记录，则返回 error。

### 3. 已显式恢复的模型可以创建新的 operation

failed record 是旧 attempt 的终态，不是永久 target poison。普通重复 query 在 model 仍 failed 时读取并报告同一失败，不得制造无提示循环；用户显式 `model load` 成功后，下一次 query/build 可以创建新 operation 并正常完成。该判断沿用现有 operation coalescing：只复用 non-terminal work，不复用 terminal failure。

### 4. 端到端验证错误 envelope，而不是只验证 journal state

Backend runtime test 使用可控的 `EmbeddingError` 重现“accepted → preparation failure → failed”；journal/index-operation test 验证稳定码和 legacy fallback；query controller/CLI tests 验证 `ok:false`、exit `2`，没有 indexing/retry 文案。现有非终态、partial coverage 和 zero-wait tests 保持，避免把合法后台进度改成同步失败。

## Risks / Trade-offs

- [旧 journal 没有 error 字段] → 读取时安全降级为 `backend.failed`，不迁移或删除历史 record。
- [稳定错误码被错误地映射为私有异常] → 用 protocol allowlist 集中分类；未知值统一 `backend.failed`。
- [修复使零等待 query 过度同步] → 明确只在读取到 terminal failure 时失败，新增 zero-wait race 回归测试。
- [失败后永久无法恢复] → 测试显式 model recovery 后的新 operation 可以 ready，保持 terminal record 与 active operation 的分离。

## Migration Plan

1. 部署兼容的 journal schema：缺失 error 的旧 failed record 继续读取为 `backend.failed`。
2. 发布前执行 focused Backend/CLI tests、OpenSpec strict validation、typecheck、lint 与 format check。
3. 回滚代码时，新增 journal 字段被旧 reader 忽略或按既有严格 schema 安全处理；不删除模型、Store、artifact 或 operation 文件。
