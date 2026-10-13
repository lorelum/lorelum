# Tasks

以下为已批准提案的实施清单，当前均未实施。行为与范围以 `product.md`、两份 delta spec 和 `design.md` 为准。

## 1. CLI Catalog ABI

- [ ] 1.1 新增 `packages/cli/src/hook/pi.ts`，接入共享 host dispatch、renderer、Store-root resolver 与 `main.ts` 路由/必要导出，只支持 `session_start`/`session_compact`；添加 colocated `pi.test.ts`，以 `bun test packages/cli/src/hook/pi.test.ts packages/cli/src/hook/pack-catalog.test.ts` 验证成功、空 Store、有界输出和两种事件。
- [ ] 1.2 补充 Pi 畸形输入、未知事件、Store 故障、参数错误和隔离 `--store-root` 测试，明确 `{}`/stderr/exit 0 只用于 ABI 降级；运行 `bun test packages/cli/src/hook` 验证其他宿主 envelope 与 tracking 行为无回归。
- [ ] 1.3 更新 `docs/cli/hook.md` 和必要 CLI 索引，说明 Pi envelope 是 Extension adapter 合同而非 Pi shell Hook schema；使用当前 worktree source CLI 和独立 `--store-root` 执行文档里的两个 payload 示例，核对一行 JSON、预算与不启动 Backend。

## 2. Pi Package and Lifecycle

- [ ] 2.1 创建 `plugins/pi/lorelum/package.json`、显式 Extension/Skill resource paths 和维护者 README 导航；加入配置/layout 测试，验证产品身份、单入口、辅助文件不被发现、其他 marketplace 未注册 Pi，运行 `bun test plugins/scripts plugins/pi/lorelum`。仅使用宿主 peer/types，不 bundle；新增开发依赖前核查其版本、许可证和传递依赖，不添加运行时依赖。
- [ ] 2.2 实现 stdin CLI helper 与 colocated mocked-process 测试，覆盖 cwd、固定 argv/payload、Windows shim、缺 executable、非零退出、5 秒截止、取消、输出上限和终止竞争；运行其 focused `bun test`，证明失败不挂起、无未终止的受控子进程且不污染 stdout。
- [ ] 2.3 实现 `session_start`/成功 `session_compact` 刷新、`context` 自有消息幂等投影和 shutdown 清理；用 colocated 事件/消息测试覆盖每种 session reason、compact 成功/失败、旧快照失效、tree 复用、tool pair 顺序与一次请求一个 Catalog，验证普通请求没有 CLI 调用、正文读取或额外 turn。
- [ ] 2.4 覆盖 CLI 缺失/旧版/Store/畸形/超时/空结果的交互提示和非交互降级测试，并更新 `docs/development/plugin-conventions.md`、`plugins/README.md` 的 Pi Package 与生命周期边界；验证文档相对链接、同一失败不逐模型请求重复提示，恢复动作与 `product.md` 一致。
- [ ] 2.5 为 Pi TS 添加独立 typecheck 配置并接入 `scripts/ci/typecheck.ts` 及对应测试，使用实际宿主公开类型而不是手写削弱的 API stub；运行 focused typecheck 与脚本测试，确认 Extension/辅助模块/测试都被静态检查。

## 3. Skill and User Guidance

- [ ] 3.1 添加 Pi `skills/lorelum/SKILL.md` 和所需 recovery references，以 portable core 适配可见/缺失 Catalog 与 `/skill:lorelum`；扩展 `docs/development/skill-guidance-fixtures.md` 的 Pi 场景并按场景走查，新增可执行 Skill 配置/指引回归测试，覆盖 targeted query、get 全文、preparing/error 恢复、无自动 keyword fallback 和同 trace 排障。
- [ ] 3.2 新增 `apps/site/content/docs/pi.mdx`/`pi.zh.mdx`，更新 Agent 入口及双语导航，落地 `product.md` 的原生 local 安装、信任、首次使用、更新、reload、空 Store、故障与移除路径；运行站点相关文档检查/构建并核对所有命令与两种语言行为一致，不将未实现能力写成已支持。

## 4. Integrated Acceptance

- [ ] 4.1 用实际 Pi runtime 和受控 provider/CLI fixtures 建立自动 threshold 与 overflow compact-and-retry 验证，捕获内部 continuation 请求，断言无需新用户 turn 也恰好一份 Catalog；同时覆盖普通 retry、手动 compact、压缩失败/取消和 session replacement，不以只触发 handler 的 mock 测试代替，记录 Pi 版本与 focused 验证命令。
- [ ] 4.2 执行 `bun run build:cli`，使用完整 `dist/release/<target>/` CLI 与匹配 native runtime、独立 Store 和正常 Pi 本地 Package 安装走 `product.md` 端到端路径；记录首次目录、显式 Skill semantic query/get、恢复/reload、个人与项目 trust、缺 CLI/空 Store、更新及移除后 CLI/Pack 不受影响的实际结果。模型/平台条件缺失时如实记录未验项，不能将运行支持宣布完整。
- [ ] 4.3 运行 `bun test packages/cli plugins`、相关 guidance/runtime 测试、`bun run lint`、`bun run fmt:check` 和 `bun run typecheck`；审阅完整 diff/status 与文档边界，确认没有 Backend host/tracking、MCP、发布流程、无关修改或私有运行输出，按结果更新任务状态并准备包含成功/失败证据与未验限制的 PR 说明。

## Workflow follow-up

- 提案已通过评审并获用户批准，进入 apply；实施使用独立开发分支，不直接提交 main。
- 用户请求完成 PR 不等于授权 npm 发布、部署或合并。本提案不修改 release/publish 步骤。
- 实施与 review 完成后，按用户授权完成 Git/PR 操作；每次 commit/push 前检查 staged diff 和敏感数据。
