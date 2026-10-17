## 1. 原始 text failure 的 trace

- [x] 1.1 调整普通 CLI text failure 渲染，在保留既有 error/recovery、stderr 路由和退出码的同时显示当前 `diagnostics.traceId`；验证 `--json` envelope 与 raw Codex/ZCode/Cursor/WorkBuddy Hook stdout 不变。
- [x] 1.2 增加 render 与 main 回归测试，覆盖 text error 的可复制 trace、JSON failure 的单行 envelope、同一 trace 写入和 Hook degrade ABI；验证聚焦 `bun test` 通过。

## 2. 受限 Agent 诊断与反馈规则

- [x] 2.1 为 generic、Codex、ZCode、Cursor、WorkBuddy Skill 写入统一的 trace-bounded 诊断状态机：非阻塞候选延后询问，阻塞/明确诊断先读当前 trace，debug 重现与详细 feedback 各自需要相应授权；验证每份 Skill 保留本宿主 Catalog 与 Hook 约束。
- [x] 2.2 扩展 Skill guidance 测试，覆盖五份 Skill 的必需诊断/反馈边界，尤其验证不得自动跨 trace 扫描、预检 runtime、重现、上传或创建 Issue；运行对应 `bun test`。

## 3. 面向用户的排障手册

- [x] 3.1 更新中英文 CLI reference、Troubleshooting 和 Agent reference，提供从原始 error trace 到 `lore logs`、`missingEvidence`、受控 `--debug` 重现和本地 feedback draft 的场景化路径；检查所有站内相对链接及中英文术语一致。
- [x] 3.2 在维护者日志文档中仅增加指向站点排障教程的交叉链接，并保留开发者接入细节在维护者文档；验证用户与维护者内容不重复定义 CLI 合同。

## 4. 集成验证

- [x] 4.1 运行与变更相关的 CLI、Hook、Skill、文档测试以及 `bun run typecheck`、`bun run lint`、`bun run build:cli`，区分并记录任何既有基线失败。
- [x] 4.2 运行 `openspec validate add-trace-aware-diagnostic-recovery --strict`，并在最终 diff 上执行格式和敏感信息检查；确认所有新增公开行为、文档和测试与 proposal/spec/design 一致。
