## 实施与验收

- [x] 1. 删除 BackendError、CliError、failure envelope、RenderableResult 及所有调用方的 compatibility recovery policy，补全跨命令一致的可执行 message；text/JSON 同文，保留 diagnostics 与独立 resource failure 合同。
- [x] 2. 完成 query/model/index/backend focused regression 与隔离真实 error→stop --if-idle→start→原命令重试 smoke；证明 stopped/旧实例退出/原结果或 preparing，以及 active/unknown deferred 不停止、不后台重试、不未经明确同意强停，具体 ownership/listener/auth/unavailable 错误与模型资源信息保持。
- [x] 3. smoke 成功后同步 CLI 合同、中英文用户指南、generic 与五宿主 Skill references，清理旧策略指引；完成集中回归、相关合同和 OpenSpec strict 验证并记录实测证据，未运行不勾选。

## 实测证据

- macOS arm64：临时 runtime、Store、随机 loopback 端口，真实 daemon 与现有 native 模型。build/protocol 两种 mismatch 各覆盖 backend start/status、model load/status/unload、index status/build/rebuild/operation 和 query，共 20 次错误调用；原 daemon 保留，text/JSON 指引一致，无 compatibility recovery policy。
- 按消息执行 `backend stop --if-idle`、`backend start` 后，确认旧进程退出、新实例生效；真实 model load、index build/rebuild、operation 查询、semantic query 返回已安装的 fixture Practice，model unload 成功。旧 operation ID 返回 `backend.operation-expired`，未冒充恢复。
- 有效 task lease 与缺失 activity 时，guarded stop 拒绝终止；无关 listener 返回具体 port conflict，服务仍可访问。Backend 停止后的 model status 返回 unavailable 和启动指引，启动后原状态读取成功。
- `bun test packages/cli packages/backend`：684 pass、6 skip、0 fail；`bun run typecheck`、`bun run fmt:check` 与本地固定 OpenSpec 1.7.0 的 strict 验证通过；`bun run lint` 通过，4 个 warning 位于未修改的 update/log 文件。
- 临时 smoke 脚本、daemon、runtime 与 Store 已清理。Windows 未实测；安装器、停止权限及进程终止机制未改动。
- 首次 Linux CI 在 project query 的 1 秒完成假设处失败（run 38269008691）。测试改为显式阻塞 embedding，断言 indexing，再释放并等待任务完成、断言 complete，生产逻辑和 timeout 不变。修复后目标文件 8 pass；macOS 按 CI 命令 `bun test --parallel=4 --max-concurrency=3` 全仓库 1292 pass、19 skip、0 fail，typecheck/lint/fmt 再次通过。
