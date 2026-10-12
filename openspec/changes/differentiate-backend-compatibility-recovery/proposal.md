> 本提案的结构化自动/等待恢复策略已由 `complete-managed-backend-upgrade-cutover` 的用户批准修订替代：删除 compatibility recovery policy，改用完整错误消息与 `backend stop --if-idle` → stopped 后 `backend start` → 原命令重试。deferred 不后台重试、不未经明确同意强停。下文仅保留历史提案背景；错误码区分、ownership、guarded stop 和 task lease 安全边界继续保留，不代表实施状态或验证已完成。

## Why

当前 `backend.incompatible` 将已验证的 build mismatch 与 protocol mismatch 混为同一错误。不同 source worktree 的绝对路径参与 build identity，即使处于同一 commit 也会频繁触发前者；调用方因此既不知道能否安全恢复，也不能在不打断另一项工作的前提下帮助用户继续。已完成的安装器升级会在替换命令入口前关闭旧 Backend，但旧安装器、手工替换或中断升级仍可能留下旧 daemon；新版 CLI 不应要求用户找回已删除的旧 CLI 才能恢复。

本 change 引入新的产品行为：为两类不兼容提供不同、可机读且可恢复的结果，同时保持普通 query 不会隐式停止其他 Backend。

## What Changes

- **BREAKING**：当已验证的 daemon 与当前 CLI 仅 build 不同且内部 protocol 兼容时，以 `backend.build-mismatch` 代替笼统的 `backend.incompatible`；当内部 protocol 不兼容时，以 `backend.protocol-mismatch` 返回。
- 两种 mismatch error MUST 在既有 JSON error envelope 中提供结构化 recovery：Agent 可机读地获知 Backend 是否处于可安全 handoff 的 idle 状态、可自动执行的 `backend stop --if-idle` 动作或必须等待的原因，以及成功后应重试原命令。
- `lore backend stop` 保持 protocol-compatible 的 authenticated graceful stop；在 protocol mismatch 时，新版 CLI MUST 使用受保护 runtime record 和精确进程身份直接终止已拥有的旧 Backend 生命周期。它先尝试 graceful termination，超时后强制终止同一已验证的 daemon 生命周期；这是同一次显式 stop 的完成语义，不要求已经被替换的旧 CLI，也不要求第二次确认。
- Backend 必须维护私有的 activity/ownership lease，覆盖模型准备、index operation 和 host Agent 声明的长时程任务。支持的 host Agent 集成 MUST 在启动 Lorelum 相关长时程任务前获取并续约 lease；当 recovery 标记为可自动 handoff 时，它 MUST 自动执行 `backend stop --if-idle` 并重试，而不是询问用户。activity 为 active 或 unknown 时 MUST 不终止，而是在后台等待 activity 结束后重试。query、index、model、start 与 status 不得盲目终止其他 Backend，也不得降级为 keyword query。
- 不新增依赖、监听地址、MCP 接口，且绝不按端口、进程名或未经验证的 PID 终止进程；不扩大到多实例/worktree 并发运行。
- 更新 query / Backend CLI 合同与用户文档，并补充 client、coordinator、CLI JSON envelope 及真实 daemon 的回归测试。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `backend-runtime`: 区分经过认证的 build mismatch 与 protocol mismatch，保留严格身份边界，并让当前 CLI 在显式 stop 时收敛一个经过验证的旧 protocol Backend。
- `retrieval-query`: 为 semantic query 规定由 activity/ownership 决定的结构化自动 handoff、等待和重试语义，禁止打断长时程任务。

## Impact

- `packages/backend/src/client/client.ts`、`packages/backend/src/protocol/errors.ts`、runtime supervisor/process control、相应 client/supervisor/coordination 测试。
- `packages/cli/src/query/`、CLI error envelope、Backend control command 的 error allowlist、JSON envelope 测试及 `docs/cli/{query,backend}.md`。
- 不新增依赖、监听地址、MCP 接口或 runtime data migration。
