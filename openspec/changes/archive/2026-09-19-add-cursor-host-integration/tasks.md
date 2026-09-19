## 1. CLI Hook ABI

- [x] 1.1 扩展 `packages/cli/src/hook/host-hook.ts`：`HostHookName` 加入 `"cursor"`；按 host 解析受支持事件字面量（codex/zcode 为 `"SessionStart"`，cursor 为 `"sessionStart"`）；`buildHostHookResponse` 按 host 输出对应 envelope（codex/zcode 维持 `hookSpecificOutput`，cursor 输出顶层 `{ "additional_context": ... }`）；`hostLabel` 加 Cursor 分支；降级输出保持单行 `{"continue":true}` + 退出码 0 + 诊断在 stderr。
- [x] 1.2 新增 `packages/cli/src/hook/cursor.ts`（与 codex.ts/zcode.ts 同构薄包装）与 `cursor.test.ts`；单测覆盖：`hook cursor` 调用解析、`"sessionStart"` 正常路径输出顶层 `additional_context`、不支持事件、畸形 stdin、Store 故障降级、`--store-root` 透传。
- [x] 1.3 在 `packages/cli/src/main.ts` 注册 cursor 分派、`packages/cli/src/index.ts` 导出；确认现有 codex/zcode 测试零变化（`bun test packages/cli/src/hook`）。

## 2. Plugin artifact 与注册

- [x] 2.1 新建 `plugins/cursor/lorelum/.cursor-plugin/plugin.json`（`name: "lorelum"`、`version` 与发布版本一致、`description`、`license: "Apache-2.0"`、`homepage`、`repository`、`keywords`；无 `mcpServers`）。
- [x] 2.2 新建 `plugins/cursor/lorelum/hooks/hooks.json`：全局 `"version": 1`、`sessionStart` 事件、`"command": "lore hook cursor"`（PATH 裸 `lore`，无插件内脚本、无 `${CURSOR_PLUGIN_ROOT}`）。
- [x] 2.3 宿主化 `plugins/cursor/lorelum/skills/lorelum/SKILL.md` 与 `skills/lorelum/references/semantic-query-recovery.md`：Catalog 段改为「可见才复用、缺失则 list 一次」的条件语义；逐条对照 `docs/development/skill-guidance-fixtures.md` 校对检索纪律。
- [x] 2.4 新建 `plugins/cursor/lorelum/commands/lore.md`（保留 `/lore` 入口，文件内注明 `$ARGUMENTS` 替换待真机确认）、`assets/lorelum-icon.svg`、`README.md`、`scripts/hooks-config.test.ts`、`scripts/marketplace-config.test.ts`。
- [x] 2.5 新建仓库根 `.cursor-plugin/marketplace.json`：`name: "lorelum-plugins"`、单一 `lorelum` 条目、`source: "./plugins/cursor/lorelum"`；entry `version` 与 manifest `version` 一致（spec 按「参与更新检测时」限定 MUST，实现测试按无条件相等断言，强于 spec 下限）。
- [x] 2.6 扩展 `plugins/scripts/plugin-layout.test.ts`：加入 cursor 的产品 ID / source root / 版本一致性断言与「任一 registration 不得声明其他宿主 artifact」断言；保留并保持现有 codex/zcode 断言原样。

## 3. 文档

- [x] 3.1 新增 `apps/site/content/docs/cursor.mdx` 与 `cursor.zh.mdx`：安装（公开 marketplace 与仓库本地两条路径）、首次使用验证、更新、排障；中英事实与步骤一致。
- [x] 3.2 更新 `apps/site/content/docs/agent-setup.mdx`/`agent-setup.zh.mdx` 宿主选择表与 `meta.json`/`meta.zh.json` 导航；README 中英文 Connect your agent 表的 Cursor 行改为 Official Plugin。
- [x] 3.3 更新 `docs/development/plugin-conventions.md`（hostKey 枚举、Cursor 注册文件、示例链接）与 `plugins/README.md`（Host 表加 Cursor 行）。

## 4. 验证与交付

- [x] 4.1 运行门禁：`bun run lint`、`bun run typecheck`、`bun test packages/cli/src/hook`、`bun test plugins/scripts`、`bun test` 全量 0 退出；`bun run fmt:check` 在本 Windows CRLF 检出为已知基线环境红（干净主检出同样红），本次涉改 .ts 文件经 LF 归一化后 oxfmt --check 全部通过。
- [x] 4.2 运行 `openspec validate add-cursor-host-integration --strict`；对照 issue #208 检查六步 Proposed direction 与本 tasks.md 的一致性。
- [x] 4.3 产出 `.tmp/manual-verification-checklist.md`，至少覆盖：真实 Cursor 会话 smoke（`sessionStart` 注入、模型引用 Catalog 文本）、Windows 下 hook `command` 执行方式实测（裸 `lore` 能否解析）、本地安装流验证（`~/.cursor/plugins/local` 放置真实副本安装，注意符号链接仅在目标位于该目录内时生效的限制）、`$ARGUMENTS` 是否替换、Cursor CLI 是否加载 plugin hooks/skills；并在 PR 描述单列「待人工验收」。
- [x] 4.4 检查完整 staged diff：无 secrets、无生成物、`.tmp/` 不入库；提交为 Conventional Commits 并引用 #208；**PR 不直接创建**，产出 PR 标题与正文草稿（含 PR 模板要素）交用户审查，通过后才能提交。

> 2026-09-18 执行记录：4.3 的交接清单已产出（`.tmp/manual-verification-checklist.md`），其中 6 项真机验证均**未执行**，PR 合并前须由人工完成。4.4 的 PR 已按要求暂缓创建：提交保留在本地分支 `feat/cursor-host-integration`，PR 标题与正文草稿见 `.tmp/pr-draft.md`，待用户审查通过后再行创建。
