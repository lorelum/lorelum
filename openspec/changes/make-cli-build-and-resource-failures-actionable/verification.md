# 本地验证记录

基线：`a78bada`；macOS arm64；Bun 1.4.2。源码和构建测试在当前 worktree 执行；真实 smoke 使用本机用户级 Backend 与已安装 Packs，未更改全局 `lore` 链接、未清理或替换固定模型文件，也未接触发布资源。与其他 build 冲突的 Backend 只在 `stop --if-idle` 返回 `stopped` 后切换；测试 Backend 最后也通过该命令停止。

- `bun test packages/backend packages/cli`：686 pass、6 Windows 平台 skip、0 fail；启动探测期间 native 资源被替换的回归测试确认保留专用错误和资源详情。
- `bun test scripts/release/build-entrypoints.test.ts scripts/release/package.test.ts scripts/release/compile-cli.test.ts`：9 pass、0 fail。
- `bun run typecheck`、`bun run lint`：通过；lint 有 4 条未改文件的既有 warning。
- Site：41 tests pass，typecheck 和 production build 通过；构建预渲染 66 页。
- 在启动探测错误传播修正后重建 `bun run build:cli`：native cache hit，完整目录包含 `lore`、匹配的 manifest 和 `lore-model`；直接运行该 CLI 的 `model load --json` 得到 `state: ready`，真实 query 返回 `mode: semantic`、`coverage: complete` 和结果。
- 同一修正后重建 `bun run build:cli-only`：只生成 `dist/lore`；启动该编译版 Backend 后，`model load --json` 不出现下载阶段，返回 `embedding.native-resource-invalid` 与 `native/darwin-arm64/manifest.json` / `missing`；后续 query 错误和 model status 保留同一 code、resource 与恢复提示。
- 改动的 TypeScript/JSON 通过定向 `oxfmt --check`，`git diff --check` 和 OpenSpec `--strict` 均通过。全仓 `bun run fmt:check` 仍因 13 个未改文件已有格式问题失败；没有对它们执行批量重排。

这是本地 macOS arm64 源码、构建及真实 Backend/Pack 验收；尚不代表其他平台或 PR CI 结果。
