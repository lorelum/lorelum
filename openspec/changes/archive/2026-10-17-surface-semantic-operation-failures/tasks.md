## 1. Persistent terminal failure state

- [x] 1.1 扩展 semantic operation journal 的 `failed` record 与兼容读取逻辑，持久化 allowlisted public error code、将旧无 error record 降级为 `backend.failed`，并以 journal tests 验证不泄露私有异常数据。
- [x] 1.2 更新 content-addressed semantic runtime 的 failure 分类与 `indexOperation` 映射，使 `embedding.*`、Store code 和未知失败分别返回规定的稳定 error；以 runtime tests 验证 operation lookup 的 terminal failure 不会变回 pending。

## 2. Query and index observation

- [x] 2.1 修改 semantic query 的 observation/pending 分支：已确认 failure 必须抛 typed public error，非终态才返回 preparing/indexing；以 runtime tests 覆盖 preparation failure、重复 query、`--max-wait-ms 0` 的 pending/terminal 边界和显式模型恢复后的新 attempt。
- [x] 2.2 补充 query 与 index controller/CLI tests，验证失败输出 `ok: false`、exit code `2`、稳定 error code，且不包含 indexing 或 retry 文案。

## 3. User contract and verification

- [x] 3.1 更新 `docs/cli/query.md`、`docs/cli/index.md` 及对应中英文 site query/index reference，说明 indexing 只表示非终态 operation、已确认失败返回 error 并保留既有恢复入口；验证示例与 schema 一致。
- [x] 3.2 运行 focused Backend/CLI tests、`openspec validate surface-semantic-operation-failures --strict`、`bun run typecheck`、`bun run lint` 与 `bun run fmt:check`；定向格式检查通过，全量 `fmt:check` 仅报告未触及的 `scripts/release/install-ps1.integration.test.ts` 既有格式问题。
