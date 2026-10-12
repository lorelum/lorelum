## Why

Issue #227 暴露的是跨命令的 Backend mismatch 错误恢复指引不完整：query、model、index 与 Backend 命令面对同一实例不匹配，用户或 AI 却不能仅凭错误完成安全恢复。继续传播结构化恢复策略只会增加调用方编排负担，不解决消息本身缺少下一步的问题。

用户已批准简单可执行错误方案。本 change 保留目录名作为既有规划入口，但完全替代原受管理升级接管设计；不修改安装器。

## What Changes

- **BREAKING**：端到端删除 compatibility recovery policy 的构造、参数、传递与公共字段；不将策略换名放进 details、hint 或其它字段。
- 保留现有错误码，用同一个完整 message 告知 text 与 JSON 调用方原因和下一步；保留 diagnostics 与独立的 resource failure 信息。
- build/protocol mismatch 提示执行 `lore backend stop --if-idle`；只有返回 stopped 才执行 `lore backend start`，然后重试原命令。
- guarded stop 返回 deferred 时安全拒绝：保留运行实例，不后台退避重试，不在没有用户明确同意时改用普通 stop 或强制终止。
- query、model/index 状态与 backend status 不因 mismatch 自动停止进程；复用现有 idle 检查、身份验证与 task lease。
- 用真实 stop→start→原命令重试 smoke 和集中回归证明可用性，之后再同步维护者合同、双语指南与 generic/五宿主 Skill references。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `backend-runtime`：跨命令一致的可执行 mismatch/unavailable 错误与 guarded stop 安全拒绝。
- `retrieval-query`：原语义查询按错误消息安全恢复，不隐式停止、不自动 keyword fallback。

## Impact

- Backend error 默认消息和 supervisor 中过时恢复策略；CLI error envelope、rendering 与所有错误调用方。
- Backend/query/model/index 集中回归与隔离真实生命周期 smoke。
- 相关 CLI 合同、中英文用户文档及 Skill references。
- 不改安装器、发布工作流、模型/index resource 合同、持久化、runtime authority 或既有锁；不新增 receipt、coordinator、registry、callback、重试器或接管架构。
- 本方案替代 `differentiate-backend-compatibility-recovery` 的结构化自动恢复方向，保留其错误码区分、ownership、guarded stop 与 lease 安全边界；不替代既有安装分发合同。
