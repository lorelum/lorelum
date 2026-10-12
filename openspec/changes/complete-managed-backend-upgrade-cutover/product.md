# AI 可以直接按错误消息安全恢复

本文描述本 change 的错误恢复行为；本地实施与验收结果见 [tasks.md](./tasks.md)，不代表已经合并或发布。

## 原命令遇到实例不匹配

用户或 AI 先执行真正需要的命令，不预检 Backend/model/index。query、model、index 与 Backend 命令遇到 build/protocol mismatch 时，错误说明实例与当前 CLI 不匹配，并在同一条 message 中给出完整步骤：

1. 执行 `lore backend stop --if-idle`。
2. 仅当 data.state 为 stopped，执行 `lore backend start`。
3. 启动成功后重试原命令，保留原参数、query 文本及检索模式。

默认 text 与 JSON error.message 使用同一完整消息。JSON 保留 error.code、适用时的 error.resource 与 diagnostics，但不提供恢复策略对象。Agent 无需根据自动/等待标签再设计恢复流程。

## 另一个任务仍在运行或无法判断 activity

`stop --if-idle` 返回 deferred 及 active-long-task/unknown-activity 原因时，不停止实例、不删记录、不取消任务。AI 说明安全拒绝和阻碍，继续不依赖该 Backend 的工作或等待用户下一步；不启动后台重试、轮询或退避队列，不自行改成普通 `backend stop`。只有用户明确同意中断工作时，才允许按现有显式 stop 合同执行；拒绝本身不代表恢复成功。

支持的宿主继续维护 Lorelum 长任务的 acquire/renew/release lease；模型准备和 index operation 的 activity 仍受保护。

## Backend 尚未运行

对于返回 backend.unavailable 的命令，消息提示 `lore backend start` 后重试原命令。只读状态不会为了恢复而自动启动或停止进程。semantic query 仍保留既有按需启动及 preparing 行为，本方案不扩大 model/index 其它命令的启动语义。

## 具体故障不能被泛化建议掩盖

无关 listener、runtime record 权限或 ownership 不可信、认证失败及配置问题必须返回具体错误和针对性的修正方向，不指示必然再次失败的 stop，不误杀服务，不泄露 secret。

模型/native resource 验证失败仍携带安全 resource 信息（逻辑文件、check、可用时的 expected/actual size 或 digest）。移除 compatibility policy 不删除 resource，也不把模型文件问题说成 Backend mismatch。index operation 与模型/index 状态语义保持不变。

## 验收是实际恢复，不是字段存在

在隔离 runtime 与 Store 中观察原命令真实 mismatch、guarded stop 的 stopped、旧 daemon 退出、新 Backend start、原命令的真实结果或 preparing；另验证 active lease 的 deferred、实例仍存活且没有自动 stop/start/retry。只有 smoke 成功之后才同步用户文档。安装器、用户数据、Pack、Practice、模型缓存及配置均不改变。
