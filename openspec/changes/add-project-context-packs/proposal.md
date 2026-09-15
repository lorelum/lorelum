## Why

团队需要在项目目录直接维护局部 Practice，而当前 `lore` 只能检索用户 LocalStore。把未提交 Pack install 到 Store 会污染全局状态；把 index 写进项目目录则会制造需要提交、忽略或清理的派生文件。把这一能力定义为 Git repository/worktree 又无谓地排除了普通目录，并把内容复用错误地绑定到 Git 身份。

父子目录同时包含 `.lorelum/` 时，最近目录完全遮蔽父级也不符合日常项目配置习惯：子目录应默认继承父级 Pack/config，只覆盖自己声明的部分。semantic query 同时需要在 index 首次构建或增量追赶时，尽量返回已完成 current Practice 的可信 partial result，而不是把准备工作留给用户。

本 change **introduces new product behavior**：任何目录都可通过 `.lorelum/` 形成 ProjectContext；多个 context layer 按父到子合并，cache 按最终 active Practice 语料内容寻址，而非按 Git 或目录身份寻址。

## What Changes

- 新增 directory-based `ProjectContext`：从执行目录或显式 `--project-root` 发现 `.lorelum/` context stack；Git 不是前提，也不参与发现、身份或 artifact 复用。
- 父子 `.lorelum` 默认继承。config 从父到子逐字段合并；子层 Pack source 和同 ID Practice 以增量覆盖方式参与同一 precedence resolver，而不是整包遮蔽父层。`inherit: false` 提供显式隔离。
- Pack metadata/root 无效时忽略该 Pack；单条 Practice 无效时仅忽略该条，其他有效 Practice 与更低优先级 fallback 继续参与 query/get/index，并以 `degraded` 与 provenance 可见。
- 新增用户级、内容寻址的 project artifact/vector cache；任意目录的相同最终语料复用 keyword/semantic artifact 与 embedding vector，cache 不写入项目目录、`.lorelum/` 或 LocalStore。
- 所有 semantic query（Store-only 与 ProjectContext）都在用户级 `query.maxWaitMs` 前台预算内自动提交或加入 index target；完整 index 未完成时，只查询已验证、仍属于 current snapshot 的 progress rows，并返回 partial coverage、indexed/total counts 与 operation。
- **BREAKING:** `lore query`、`lore get`、`lore index` 在可发现 `.lorelum/` layer 时使用合并的 ProjectContext；调用方可用 `--no-project` 保持纯 Store 行为。semantic query 的缺失/过期 index 不再默认要求调用方先执行 index 命令，而会自动开始/加入构建，并可能成功返回 partial result。

## Capabilities

### New Capabilities

- `project-context`: 任意目录的 `.lorelum` layer 发现、父子继承、增量 Pack/Practice 覆盖、provenance 与内容寻址的 derived cache。

### Modified Capabilities

- `retrieval-query`: query 选择 ProjectContext 或 Store-only 语料；semantic query 使用整数毫秒等待预算和 current-progress partial coverage；keyword 保持离线且不静默 fallback。
- `practice-read`: `lore get` 从当前一致的 ProjectContext winner 读取 canonical Practice，同时保留 Store-only escape hatch。
- `semantic-index`: Store 与 ProjectContext 的内容寻址构建、vector reuse、可查询 progress、持久 target queue、source reattach recovery 与新的并发语义。

## Impact

- Engine：新增 ProjectContext layer discovery、config fold、Practice-granular precedence、context snapshot、内容寻址 cache identity 与 candidate validation。
- Config/CLI：新增项目层 config schema、`lore init`、`--project-root`、`--no-project`、`--cache-root`、query wait/coverage options、context/cache commands、describe/JSON envelope/error mapping 与用户文档。
- Backend：对 Store 或已解析 ProjectContext target 维护持久 operation/progress；重启后保留进度但不持久化 project absolute path，待同源 command reattach 后继续。
- Persistence/release：新增 project artifact、shared vector、semantic progress 的 Drizzle schema/migration/release asset；FTS5、`MATCH`/`bm25`、PRAGMA/integrity 继续是受限原生 SQL 例外。
- 不修改 Registry Pack install/update、Pack format、模型/provider 配置、网络边界、Codex Hook 或本地 MCP。
