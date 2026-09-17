## Why

Issue #192：Windows x64 发布包内的 `llama-server.exe` 对一切非 daemon 调用静默退出（exit 0、零输出），语义索引永远无法完成。本机实验已证实根因：parent-liveness 补丁无条件启动 stdin 监视线程，把任何 stdin EOF/读失败当作 owner 死亡并 `_Exit(EXIT_SUCCESS)`，与服务器启动过程竞态且必败。该机制为 daemon 设计（daemon 持有 stdin 管道，EOF 即 owner 死亡，需绕过可能卡死的清理），但被无条件应用到了所有调用方式。这是既有行为的实现缺陷修复，同时把隐式机制收拢为显式 opt-in 契约；因涉及 native artifact 行为契约与信任锚更新，按 OpenSpec 流程提交。

## What Changes

- parent-liveness 补丁改为 opt-in：仅当 spawn 环境显式携带 `LLAMA_PARENT_LIVENESS_STDIN=1` 时启动监视线程；无该变量的调用恢复标准 llama-server 行为（`--version` 输出版本、server 模式正常启动、退出码与输出反映真实结果）。
- Backend daemon 拉起 embedding runtime 时显式携带该环境变量，daemon 侧 owner-death 快速退出语义（绕过卡死清理）保持不变。
- `scripts/native/test-parent-liveness.ts` 三种既有 mode 显式设置 opt-in 变量，并新增"无 opt-in 直接运行不受 stdin EOF 影响"的验收断言。
- Backend 单元回归：embedding runtime 启动即静默退出（exit 0、零输出）MUST 被归类为稳定终态失败（既有 `embedding.failed` 有界重试语义），而非 deadline 挂死；daemon spawn 环境携带 opt-in 变量成为被测契约。
- 配方与信任锚更新：`build-config.json` 补丁摘要更新；重建 win32-x64 candidate 后按信任锚流程显式更新 `win32-x64.json`；同步更新 `darwin-arm64.json` 与 `linux-x64.json` 的 `patchSha256`/`recipeIdentity` 身份字段（文件哈希保持各平台最近一次验证构建，待平台重建时更新）。
- 不改变模型准备、下载、重试策略与 keyword fallback；不新增网络面或依赖。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `native-runtime-artifact`: 新增 parent-liveness opt-in 契约——未经 opt-in 的调用 MUST 不基于 stdin 退出；daemon opt-in 场景保留 owner-death 快速退出。
- `backend-runtime`: 新增 daemon 拉起 embedding runtime 的 liveness opt-in 义务，及启动即退出场景的终态失败分类（记录既有可观察行为 + 新增 env 传递）。

## Impact

- `native/embedding/patches/0001-exit-on-parent-stdin-close.patch`、`native/embedding/build-config.json`（补丁摘要）。
- `packages/backend/src/runtime/embedding-process.ts`（spawn env）、`packages/backend/src/runtime/embedding-process.test.ts`（回归测试）。
- `scripts/native/build-embedding.ts` 无需改动（身份计算自动反映新补丁摘要）；`scripts/native/test-parent-liveness.ts`（env 设置 + 新断言）。
- 信任锚 manifest：`packages/backend/src/runtime/native/embedding/win32-x64.json`（本机重建后完整更新）、`darwin-arm64.json`、`linux-x64.json`（仅身份字段）。
- 发布语义不变：compiled release 仍要求 on-disk manifest 与编译内嵌 manifest 精确一致，由既有发布流程在平台重建时更新文件哈希。
- 中英用户文档预计不需变更（无用户可见指引变化）；维护者文档 `native/embedding/README.md` 的 liveness 描述需同步。
