## 1. ProjectContext discovery, inheritance, and CLI contract

- [x] 1.1 在 `@lorelum/config` 增加目录 layer `.lorelum/config.yaml` 的受限读取、`inherit`、`base`、`packs.<name>.enabled/priority` schema 与任意目录幂等 `lore init` 写入；以临时普通目录测试缺失、损坏、超限、符号链接、既有文件不覆盖和 `inherit: false`。
- [x] 1.2 在 Engine 实现 nearest-leaf/ancestor ProjectContext discovery、parent-to-child config fold、directory depth precedence、单条 Practice 级 decode 与 Store base snapshot；以 colocated tests 覆盖非 Git 目录、嵌套 layer、同名 Pack 增量覆盖、同 ID winner、Pack 失效、单条 Practice 失效、`base:none` 和 source 路径逃逸。
- [x] 1.3 实现一致的 `ProjectContextSnapshot`、degraded warning、effective config/layer/provenance result assembly；验证 child config 无效时继承 parent/default、单条 Practice 无效仅跳过该条、lower-priority fallback 生效且 `lore validate` 保持严格诊断。
- [x] 1.4 在用户级 config 增加整数 `query.maxWaitMs`（默认 3000）和 `query.minCoveragePercent`（默认 0），扩展 CLI global option/describe schema 和 command routing，增加 `--project-root`、`--no-project`、`--cache-root`、`--max-wait-ms`、`--min-coverage-percent`、`--require-complete`、`lore init`、`lore context status`；以 command tests 验证显式 project root、毫秒/百分比校验、override、无 marker Store-only 和 status 不泄漏绝对路径。
- [x] 1.5 将 keyword query 与 get 接到 ProjectContext，增加 JSON envelope/provenance/warning mapping；以 source-entrypoint 的隔离 Store/cache integration tests 验证 parent/child winner、`--no-project` escape hatch、坏 Practice 邻居仍可查询和无模型 keyword 离线行为。

## 2. Content-addressed derived caches and keyword artifacts

- [x] 2.1 新增 `semantic-vector-cache`、`semantic-progress-index`、`project-cache`、`project-keyword-index`、`project-semantic-index` 的 persistence definitions、Drizzle schemas/configs/migrations；更新 `bun run db:generate`、release migration asset 与测试，验证 fresh/open/idempotent migration history。
- [x] 2.2 实现用户级 shared vector cache、ProjectContext artifact catalog 和 index records；vector key 使用 `(profileId, projectionDigest)`，keyword/semantic artifact ID 使用有域分隔的 SHA-256 active `(practiceId, contentDigest, projectionDigest)` 内容清单，不得包含 Git、directory path、Store root、branch、commit 或 provenance。以 SQLite tests 验证 source path、Practice body 和错误 Profile/projection 不会被持久化或复用。
- [x] 2.3 实现 keyword artifact 的 FTS5 migration、staging publication、metadata/integrity 验证、内容相同目录 reuse 与 OS lock protected prune；以 integration tests 验证两个普通目录相同语料零重建、单 Practice 修改仅更新必要 document、损坏/孤立 cache 安全恢复。
- [x] 2.4 增加 `lore cache status` 和 `lore cache prune` command/result schema；验证只删除未被 operation 或 partial query 使用的 derived artifact/progress/vector，且 cache 清理不会写入项目 source 或 LocalStore。

## 3. Persistent semantic targets, progress, and query coverage

- [x] 3.1 将 Backend 的 index operation state 改为用户级持久 target queue，记录 opaque Store/project-slot/artifact target、完整 manifest identity、Profile、expected/ready counts、retry 和 operation state；以 daemon restart tests 验证 ProjectContext 不持久化绝对路径、重启后进入 `waiting-for-source` 并在同 `projectRootId` command reattach 后恢复。
- [x] 3.2 实现 Store 与 ProjectContext 共用的 semantic progress builder：复用 compatible artifact/vector cache、只为新的 projection embedding，并在每个 batch 用事务发布可查询 progress rows/count；以 Engine/Backend tests 验证 100 条 target 完成 50 条时只查询 50 条、shadowed/ignored source 不编码、layer source 改变排除旧 row、失败保留旧 ready artifact。
- [x] 3.3 实现同一 project directory 最新 target 合并、相同 content-addressed artifact operation joining 与不同 target 排队，替换 `backend.busy` 正常路径；以并发 integration tests 验证普通目录、多个 Git worktree 和相同语料无关目录都遵循同一规则。
- [x] 3.4 将 Store-only 与 ProjectContext semantic query/index command 接入 common target progress，按 `maxWaitMs` 观察并区分 `waiting-for-source`、`preparing(preparationId)`、无可接受 coverage 的 `indexing(operationId)` 与成功 partial result；以 protocol tests 验证 indexed/total counts、`--require-complete`、query timeout 不取消 operation、child winner 变更不返回旧 Practice 且不使用 keyword substitute。

## 4. Contract synchronization and end-to-end verification

- [x] 4.1 更新 `lore describe`、用户级/project configuration、CLI/API/site/development 文档与错误 code/schema，使其引用 `project-context`、`retrieval-query`、`practice-read`、`semantic-index` delta；验证所有相对链接、整数毫秒示例和 JSON fixture。
- [x] 4.2 在隔离 Store/cache roots 上运行 Store-only、普通目录和嵌套 ProjectContext end-to-end 场景：parent/child config inheritance、incremental Pack override、单条坏 Practice fallback、首次 query 自动启动 index、3000 毫秒内 partial 50/100、完整转 ready、相同语料 artifact/vector reuse、连续目录编辑 coalescing、Backend restart reattach 和 cache prune recovery；记录实际命令与观察结果。
- [x] 4.3 运行 `bun run db:generate`、相关 Engine/CLI/Backend focused tests、`bun run typecheck`、`openspec validate add-project-context-packs --type change --strict --no-interactive`、`git diff --check` 与 secret scan；在所有任务和 review 完成前不得 archive 或同步 delta 到 current specs。
