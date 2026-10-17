## 1. Store-root discovery boundary

- [x] 1.1 在 Engine ProjectContext resolver 中以 selected StorageRoot 的规范化路径阻断自动 ancestor discovery，并让显式 Store root 使用既有 invalid-project-root failure；以 resolver tests 覆盖默认形态、custom store root、边界以下有效 child layer、父子继承与不越过 Store root。
- [x] 1.2 为 Store root shared config 与嵌套 Pack artifact 增加 regression fixtures，验证它们不再产生 synthetic `config.invalid`/`pack.invalid`/degraded context，且不移动、写入或清理 Store 数据。

## 2. Shared CLI routes

- [x] 2.1 补充 `context status`、keyword/semantic query、get 与 index 的 focused CLI/integration tests，验证 selected Store root 边界、路径上完全没有 `.lorelum` 的普通目录自动 Store-only、显式 Store root usage error、合法 project layer 保留及 `--no-project` 的既有行为。
- [x] 2.2 确认 Backend project target 继续使用共享 resolver 结果，且 Store boundary 不创建 ProjectContext cache 或后台 operation；以 protocol/runtime route tests 验证。

## 3. User contract and verification

- [x] 3.1 更新 `docs/cli/query.md` 与相应中英文 site query reference，说明 ProjectContext 只来自有效项目层、selected Store 不是项目来源，并验证链接和示例保持正确。
- [x] 3.2 运行 focused Engine/CLI/Backend tests、`openspec validate exclude-global-store-from-project-context --strict`、`bun run typecheck`、`bun run lint` 与 `bun run fmt:check`，记录任何与当前变更无关的基线失败。
