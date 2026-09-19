# Tasks: add-workbuddy-host

## 1. CLI Hook ABI

- [x] 1.1 扩展 `packages/cli/src/hook/host-hook.ts`：`HostHookName` 联合加入 `"workbuddy"`，`hostLabel` 返回 `"Workbuddy"`
- [x] 1.2 新增 `packages/cli/src/hook/workbuddy.ts`（与 `zcode.ts` 同构的薄包装）
- [x] 1.3 新增 `packages/cli/src/hook/workbuddy.test.ts`（Catalog envelope、三类降级、`--store-root` 解析、宿主互斥）
- [x] 1.4 `packages/cli/src/main.ts` 注册 `hook workbuddy` 分发与 `workbuddyHookServices` 覆盖项
- [x] 1.5 新增 `packages/cli/integration/scenarios/hook-workbuddy.ts` 并挂入 `process.integration.ts`

## 2. WorkBuddy Plugin

- [x] 2.1 新增 `plugins/workbuddy/lorelum/.codebuddy-plugin/plugin.json`（版本 `0.1.0-alpha.3`，`commands`/`skills` 指针，无 `hooks` 字段）
- [x] 2.2 新增 `plugins/workbuddy/lorelum/hooks/hooks.json`（SessionStart，command 型 + `commandWindows` 变体 + fallback + `additionalContextLimit`，matcher `startup|resume|clear|compact`（非锚定，WorkBuddy 逐 token 匹配语义））
- [x] 2.3 新增 `plugins/workbuddy/lorelum/skills/lorelum/SKILL.md` 宿主化副本与 `references/semantic-query-recovery.md`，满足 skill-guidance-fixtures 全部场景
- [x] 2.4 新增 `plugins/workbuddy/lorelum/commands/lore.md`、`assets/lorelum-icon.svg`、`README.md`
- [x] 2.5 新增 `plugins/workbuddy/lorelum/scripts/hooks-config.test.ts` 与 `marketplace-config.test.ts`
- [x] 2.6 新增仓库根 `.codebuddy-plugin/marketplace.json`（`lorelum-plugins`，单一 `lorelum` 条目，版本与 manifest 一致）

## 3. 布局与文档

- [x] 3.1 扩展 `plugins/scripts/plugin-layout.test.ts` workbuddy 断言（身份、source、marketplace 版本一致性）
- [x] 3.2 更新 `plugins/README.md` 宿主表；更新 `docs/development/plugin-conventions.md` 的 hostKey 枚举、示例与 Hook 说明
- [x] 3.3 更新 `docs/development/plugins.md`：WorkBuddy 的验证与 checkout 安装命令
- [x] 3.4 新增 `apps/site/content/docs/workbuddy.mdx` + `workbuddy.zh.mdx`，并更新 `meta.json` / `meta.zh.json` 导航
- [x] 3.5 新增 `apps/site/public/logos/agents/workbuddy.svg`

## 4. 验证

- [x] 4.1 `openspec validate add-workbuddy-host --strict` 通过
- [x] 4.2 `bun test plugins/scripts plugins/workbuddy/lorelum/scripts packages/cli/src/hook` 通过
- [x] 4.3 `bun test` 全量、`bun run typecheck`、`bun run lint` 通过
- [x] 4.4 隔离 Store 冒烟：`lore hook workbuddy` 正常注入 Catalog、异常降级 `{"continue":true}` 且退出码 0
- [x] 4.5 真实宿主验证：WorkBuddy 桌面端 5.5.6 内嵌 CLI + `--plugin-dir`，SessionStart hook 3/3 触发，`additionalContext` 3/3 注入并被模型原句引用；未写任何注册表
- [x] 4.6 Checker 独立复跑全部验收并出具 verdict
