# Verification Plan

> 本文件记录 Lorelum 主仓库实现的验证方案；完整 query 集、gold labels 和正式 benchmark record 由关联 benchmark 工作流维护，不复制进 Core 测试目录。

> **阅读范围注记：** 以下数字、Profile、版本和运行记录按原 checkout 保留，不是方法隔离后的重新评测。多视角/clause/聚合公式证据只对应现在显式选择的实验方法 `multi-view-vector`，不能覆盖默认 `single-vector`，也不表明排名质量改善或 #236 已解决。§1 等处的五字段请求是历史协议示例；当前 harness 虽仍记录 protocol version `1`，生产者必须额外发送 `retrievalMethod`（`single-vector` 或 `multi-view-vector`），并使用与该方法匹配的 Profile/artifact。最新可复制输入入口见 [harness 启动和输入](../../../docs/development/semantic-retrieval-benchmark-harness.md#启动和输入)；不要直接把本页旧 JSON 发给当前入口。


## 1. Harness 协议与版本

benchmark runner 在固定 Lorelum checkout 中启动本地 harness，使用 stdin/stdout 传输。请求含固定评测输入，不含 gold labels：

```json
{
  "query": "...",
  "storeRoot": "absolute path to a test-owned Store",
  "embeddingProfileId": "fixed 64-character Profile ID",
  "candidateWidth": 20,
  "resultLimit": 5
}
```

成功只返回同一次检索的结构化状态、候选 IDs 和有序最终 IDs：

```json
{
  "status": "ok",
  "candidateIds": ["practice.a", "practice.b"],
  "finalIds": ["practice.a", "practice.b"]
}
```

失败返回 `{"status":"error","errorCode":"..."}`，不返回部分名单；成功进程退出码为 0，结构化失败进程退出码为非零。输出不得包含 query、正文、向量相似度或内部 score。harness protocol version 由锁定 checkout 对应的内部 schema/version 约定与 benchmark provenance 固定，不额外增加公开产品协议字段。此 harness 不是 `lore` CLI 子命令，不新增包公开 exports 或产品 API。

### 1.1 Derived cache 路由与真实冒烟

固定 commit `6bf1e1b` 的本地 harness 把请求里的 `storeRoot` 当作 semantic index root，而 Store-only `lore index build --cache-root` 把 artifact 发布在 derived cache。两者不是同一目录时，CLI 可以报告 index `ready`，harness 仍返回 `index_unavailable`，benchmark 因此在进入召回/排序评分前全部失败。修正后 harness 从 benchmark 专用环境变量 `LORELUM_BENCHMARK_CACHE_ROOT`（未设置或为空时回退 `defaultQueryArtifactCacheRoot()`）打开同一 content-addressed artifact，`storeRoot` 只用于读取 canonical 语料；五字段 stdin、N/K 与 snapshot 语义、输出字段、普通 `lore query` 契约和公开 exports 均不变。

定向验证（主仓库本地）：

- `bun test packages/backend/src/benchmark`：15 pass / 0 fail。覆盖 env 路由与默认回退、非绝对路径拒绝、缺失或异源 artifact 的结构化失败、绝不回退 Store-local index，以及成功/失败响应只含约定字段。
- `bun run typecheck`、`bun run lint`：通过；改动文件的 `oxfmt --check` 通过。（整仓 `bun run fmt:check` 在本机因 `core.autocrlf=true` 报告全部文件，属环境现象。）
- `openspec validate advance-task-aware-semantic-retrieval --strict`：通过。

真实冒烟（test-owned 输入，单次调用，不计入 baseline、不产生分数）：

| 项目 | 值 |
| --- | --- |
| Store | benchmark test-owned `<benchmark worktree>/artifacts/retrieval-ranking/store-6bf1e1b-v4`：4 个 Pack、97 条完整 Practice、generation/effectiveRevision = 4/4 |
| Derived cache | `<benchmark worktree>/artifacts/retrieval-ranking/cache-6bf1e1b-v4` |
| Corpus / artifact identity | corpus digest `42af40921cfe49fd94d227fdc3e5be5446d83e78e61cd6db7688b86414493eab`；content-addressed artifact `c8f271b7ef3eba96cbc18578a4a0d030a9a470a757b1e5a59b48b26afe93bab7`（`query-artifacts/v1/artifacts/semantic/<artifactId>/active.sqlite`，由 Store-only CLI 构建发布） |
| Profile | `72c7404af9d533dce3dd5f5e62987fcb225ffdfd180ae2951879d3a54044c2a5` |
| N / K | 20 / 5 |
| Query | 固定 revision 首例 `agentic-scope-direct` 的自然语言 query |
| 结果 | exit 0、`status="ok"`、`candidateIds` 20 项、`finalIds` 5 项；两份名单来自同一次检索和 snapshot，且只含 ID |

同一次冒烟的环境与协议控制：

- 未设置该环境变量时回退默认 cache，并从默认 cache 中的同一 artifact 成功返回，证明回退路径可用。
- 指向空 cache root 时返回 `index_unavailable`（exit 1），不读取 Store-local index，也不返回任何部分名单。
- 指向非绝对路径时返回 `runtime_unavailable`（exit 1），不静默回退。
- stdin 附带 `cacheRoot` 等额外字段时返回 `invalid_request`（exit 1），五字段契约保持不变。

干净 checkout 复现：在独立 clone 中 `bun install`、`bun run build:native` 后，以同一请求、同一 `LORELUM_BENCHMARK_CACHE_ROOT` 和同一 N/K 运行 harness，stdout（sha256 `9f72786d70b9673008c41a1bfb52d24c75da09bc8652b87540bb28cbcf0beee6`）与主工作区逐字节一致，该 clone 内 `bun test packages/backend/src/benchmark` 为 15 pass / 0 fail。对照父提交 `6bf1e1b`，同一请求返回 `{"status":"error","errorCode":"index_unavailable"}`（exit 1）。

本节记录的是单次冒烟证据；全量案例、scorer 与 baseline 冻结仍由 benchmark 仓库执行（见下方 §4、§7、§8）。冒烟命令与固定 SHA 见交付说明；该 SHA 已在干净 checkout 中按同一命令复现（见上）。

## 2. N 与 K 的边界验证

- Engine 在最终排序前收集至多 N 个通过必要有效性及 snapshot 检查的候选；正常最终排序最多返回 K 个 Practice summary。
- 对评测用例要求 `N > K`，并验证排序前候选名单实际可超过 K；不把旧 `limit=K` 的结果改名作为候选名单。
- 先仅分离 N/K 并保持现有相似度排序；回归测试确认相同输入下旧 final K 行为保持不变。
- 至少在 Store semantic query 与 content-addressed ProjectContext 两条路径验证边界一致。

## 3. Harness 的同次检索与 snapshot/retry

每个成功响应的 `candidateIds` 必须是候选校验后、即将交给最终排序的 distinct Practice ID；`finalIds` 必须是同次正常排序结果的前 K 项，均唯一且属于 `candidateIds`。Store snapshot identity 必须在同一 Engine query attempt 内一致。

并发 Store 变化导致 retry 时，丢弃之前 attempt 的候选名单；最终成功只返回成功 attempt 的 candidate/final IDs，所有 attempt 失败时只返回 failure，不附带任何旧名单。失败状态、输出不完整、重复 ID、`finalIds` 不属于 `candidateIds` 等由 benchmark 侧归为运行/协议问题，不得伪装成相关性失败。

## 4. 改动前 baseline 与冻结门槛

在任何排序策略改动前，固定并验证：

- Lorelum baseline commit/build 和对应 harness protocol version；
- 固定 query/case revision、Pack commit/digest、Store/index 状态和 embedding Profile；
- N、K、运行环境与 benchmark scorer revision；
- harness 每例输出与外部 scorer 的逐例判定、计划分母及原始结果 hash。

先核验候选/最终名单结构有效、scorer 可重复，再冻结 baseline revision 和原始逐例结果。后续对比只更换预先声明的 Lorelum build，其他输入和配置保持一致；分别报告召回失败、排序失败、scope error 的变化。

## 5. 独立的现有 CLI 观察

使用当前已授权 query 和**现有** `lore query`/Store 配置，在单独、明确标记为 `test-owned` 的隔离 worktree 和 Store 上运行正常 CLI。复用现有配置，不增加 `--explain`、新 flag、协议字段、诊断命令或任意 CLI 功能。在终端观察/记录 CLI 正常返回的 Practice IDs。

这是单独一次 CLI 调用：不得声称这些 IDs 与 harness 的 `candidateIds`/`finalIds` 来自同一检索、同一 attempt 或同一原子 snapshot trace；也不得用 CLI 的最终结果单独推断候选召回。验证记录将其标成“独立产品路径观察”，与 harness 逐例指标分开。

隔离 worktree、Store 与任何临时日志须标记为 test-owned；验证后、合并前全部删除。不得删除当前共享工作区中的原有研究文档或其它用户文件。

## 6. 隐私与复现

- benchmark runner 在进程外使用 gold labels；不得把标签放在 stdin、Store/Pack 输入、Engine query、harness 环境变量或被测进程可读文件中。
- 固定并记录 benchmark revision、Lorelum commit/build、Pack/Store digest、Profile、N/K、运行环境、scorer 与 harness protocol version。
- 主仓库 unit tests 使用临时 Store 和受控 EmbeddingPort；不得读开发者 Store、cache 或本机用户 Pack。
- 普通 CLI JSON/text、公开 package exports、Backend API 和 daemon journal 不增加候选诊断字段。

## 7. 指标与计划命令

| 项目 | 记录内容 | 解释 |
| --- | --- | --- |
| Candidate recall | core IDs 是否出现在 harness `candidateIds` | 判断“有没有找到” |
| Final ranking | core IDs 在 harness 有序 `finalIds` 中的位置 | 判断“找到后排得如何” |
| Independent CLI observation | 正常 CLI 返回的 IDs（终端观察） | 检查产品路径；不与 harness trace 合并归因 |
| Scope | 仅领域相似 Practice 是否压过 core | 判断主题相关是否冒充任务相关 |
| Supporting usefulness | 直接补充当前任务的 Practice 是否仍可入选 | 避免把领域结果一律过滤 |
| Cost | query latency、必要的 build/index cost | 评估方案代价，不从小样本外推生产容量 |
| Safety | snapshot/retry、canonical assembly、索引兼容、无 fallback、临时工件清理 | 确认检索改进未损害现行可靠性合同 |

```powershell
bun test packages/engine
bun test packages/backend
bun test packages/cli
bun run typecheck
bun run lint
bun run fmt:check
openspec validate advance-task-aware-semantic-retrieval --strict
```

本地 harness 的固定启动入口、请求字段和退出码约定见 [semantic retrieval benchmark harness](../../../docs/development/semantic-retrieval-benchmark-harness.md)。benchmark runner/scorer 的完整运行命令由 benchmark 仓库维护；本次单次 harness 冒烟不代表 baseline。CLI 观察仅使用现有正常命令及已授权的隔离 Store 配置。

## 8. 观察结果

baseline 已由 benchmark 侧在 `caecc53` 上冻结，记录见 benchmark 仓库 `results/records/retrieval-ranking-v1-baseline-caecc53.json`（replay record 一致）与其 `verification.md`：50 例全部 `status=ok`，core candidate recall 49/50、core final top-5 42/50、scope error 2。主仓库 §1.1 的单次冒烟只验证进程协议与真实 runtime，不计入 baseline。改动后本地对照见 §9；官方逐例对比由 benchmark 侧用新 run ID 执行，CLI 独立观察不得和 harness trace 混同。

| Date | Lorelum commit/build | Eval revision / corpus digest | Harness protocol/scorer | Profile | N/K | Candidate core present? | Baseline rank | Updated rank | CLI IDs observed separately? | Scope | Cost / limitations | Test-owned artifacts removed? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## 9. 任务感知最终排序（历史实现，已被 §10 取代）

> 本节只保留第一轮 BM25 task signal 的实验记录。该运行时代码已在 2026-09-27 的 §10 多视角向量转型中删除；本节数字不能作为当前 build 的结果或产品参数依据。

实现（design Decision 7）：`packages/engine/src/query/semantic/task-relevance.ts` 在同一次检索、同一 snapshot 内重排已经过 canonical 校验的候选。相似度是基础顺序；任务/阶段信号取自 canonical Practice 字段，用既有 keyword projection 与固定 keyword field weights 建立 request-private、离线的确定性 FTS5 BM25 打分，并在候选集合内归一化。最终顺序为 `similarity + SEMANTIC_TASK_SIGNAL_WEIGHT × taskStrength`，权重固定 0.05。`packages/engine/src/query/semantic/query-service.ts` 在读取 canonical Practices 之后、结果装配与 K 截断之前调用它，因此 `candidateIds` 与 `finalIds` 仍来自同一 attempt 和同一 snapshot。

先更新 design/tasks 并运行 strict validation，再开始实现；未新增公开 export、CLI flag、协议字段或 Backend capability。

定向与全量验证（主仓库本地）：

- `bun test packages/engine/src/query/semantic`、`bun test packages/engine/src/query/artifacts`：通过；新增 `task-relevance.test.ts` 9 例（无匹配保持原序、近似平局由任务信号决定、清晰语义领先者保持领先、权重边界、确定性 tie-break、无 FTS5 回退、相邻阶段、领域补充不被过滤），`query-service.test.ts` 新增 3 例（任务感知排序、候选/最终同序、信号不可用时保持语义顺序），`artifacts/semantic.test.ts` 新增 1 例（content-addressed 路径共用同一排序规则）。
- `bun test packages/engine`：267 pass / 2 skip；唯一 fail 是 `mutation-lock.test.ts` 的并发回收用例在整包负载下超出 5s 超时，单独运行与未改动的 `caecc53` checkout 均通过，属本机既有计时敏感项。
- `bun test packages/backend/src/benchmark`：15 pass（harness 协议与路由未变）。
- `bun run typecheck`、`bun run lint`：通过（lint 仅既有 warning）。改动文件 `oxfmt --check` 通过；整仓 `bun run fmt:check` 在本机 `core.autocrlf=true` 下对全部既有文件报错，属环境现象。
- `openspec validate advance-task-aware-semantic-retrieval --strict`：通过。

改动前后本地对照（**非官方 benchmark 结果**）：在与 baseline 相同的冻结输入上（Pack snapshot `3a48b6a`、corpus digest `61176ea9…`、97 条 Practice、同一 semantic artifact、Profile `72c7404a…`、N=20/K=5），用主仓库真实 engine 路径（content-addressed trace service）重放 50 例 query：

| 指标 | baseline `caecc53` | 本次 build |
| --- | --- | --- |
| core final top-5 | 42/50 | 48/50 |
| core candidate recall | 49/50 | 49/50 |
| forbidden 出现在 core 之前 | 2 | 0 |
| 排序失败被修复 | - | 6（goal-paraphrase 7→2、proportionate-validation 13→3、reuse-before-build 7→1、review-finding 9→3、supported-claim 6→1、readback-pack-context 9→2） |
| 既有 top-5 命中被挤出的 case | - | 0 |

灵敏度：把权重设为 0.03–0.06 得到同一组判定（core final top-5 48/50、forbidden 先于 core 0、无既有命中被挤出），0.08 起才出现 top-5 命中被挤出，说明结论不是单点调参；权重取值与依据见 design Decision 7。

限制与非目标：

- `agentic-acceptance-direct` 仍是 candidate miss：该 core 在 semantic reader 与任务信号下都不进 top-20，修复需要改变持久化投射或新增候选来源（即改变 Profile/index 表示），会与固定 Profile 及 baseline 失去可比性，本步不做（tasks 3.2）。
- `agentic-limit-investigation` 在 baseline 已是排序失败（candidate rank 6），本步后被排得更低；它是本次唯一被负面影响的 case，故如实记录而不以总分掩盖。
- 本表是主仓库本地对照，用于确认 build 行为与排除回归；官方改动前后对比由 benchmark 侧在同一 revision、同一 Profile、N/K 与 scorer 下重跑，主仓库不据此声明改善。

干净 checkout 的 harness 对比（同一冻结 Store/cache、Profile、N=20/K=5，先在 `caecc53` 后在本次 build 各跑同一请求）：

| case | baseline `finalIds` 前 3 | 本次 build `finalIds` 前 3 |
| --- | --- | --- |
| `issue-pr-body-scope-conflict` | `react.server.request-dedup-cache`（forbidden）、core、`react.server.no-module-request-state` | **core**（`issue-pr-etiquette.pull-request.write-the-pr-body-for-a-cold-reviewer`）、`react.server.request-dedup-cache`、`react.server.no-module-request-state` |
| `issue-pr-readback-pack-context` | `pack-creator.release.verify-the-supported-install-path-before-claiming-release`、`…clean-markdown`、`pack-creator.review.run-subtractive-content-review` | `…clean-markdown`、**core**（`issue-pr-etiquette.communication.read-back-your-post-before-requesting-review`）、`pack-creator.release.verify-the-supported-install-path-before-claiming-release` |
| `agentic-supported-claim` | `agentic-coding.verification.map-evidence-to-acceptance`、…、…（core 不在前 3） | **core**（`agentic-coding.delivery.claim-only-supported-outcome`）、`agentic-coding.implementation.confirm-product-surface-expansion`、`agentic-coding.verification.map-evidence-to-acceptance` |

该 checkout 内 `bun test packages/engine/src/query/semantic packages/engine/src/query/artifacts` 为 48 pass / 1 skip，`git status` 干净；`bun install` 无依赖变化，因此同一 SHA 可直接重建运行，无需新的 Profile 或索引迁移。

## 10. Practice 多视角向量转型（2026-09-27）

依据 2026-09-26 的输入侧动态权重与多对多研究参考，本轮把 semantic 默认路径从 request-private FTS5 task signal 改为完整 query 对同一 Practice 多内容视角的向量匹配：

- projection v2：每个 Practice 生成 `full`、`task-card` 和带标题路径的通用 body views；view recipe 与 digest 进入 Profile，旧 Profile 不兼容。
- index v3：`semantic_vectors` 使用 `(practice_id, view_id)` 主键，保存 view kind/ordinal 与 digest；Store-local、ProjectContext complete/progress 和 shared vector cache 使用相同身份。生成的旧表升级 migration 会清空不可兼容的派生向量并保留 metadata 供兼容性判定。
- reader：每个 query view 先在同一 Practice 内取最大内容 view 分数，再按固定非负 query-view 权重聚合；默认 query 仅使用完整原句。没有把 body chunk 分数相加，也没有 keyword fallback。
- runtime：删除 `task-relevance.ts` 与 `similarity + 0.05 × taskStrength`，未新增公开 export、CLI/API 字段或 Backend capability。多 query 字段与动态阈值保留为后续隔离实验接口，不是产品默认。

验证结果（本机 Windows，2026-09-27）：

- `bun run db:generate`：生成并审阅 `semantic-index`、`project-semantic-index`、`semantic-progress-index` 的 0001 migration；生成 SQL 的旧列复制语句因旧表没有 view 列而不可执行，已改为删除不可兼容派生行后重建新表。
- `bun test packages/engine/src/query`：89 pass / 1 skip / 0 fail；其中 semantic projection、reader weighted max、无 chunk 线性加分、query-service snapshot/retry 与 ProjectContext 多视角排序均通过。
- `bun test packages/engine/src/query/artifacts/semantic.test.ts packages/engine/src/query/artifacts/semantic-progress.test.ts packages/engine/src/query/artifacts/cache-manager.test.ts`：11 pass / 0 fail。
- `bun test packages/engine`：263 pass / 2 skip / 1 fail。唯一失败是 `store.integration.test.ts` 在整包并行负载下偶发 Windows `EPERM: rename`；该文件单独重跑 4 pass / 0 fail，且未涉及本轮向量逻辑。此前一轮整包还出现过既有 `mutation-lock` 计时超时，单独重跑通过。
- `bun test packages/backend/src/benchmark`：15 pass / 0 fail；五字段 harness 协议、cache-root 路由与无 Store-local fallback 保持不变。
- `bun run typecheck`：通过。
- `bun run lint`：通过，仅有仓库既有 warnings。
- `bunx oxfmt --check <changed files>`：19 个改动文件全部通过；未把整仓 CRLF 视为代码格式失败。
- `openspec validate advance-task-aware-semantic-retrieval --strict`：通过。

未执行与限制：

- 没有重跑 50 例冻结 benchmark，也没有把 §9 的 old task-signal 结果归因于多视角表示。
- 本地没有用真实 97 条 Practice/embedding runtime 测评 `full/task-card/body` 的召回或 scope 变化；`max` 的块数机会偏差、例子/否定误命中和动态权重非单调仍需按 design 的隔离实验与 canonical 原文回读验证。
- 旧 semantic artifact 不自动在线迁移；新 Profile 会使旧 artifact 不兼容，后续 build 需从当前 snapshot 重建。失败重建仍保留旧文件，但不会把它当作当前 Profile 的成功结果。

## 11. Backend 语义生命周期与等价目录 coalescing（2026-09-27）

多视角转型只改变 semantic projection/index 的表示与查询聚合，没有引入新模型或 Backend 生命周期，故 4.2 只验证既有 semantic operation 路径：

- `bun test packages/backend/src/modules/query packages/backend/src/modules/index packages/backend/src/modules/embedding packages/backend/src/benchmark`：60 pass / 0 fail（8 个文件）。
- 本轮同时发现并修复 `packages/backend/src/modules/query/content-addressed-semantic-runtime.test.ts` 中 `joins one content-addressed operation for equivalent ordinary directories` 的失效断言：它原先断言 `documentCalls` 为 1，隐含“每 Practice 编码一个向量”。多视角投影后每条 Practice 产生 full/task-card/body 多个 view，断言改为按 `projectSemanticPractice` 的 view 数比较。
- 该用例此前的失败表现为 finally 清理阶段 `EBUSY: resource busy or locked, rm '<cache>'`：断言在 `release()` 之前抛出，阻塞的 embedding 批次永不返回，后台 build 仍持有 artifact 句柄。修复同时把断言移到 `release()` + `waitForIdle()` 之后，使失败不再伪装成 Windows 句柄泄漏。修复后单文件 8 pass / 0 fail。
- 未在真实 Backend runtime 上评测多视角的编码次数与索引体积；后两项目前只有单元测试证据。

仍未完成、需外部 benchmark 的验收：

- 3.2（候选召回验证）：`agentic-acceptance-direct` 是否因多视角表示进入候选，尚无冻结 benchmark 证据。
- 3.3（改动前后对比）：baseline 旧 Profile 与新 build 新 Profile 的逐例对比尚未运行。

因此本 change 的实现工作已完成，但 3.2 与 3.3 保持未勾选；不得用 §9 的旧 task-signal 数字或输入侧 19/46 结果替代这两项验证。

## 12. 语义角色分层与去字面脚手架（2026-09-27 第二轮）

第二轮针对"实现仍是关键词检索换载体"的三个缺口：裸 id/slug 与字段标签进入 embedding、topic 与 applicability 未分离、按字符切块让 CJK 提前撞上下文。

改动：

- projection v3：视图按语义角色分层为 `applicability`（title + `applies_when` + stage + anti-pattern name/description）、`topic`（仅 `tech_stack`）、`guidance`（带标题路径的正文块）。进入 embedding 的文本不再包含 Practice id、anti-pattern id 或字段标签。旧 `full`/`task-card`/`body` 配方被替换，无上限的 `full` 视图被移除。
- reader：`applicability` 取最大值作为判据，`guidance` 取均值使块数不能抬高分数，`topic` 取最大值并只作为负向项；角色权重以语义角色为键（`SEMANTIC_ROLE_WEIGHTS`），不以字段名或手工字段权重表为键。
- 分块按估算 token 预算（CJK 约 1 token/字，其它约 0.25）而非字符数；`SEMANTIC_VIEW_MAX_ESTIMATED_TOKENS = 384`。
- schema 的 `view_kind` 约束改为 `applicability | topic | guidance`（三套 migration 的 SQL 与 snapshot 同步）；`SEMANTIC_PROJECTION_VERSION = 3`，Profile identity 随之变化，旧 v1 与旧 v2 artifact 均为 incompatible；`SEMANTIC_INDEX_VERSION` 保持 3（行结构未变）。

验证（本机 Windows，2026-09-27）：

- `bun test packages/engine/src/query`：94 pass / 1 skip / 0 fail（新增"只命中 topic 不能压过 applicability 命中""任何 view 不含 Practice id""无标点连续中文按 token 预算分块"，以及 §6.6 的两条结构守卫）。
- `bun test packages/backend/src/modules/query packages/backend/src/modules/index packages/backend/src/modules/embedding packages/backend/src/benchmark`：60 pass / 0 fail。
- `bun test packages/engine`：266 pass / 2 skip / 1 fail；唯一失败是既有 `mutation-lock.test.ts` 并发回收用例在整包负载下超出 5s，单独重跑 6 pass / 0 fail，与本轮改动无关。
- `bun run typecheck` 通过；`bun run lint` 退出 0（仅既有 warning）；改动文件 `oxfmt --check` 通过。

真实模型复测（非官方 benchmark）：用本机缓存的生产模型（granite-embedding-97m-multilingual-r2 GGUF，llama-server，与 `llamaArguments` 相同 pooling/归一化），对两条冻结 scope error 的 core 与 forbidden Practice 计算 query 相似度，比较旧单模板表示与新角色视图表示：

| case | 旧单模板 core / forbidden | 新角色视图 core / forbidden | 结果 |
| --- | --- | --- | --- |
| `issue-pr-body-scope-conflict` | 0.8535 / 0.8652 | 0.9275 / 0.9065 | 禁项 #1 → core #1 |
| `issue-pr-readback-pack-context` | 0.8191 / 0.8347 | 0.8849 / 0.8912 | 仍为禁项 #1（差距由 0.0156 收窄到 0.0063） |

`issue-pr-readback-pack-context` 的逐角色分数（新表示）：core applicability 0.808 / topic 0.805 / guidance 0.794；forbidden applicability 0.821 / topic 0.836 / guidance 0.797。禁项在三个角色轴上都更高，因此这不是角色权重或 topic 惩罚能修复的排序问题，而需要 query 侧拆解（把"Pack release 背景"从句与"检查保存后的 Markdown"动作从句分开）。这构成 §6.5 未完成项的直接证据。

中文跨语言（同一模型）：`issue-pr-body-scope-conflict` 的中文 query 对新表示得 core 0.9937 / 禁项 0.8190，即中文 query 能正确命中英文 Practice。作为对照，FTS5 在生产 tokenizer（`unicode61 remove_diacritics 0`）下把整句中文切成**一个 token**，`服务端渲染` / `请求级查询` / `去重` 三个子串查询均 0 命中；换 `trigram` 才能让三字以上子串命中，但两字词仍为 0。这是"semantic 路径不得保留任何词面通道"的直接依据。

过程中发现的额外缺陷：llama-server 对超过物理 batch 的输入返回硬错误而不是截断（复测时以 512 的 batch 观察到 719-token 输入报错）。旧配方的单模板 `full` 文本没有任何长度上限，长 Practice 有直接查询失败的风险；v3 移除 `full` 并按估算预算切分后，每个 view 都有上界。

结构守卫（§6.6）：`packages/engine/src/query/semantic/no-lexical-scoring.test.ts` 扫描 `query/semantic/**` 以及 `semantic.ts`、`semantic-progress.ts`、`vector-cache.ts` 的全部生产文件（排除 `*.test.ts` 与 `*.test-helper.ts`），断言没有任何 import specifier 命中 `keyword|fts5|bm25`，也没有 `buildKeywordIndex`、`projectKeywordPractice`、`KeywordIndexUnavailableError` 的调用。守卫有效性已实测：临时在 `read.ts` 重新引入 keyword import 时两条守卫都失败，回退后恢复通过；扫描文件数下限断言防止路径失效后静默通过。

限制：以上复测是两条 case 的定向测量，不是冻结 benchmark；它只说明机制在真实模型下的行为，不构成召回率或生产准确率结论。3.2 与 3.3 仍未完成。

## 13. 融合多对多与输入侧动态权重（2026-09-28）

> 2026-09-29 更新：本节记录的"默认 query 仅使用完整原句"和 `max_i` 混合已被 §14 的 clause split + weak-clause aggregation 取代；保留为上一版过程记录。

这一轮按维护者确认的方向，把 2026-09-26 的多对多向量参考（文档侧多视角、Practice 内先汇总、全量排序）与输入侧动态权重实验（query 侧多字段作为子检索）融合到产品路径，并删除上一版的 `topic` 负权与"先 N 再 K"的收窄。

改动：

- projection v4：文档侧表示组改为 `full`（不含 id/标签的整条 Practice 文本，按估算 token 预算切分）/`task-card`（title、`applies_when`、stage、anti-pattern，不含 `tech_stack`）/`body`（带标题路径的正文块）。`SEMANTIC_PROJECTION_VERSION = 4`；`view_kind` 约束改为 `full | task-card | body`，三套 semantic 迁移各新增一版 0002 重建迁移（不复制旧行，旧 kinds 不相容，改由完整 snapshot 重建）。
- reader：同一 Practice 内对每个 query view 取内容视角的 `max`；跨 query views 用固定非负单调混合 `S = (1-α)·max_i a[p,i] + α·Σ w_i a[p,i] / Σ w_i`（`SEMANTIC_QUERY_VIEW_MIX = 0.5`，`w_i ≥ 0`）。删除 `SEMANTIC_ROLE_WEIGHTS` 与负权 `topic`。
- query-service / read：排序覆盖全部 eligible Practice，`K` 只在完整排序产生后应用；`searchSemanticArtifact` 的内部候选宽度与公开 1..50 result limit 解耦。benchmark harness 的 `N` 只限制其报告的 candidate ID 数量。

验证（本机 Windows，2026-09-28）：

- `bun test packages/engine/src/query/semantic`：38 pass / 0 fail（含"每个 query view 取最佳表示组""额外 body 块不线性加分""跨 query view 混合单调非负""CJK full/body 按 token 预算切分"）。
- `bun test packages/engine/src/query packages/engine/src/persistence`：0 fail。
- `bun test packages/backend/src/modules/query packages/backend/src/modules/index packages/backend/src/modules/embedding packages/backend/src/benchmark`：0 fail。
- `bun run typecheck`：通过。
- `bun test packages/engine`（全量）：除 `local-store` 的并发/恢复用例在整包负载下偶发超时外全部通过；这些用例（`recovery.test.ts`、`mutation-lock.test.ts`）单独重跑 0 fail，与本轮改动无关。
- `bun test packages/backend`（全量）：除既有 process/export 边界用例偶发超时外通过，与本轮改动无关。

未执行与限制：

- 没有重跑 50 例冻结 benchmark，也没有用真实 97 条 Practice/embedding runtime 重新评测 `full/task-card/body` 的召回或 scope 变化。
- 跨 query view 的 M>1 路径目前只在单元测试与 benchmark harness 的内部 seam 上存在；原句 + `intent`/`moment`/`artifact`/`constraints`/`domain` 的拆解与固定/动态权重仍是 §7.5 的隔离实验，不是产品默认。
- `max` 仍有"块越多越容易碰到一次高分"的机会偏差；例子、否定和 scope 误触发仍需 benchmark 回读 canonical 原文。
- 3.2 与 3.3 仍未完成，需要新的冻结 build 与 benchmark run；不得把 §12 的旧角色结果或输入侧 19/46 归因于本轮表示。

## 14. query clause split 与 full/整句去主导（2026-09-29）

本节修正 §13 的默认 query 行为：整句和 `full` 不再主导向量排序。

改动：

- 新增 `query-views.ts`。默认 query 按跨语言标点边界（句号、问号、分号、冒号、逗号及对应 CJK/全角标点、换行）拆成 clause views。没有可用 clause 时，单个 clause 才等同原句；不再额外保留一个高权重的整句 view。该切分不是词表或关键词匹配，clause 仍由同一 embedding 模型编码。
- `reader.ts` 不再把 `full` 参与常规打分。`full` 只在一个 Practice 没有任何可打分 view 时兜底，避免全文重复 task-card/body 信号后让一个噪声正文块主导。
- 每个 query clause 在同一 Practice 内先取 `task-card` 的最大值、`body` 的均值，再对这两个内容组取等权平均；额外 body 块仍不能线性加分。
- 跨 query clause 从"最佳 clause + 加权均值"改为弱 clause + 加权均值：`S[p] = (1-β)·Σ_i w_i a[p,i] / Σ_i w_i + β·min_i a[p,i]`，`β = 0.5`。一个背景/领域 clause 单独高分不能带过一个弱动作 clause；提高任一 clause 的余弦仍不会降低分数。
- `SEMANTIC_QUERY_PROJECTION_VERSION = 2`，与 v4 document projection 一起进入 Profile identity；旧 query 行为不能被当成当前 Profile 兼容。

本地验证：

- `bun test packages/engine/src/query/semantic`：40 pass / 1 skip / 0 fail（新增 query clause split、CJK 无分词标点切分、`full` 不参与打分、额外 body 块不成比例加分、弱 clause 混合和单调性用例）。
- `bun test packages/engine/src/query packages/engine/src/persistence`：109 pass / 1 skip / 0 fail。
- `bun test packages/backend/src/modules/query packages/backend/src/modules/index packages/backend/src/modules/embedding packages/backend/src/benchmark`：60 pass / 0 fail；一次整组运行出现的 Windows `EBUSY` 清理失败在同一 `content-addressed-semantic-runtime.test.ts` 单独重跑及整组复跑中均未复现。
- `bun run typecheck`：通过。`bun run lint`：退出 0，仅既有 warnings。改动文件 `oxfmt --check`：通过。
- `bunx openspec validate advance-task-aware-semantic-retrieval --strict`：通过。

真实模型定向复测（本机 granite-embedding-97m-multilingual-r2 GGUF，生产 pooling/归一化参数；4 Pack / 97 Practice / 1233 document views；非官方 50 例 benchmark）：

| case | §13 v4 core / forbidden | §14 clause split + weak-clause core / forbidden |
| --- | --- | --- |
| `issue-pr-body-scope-conflict` | #12 / #1 | #2 / #41 |
| `issue-pr-readback-pack-context` | #8 / #5 | #2 / #5 |

第二例的核心分 `0.7842012385789500`，禁止项分 `0.7776215456221753`，核心已高于禁止项；当前第 1 名是同包通信规范 `issue-pr-etiquette.communication.write-in-the-repos-collaboration-language-with-clean-markdown`（`0.7874315835273451`），这是仍待解释的普通排序命中，不是原 scope error 回退。

限制：

- 这是两条预先冻结 scope case 的定向测量，不是 50 例冻结 benchmark，也不是多语言/规模泛化证明。
- clause 边界目前只使用跨语言标点；它不替代 `intent`/`moment`/`artifact`/`constraints`/`domain` 的结构化 analyzer，也不代表动态权重已经验证为产品最优。
- 3.2 与 3.3 仍未完成，必须在新冻结 build 上用相同模型、Pack、N/K、scorer 与环境独立重跑。

## 15. m 侧片段证据聚合（2026-09-29）

本节把 Practice 侧的多个 content views 从“表示存在”推进到排序决策：query clause 不只是和 task-card/body 整体匹配，还会显式使用最佳 body 片段证据。

改动：

- `reader.ts` 对每个 query clause 保留两类 body 统计：
  - `bodyMean`：该 Practice 全部 body views 的平均余弦；
  - `bodyMaximum`：该 clause 在该 Practice 内匹配最好的单个 body 片段。
- m-side 片段证据固定为 `0.5 × bodyMaximum + 0.5 × bodyMean`。这样单个局部片段不会被平均抹掉，同时更多无关片段会拉低均值，不能线性抬高分数。
- clause 分数为 `task-card` 最佳适用性与上述 body 片段证据的等权平均；跨 clause 仍使用弱 clause + 加权均值。
- task-card 与 body 片段两段都覆盖全部 eligible Practice，仍没有 `N → K` 候选漏斗；`full` 继续不参与常规打分。
- 该变化复用已持久化的 body view 向量，不新增模型、不改变索引格式，也不修改公开 CLI/API。

本地验证：

- `bun test packages/engine/src/query/semantic`：41 pass / 1 skip / 0 fail（新增“局部 body 片段不会被平均抹掉”回归）。
- `bun run typecheck`：通过。

真实模型定向复测（与 §14 相同模型、4 Pack、97 Practice、1233 document views；非官方 50 例 benchmark）：

| case | §14 clause split core / forbidden | §15 m-side fragment evidence core / forbidden |
| --- | --- | --- |
| `issue-pr-body-scope-conflict` | #2 / #41 | #2 / #33 |
| `issue-pr-readback-pack-context` | #2 / #5 | #2 / #5 |

细节：

- 第一例 core `0.8081753466192869`，forbidden `0.7825495150418118`；core 的 best view 为 `body:2`，说明具体正文片段已经参与决定。
- 第二例 core `0.7899755968280930`，forbidden `0.7823313781392068`；二者差距扩大到约 `0.00764`，core 的 best view 为 `body:1`。
- 第二例第 1 名仍是 `issue-pr-etiquette.communication.write-in-the-repos-collaboration-language-with-clean-markdown`（`0.7945660739100207`）。当前不要求精确 top 1，但这条剩余差距应作为后续 query-role analyzer 或 rerank 的回归证据。
- 第一例 forbidden 从 #41 变为 #33，但仍远低于 core #2；这是 m-side 片段证据增加局部命中后的预期波动，不是 scope error 回退。

限制：

- m-side mix 固定为 0.5，只完成了机械证据聚合，不是跨 query 多轮生成式检索。
- 这仍是两条冻结 case 的定向测量；3.2/3.3 需要用新的冻结 build 和正式 benchmark 验证全量效果。

## 16. 多轮检索与按名次融合（2026-09-29）

> 2026-09-29 回退：§16–§18 的多轮/RRF/轮次族方向已撤回，改为单次向量打分，见 §19。以下三节保留为实验记录，不代表当前实现或产品默认。

这一节修正了 §14/§15 的一个结构性缺口：当时把多个 query clause 的分数合并成**一次**取最小值的固定混合，`n`（query view 数）与 `m`（Practice 内容 view 数）只是同一个相似度矩阵的两个维度，并没有发生"多次检索"。本节把每个 query view 显式作为一次覆盖全部 eligible Practice 的检索轮次，再按各轮名次合并。

改动：

- `reader.ts` 的 `scoreSemanticRounds` 对每个 query view 单独产出该轮每个 Practice 的两段证据分数（`task-card` 最佳适用性 + `0.5 × body 最佳片段 + 0.5 × body 全片段均值`），`full` 仍不参与常规打分。
- `mergeSemanticRoundScores` 用 reciprocal rank fusion 合并各轮：`S[p] = Σ_i w_i / (k + rank_i(p) + 1)`，`k = 60`，`w_i` 是 query view 的基准权重。合并只看每轮名次，不叠加跨轮不可比较的绝对余弦；多轮都靠前的 Practice 累积更多证据，单轮最低分不再取最小值直接抵消其它轮次。
- 删除 `SEMANTIC_WEAK_CLAUSE_MIX` 和取最小值的跨 clause 混合；新增 `SEMANTIC_ROUND_FUSION_K`。这是内部排序语义变化，不改变 CLI/公开 API、index 行结构、Profile 或 snapshot/retry 语义，因此没有新增 migration。

本地验证：

- `bun test packages/engine/src/query/semantic`：43 pass / 1 skip / 0 fail（新增"多轮一致性优先于单轮尖峰""单轮只重排""轮数不一致抛错""基准权重缩放贡献"）。
- `bun run typecheck`：通过。

真实模型定向复测（本机 granite-embedding-97m-multilingual-r2 GGUF，生产 pooling/归一化参数；**当前已安装 4 Pack、90 条 Practice、1151 个 document views**；非官方 50 例 benchmark）：

| case | §15 固定最小值混合 core / forbidden | §16 多轮 RRF core / forbidden |
| --- | --- | --- |
| `issue-pr-body-scope-conflict` | #2 / #32 | **#1** / #28 |
| `issue-pr-readback-pack-context` | #2 / #5 | #3 / #4 |

每轮名次（新表示）：

| case | clause round | core rank | forbidden rank |
| --- | --- | --- | --- |
| `issue-pr-body-scope-conflict` | "I am opening a PR that fixes a React cache bug" | 10 | 1 |
| `issue-pr-body-scope-conflict` | "a reviewer will see it without our chat history" | 3 | 50 |
| `issue-pr-body-scope-conflict` | "so make the context and decision self-contained" | 30 | 87 |
| `issue-pr-readback-pack-context` | "After editing the Pack release issue on GitHub" | 9 | 2 |
| `issue-pr-readback-pack-context` | "check that the actual saved Markdown did not flatten the lists or lose paragraph breaks" | 1 | 8 |

解读：第一例的核心 Practice 在动作从句进入前 3、在背景从句被领域命中压低，RRF 让"多轮都靠前"压过"只在背景轮第一"，核心升到 #1、禁项从 #32 降到 #28。第二例的禁项在背景轮第 2、核心在动作轮第 1，RRF 后核心 #3、禁项 #4；核心名次比 §15 的 #2 轻微下降，**这不是全面改善**，必须如实记录。

限制：

- 当前安装语料是 **90 条 Practice / 1151 views**，与交接时 benchmark 固定的 **97 条 Practice / 1233 views** 不一致；本表只做方向性对照，不能替代 §3.2/§3.3 的冻结 benchmark 对比。
- RRF 的 `k = 60` 是标准默认值，不是针对这两条 case 调出来的；但两条 case 上"第一例改善、第二例轻微下降"说明它仍是排序交换，不是已验证的最优融合。
- clause 拆解只使用跨语言标点，没有 `intent`/`moment` 角色；把每轮带上语义角色是后续隔离实验（§7.6/§16 之外），不得据此宣称手工权重最优。

## 17. 多轮轮次族的组合对照（2026-09-29）

> 2026-09-29 回退：本节结论已被 §19 取代；轮次族与二层 RRF 不再进入默认。

§16 只把"每个 query view 一轮"作为默认。按维护者意见，多轮不限于这一种，practice 的多个内容 view 也可以各自成轮。因此本节把四类候选轮次族放进同一个 reciprocal rank fusion（共享名次、`k = 60`）里**组合**评估，而不是单独挑一个：

| 轮次族 | 每轮是什么 |
| --- | --- |
| A 查询视角轮 | 每个 query clause 一轮，轮内分数 = `0.5 × task-card 最佳 + 0.5 × body 片段证据` |
| B 表示族轮 | 每个 (query clause × `task-card`/`body`) 一轮，轮内分数 = 该族最佳余弦 |
| C 单向量轮 | 每个 (query clause × 单个持久化 view) 一轮，轮内分数 = 该 view 的余弦 |
| D 细化轮 | 用第一轮最强的 5 个 Practice 的 `task-card` 向量（总权重 0.2）细化 query，再跑一次 A |

真实模型对照（同一模型、当前 4 Pack / 90 Practice / 1151 views；非官方 50 例 benchmark）：

| 组合 | `issue-pr-body-scope-conflict` core / forbidden | `issue-pr-readback-pack-context` core / forbidden |
| --- | --- | --- |
| A | #1 / #28 | #3 / #4 |
| A+B | #1 / #26 | #4 / #3 |
| A+C | #3 / #5 | #3 / **#1** |
| A+B+C | #3 / #6 | #4 / **#1** |
| A+D | **#1 / #29** | **#2 / #4** |
| A+B+D | #1 / #27 | #4 / #3 |
| A+B+C+D | #3 / #6 | #3 / **#1** |
| A+B+C+D 等权归一 | #1 / #28 | #3 / #4 |

解读：

- **C（单向量轮）单独或按原始权重并入会放大 scope error**：第二例的 forbidden Practice 在 `A+C` / `A+B+C` / `A+B+C+D` 下直接升到 #1。原因与 §15 记录的机会偏差一致——单向量轮让"body 块多、噪声 view 多"的 Practice 拿到更多轮次。因此 C 不能按原始权重直接堆进默认路径。
- **B 按原始权重并入对第一例略好，但对第二例把核心往下压**（A+B 第二例 core #4）。等权归一后第二例仍不如 A+D。
- **A+D 是两条 case 上对"核心 Practice 排名"最平衡的组合**：第一例保持 #1、禁项基本不动；第二例核心由 #3 升到 #2，禁项保持 #4。这就是当前实现采用的组合，也就是 §16 的"query view 轮次 + 一次受限细化轮，再按名次融合"。
- A+B+D 在第一例的禁项上更好（#27），代价是第二例核心退到 #4。没有一条组合能同时压过 A+D 的第二例核心；因此不以偏概全地宣称"轮次越多越好"。

限制：

- 这仍是 90 / 1151 的安装语料与两条冻结 case 的定向对照，不是 97 / 1233 冻结 benchmark，也不是规模或多语言泛化证明。
- 细化权重的 0.2、种子数 5、只取 `task-card` 都是**受约束的初始默认值**，不是调优结果；§17 记录了错误种子会被放大（见 "A+C"）的风险，后续仍要在冻结集上监控 forbidden 是否被拉进前五。
- 本节只比较"如何把全量单向量检索累加成轮次"；它不替代 §3.2/§3.3 的正式 benchmark。

## 18. 轮次族的全量组合对照与二层融合（2026-09-29）

> 2026-09-29 回退：本节结论已被 §19 取代；`2lvl A+C+D` 不再是产品默认。

§17 只用两条冻结 case 做族对照，并据此把 C 族（单视图轮）判为"放大 scope error、排除"。那是以偏概全：同一批组合在全 50 例冻结集上既没有单族全面占优，C 族也不是单纯变差。本节把 §17 的结论整体重做，并把默认融合改为**族内先融合、族间等权**的二层 RRF。§17 的"排除 C"结论由本节取代，§16.2 的单层融合由 17.2/本节取代。

方法与口径（本机 Windows，非官方 harness）：

- 用例：`retrieval-ranking/v2` 的 **50 条 labeled case** 与其 `private/labels.json`；50 条 case 的 `coreIds` 全部存在于语料中。
- 语料：冻结 Store `artifacts/retrieval-ranking/store-6bf1e1b-v4`，97 条 Practice；按当前 `SEMANTIC_PROJECTION_VERSION = 4` 重新投影为 1232 个 views。
- 模型：本机 `granite-embedding-97m-multilingual-r2` GGUF，与产品相同的 pooling/归一化参数。
- 打分：直接复用生产 `scoreSemanticFamilyRounds` / `mergeSemanticRoundScores`（`k = 60`），A 族与 D 族沿用 §16/§17 的配方。
- 指标：`core hit@1/@3/@5` = 最佳 core 名次是否 ≤ K；`top-20` = core 是否进全量排序前 20（`candidateIds` 在 N=20 下的代理）；`MRR` = core 名次倒数均值；`scope` = forbidden Practice 进入 top-5 的 case 数（与官方 scorer 的 `forbidden.finalScopeErrorAtK` 同义）；`forbidden 在 core 之前` = 任一 forbidden 的名次优于最佳 core 的 case 数。

| 组合 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope | forbidden 在 core 之前 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A（查询视角轮，仅） | 26 | 39 | 43 | 48 | 0.6587 | 2 | 0 |
| B（表示族轮，仅） | 24 | 37 | 44 | 48 | 0.6418 | 2 | 1 |
| C（单视图槽位轮，仅） | 22 | 31 | 37 | 46 | 0.5725 | 2 | 1 |
| D（细化轮，仅） | 24 | 39 | 43 | 47 | 0.6535 | 2 | 0 |
| A+B（单层平铺） | 27 | 36 | 45 | 48 | 0.6674 | 2 | 1 |
| A+C（单层平铺） | 22 | 32 | 39 | 47 | 0.5841 | 2 | 1 |
| A+B+C（单层平铺） | 23 | 35 | 40 | 47 | 0.6137 | 2 | 1 |
| A+D（上一版默认） | 25 | 40 | 43 | 47 | 0.6541 | 2 | 0 |
| A+B+D（单层平铺） | 27 | 36 | 44 | 48 | 0.6676 | 2 | 1 |
| A+C+D（单层平铺） | 22 | 33 | 39 | 46 | 0.5873 | 2 | 1 |
| A+B+C+D（单层平铺） | 22 | 35 | 41 | 48 | 0.6081 | 2 | 1 |
| A+B 等权归一 | 27 | 36 | 45 | 48 | 0.6674 | 2 | 1 |
| A+C 等权归一 | 22 | 32 | 39 | 47 | 0.5841 | 2 | 1 |
| A+B+C 等权归一 | 23 | 35 | 40 | 47 | 0.6137 | 2 | 1 |
| A+B+C+D 等权归一 | 25 | 41 | 43 | 47 | 0.6709 | 2 | 0 |
| 2lvl A+B | 26 | 37 | 43 | 48 | 0.6571 | 2 | 1 |
| 2lvl A+C | 23 | 38 | 44 | 48 | 0.6326 | **1** | 1 |
| 2lvl A+B+C | 26 | 39 | 44 | 48 | 0.6764 | 2 | 1 |
| 2lvl A+B+C+D | **30** | 39 | **44** | 48 | **0.7120** | 2 | 1 |
| 2lvl A+D | 25 | 40 | 43 | 47 | 0.6541 | 2 | 0 |
| 2lvl A+B+D | 26 | 39 | 43 | 48 | 0.6620 | 2 | 0 |
| **2lvl A+C+D（采用）** | 27 | 40 | 43 | **48** | 0.6902 | 2 | 0 |
| PROD A+C+D（生产函数复算） | 27 | 40 | 43 | 48 | 0.6902 | 2 | 0 |

（`2lvl` = 族内先 RRF、族间再等权 RRF；无前缀的组合 = 把各族的轮次平铺进同一次 RRF，或对外层的族结果再 RRF。）

综合读法（不挑单点）：

- **没有单族全面占优。** A 族在 hit@5/top-20 上最稳；B 族把 hit@5 抬到 44 却把 hit@3/MRR 压低；C 族单独使用最弱（MRR 0.5725、top-20 46），却是族间融合里压住 `react-hydration-zh` forbidden 尖峰的那一项；D 族单独也弱于 A，但和 A 组合能抬 hit@3。
- **C 族的问题出在单层平铺，不在 C 本身。** 单层 `A+C` / `A+B+C` 让 `issue-pr-body-scope-conflict` 的 forbidden 从 A 的 #30 升到 #5/#4，同时把 `react-hydration-zh` 的 forbidden 从 #5 压到 #16/#9。这是此消彼长，不是单纯退化；族内先融合、族间等权后（`2lvl A+C+D`）这个 trade 被吸收。
- **采用的默认 `2lvl A+C+D` 相对上一版默认 `A+D` 是严格改进。** hit@1 25 → 27、top-20 47 → 48、MRR 0.6541 → 0.6902，hit@3（40）、hit@5（43）、scope（2）、forbidden 在 core 之前（0）全部不变。
- **B 被测量但未进默认。** `2lvl A+B+C+D` 给出全场最好的 hit@1（30）与 MRR（0.7120），代价是把 `issue-pr-readback-pack-context` 的 forbidden 抬到 core 之前（core #4 / forbidden #2）。B 族是纯 `max`、没有 body 均值的反向约束，正是参考里记录的"块数越多越容易碰到一次高分"的机会偏差。因此它作为一个可测量的族保留，不进入默认，也不写成"B 无效"。
- **官方 scope 口径下几乎所有组合都是 2 个 case，但**是哪些 case**在变。A/A+D/`2lvl A+C+D` 的 scope case 是 `readback-pack-context` + `react-hydration-zh`（与冻结 baseline 相同）；单层 `A+C`/`A+B+C` 换成 `body-scope-conflict` + `readback-pack-context`；只有 `2lvl A+C` 降到 1（去掉 `react-hydration-zh`），代价是 hit@1 掉到 23、MRR 0.6326。
- baseline 参照：冻结 v2 baseline（`caecc53`，旧单向量 Profile）为 `finalHit@5 42/50`、`candidateRecall@20 49/50`、`scopeError 2`。本表是当前 build 在冻结语料上的本地全量对照，**不是同 Profile 的官方对比**，只用于选择默认组合与防止回归。

关键 case 的逐例名次（core / forbidden）：

| 组合 | `issue-pr-body-scope-conflict` | `issue-pr-readback-pack-context` | `react-hydration-zh` |
| --- | --- | --- | --- |
| A | 1 / 30 | 3 / 5 | 1 / 5 |
| A+D（上一版默认） | 1 / 32 | 3 / 5 | 1 / 5 |
| 2lvl A+C | 1 / 11 | 4 / 2 | 1 / 6 |
| 2lvl A+B+D | 1 / 29 | 3 / 4 | 1 / 4 |
| 2lvl A+B+C+D | 1 / 19 | 4 / 2 | 1 / 4 |
| **2lvl A+C+D（采用）** | 1 / 19 | **2 / 3** | 1 / 5 |

`2lvl A+C+D` 同时把 `readback` 的 core 从 #3 抬到 #2 并保持 forbidden 在其后，没有像 `2lvl A+B+C+D` 那样把 forbidden 放到 core 之前。

一致性校验：把同样的 50 例喂给生产 `readCandidateRows` 的等价路径（`scoreSemanticFamilyRounds` + 二层融合）复算，`PROD A+C+D` 与选中的 `2lvl A+C+D` 逐例 core/forbidden 名次 **0 处不一致**（聚合行完全相同）。

实现与回归：

- `reader.ts` 新增 `scoreSemanticFamilyRounds`（一次 cosine 遍历同时产出 A 族轮与 C 族槽位分数）；`scoreSemanticRounds` 保留为兼容包装。
- `orderPracticeViews` 显式重建 `full` → `task-card` → `body` 的槽位顺序（索引读取路径没有 `ORDER BY`，不重排会让槽位轮依赖 SQLite 行序）。
- `readCandidateRows` 改为族内 RRF + 族间等权 RRF；细化种子仍取自 A 族前 5，`SEMANTIC_REFINEMENT_WEIGHT = 0.2` 不变。
- `bun test packages/engine/src/query/semantic`：46 pass / 1 skip / 0 fail（新增槽位顺序、行序无关与并列名次回归）。
- `bun run typecheck`：通过。

限制：

- 这是主仓库本地、非官方 harness 的 50 例定向对照；没有跑 benchmark 的 harness/scorer，也没有固定新的 build SHA。§3.2/§3.3 仍未完成，不得把本表当成官方 benchmark 结果。
- 冻结 Store 按当前配方重投影为 **1232** views（suite inventory 记为 1233，差异未归因）；`top-20` 是全量排序前 20 的代理，不是 harness 实际返回的 `candidateIds`。
- 本表在"当前按 v4 配方重投影的冻结语料"上比较**检索算法**，不是"旧 Profile artifact 对新 Profile artifact"的官方跨 Profile 对比；baseline 数字只作方向参照。
- 族集合（A+C+D）与"族间等权"是在这 50 例上选出的默认，不是规模、跨语言或生产泛化证明；`k = 60` 仍是标准默认值而非调参结果。
- 两个已知 scope error 中没有一条组合能同时修掉（`2lvl A+C` 只修掉 `react-hydration-zh`；`readback-pack-context` 在所有组合下仍进 top-5）。这仍是下一步 query-role analyzer 的回归证据。

## 19. 回退多轮与名次融合，恢复单次向量检索（2026-09-29）

> 2026-09-29 后续修正：本节记录的跨-clause 聚合仍带"与最弱 clause 混合"项；该项已由 §20 的单变量消融否决并删除，当前聚合是纯加权平均。本节其余内容（回退多轮/RRF）仍然有效。

维护者判定 §16–§18 的方向错误：多轮检索最后落成 reciprocal rank fusion，**用名次替代了向量余弦**；而且默认值需要靠族组合取舍来挑，仍然是在几种排序算法之间选边。因此本 change 的检索回到"一次全量向量打分"，多轮、轮次族、细化轮与 RRF 全部撤回。

代码回退（`packages/engine/src/query/semantic/index/reader.ts`）：

- 删除 `scoreSemanticFamilyRounds`、`scoreSemanticRounds`、`SemanticRoundScore`、`SemanticPracticeRoundScores`、`SemanticPracticeFamilyRounds`、`SEMANTIC_REFINEMENT_SEED_COUNT`、`SEMANTIC_REFINEMENT_WEIGHT`、`refineQueryScores`、`SEMANTIC_ROUND_FUSION_K`、`mergeSemanticRoundScores`。
- 新增 `scoreSemanticPractice`：每个 clause 先得到 clause 分数（`task-card` 最佳适用性与 body 片段证据的等权平均，body 证据为 `0.5 × 最佳片段 + 0.5 × 全片段均值`），再按 query view 权重加权平均，并与最弱 clause 做固定非负混合（`SEMANTIC_WEAK_CLAUSE_MIX = 0.5`）。全量 eligible Practice 只排序一次。
- `readCandidateRows` 只做一次打分与排序，tie-break 回退到 Practice ID；`orderPracticeViews` 保留，仅用于让 `bestView*` 诊断在并列余弦下确定。`full` 仍不参与常规打分，额外 body 块仍不线性加分，词面通道仍被 `no-lexical-scoring.test.ts` 挡住。
- 同步回退 `proposal.md`、`design.md`、`specs/retrieval-query/spec.md`：删除"轮次族 + reciprocal rank fusion"要求，改为"同一次检索内聚合"要求。

回退后效果（生产 `scoreSemanticPractice`，冻结 v2 的 50 条 labeled case，冻结 `store-6bf1e1b-v4` 97 Practice / 1232 views，真实模型，非官方 harness）：

| 检索 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope（forbidden 进 top-5） | forbidden 在 core 之前 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 单次向量检索（当前） | 26 | 39 | 42 | 46 | 0.6622 | 2 | 0 |
| 2lvl A+C+D（§18，已撤回） | 27 | 40 | 43 | 48 | 0.6902 | 2 | 0 |

读法：回退在聚合排序指标上是一笔**已记录的小幅代价**（hit@1 −1、hit@3 −1、hit@5 −1、top-20 −2、MRR −0.0280），两个安全口径（top-5 内 scope 数、forbidden 是否越过 core）保持不变。按维护者的纠正意见，当前顺序由向量余弦的单次聚合决定，不再由名次融合决定。

回归与验证：

- `reader.test.ts` 重写为单次聚合语义：`full` 不参与打分、task-card/body 平衡、额外 body 块不线性加分、局部片段可见、背景 clause 不能带过整条 Practice、clause 权重缩放、读取行序无关、练习无可打分 view 时报错、query 维度不匹配报错。
- `bun test packages/engine/src/query/semantic`：45 pass / 1 skip / 0 fail。
- `bun run typecheck`：通过。

限制：

- 上表是主仓库本地、非官方 harness 的定向对照；§3.2/§3.3 仍未完成，不得当成官方 benchmark 结果。
- 单次聚合的跨 clause 混合仍是一个固定非负权重（β = 0.5），没有 `intent`/`moment` 角色信息；它不是已校准的相关性模型。若将来重新引入多轮检索，必须先说明它仍在做向量检索，而不是换成另一套名次算法。

## 20. 跨-clause 最弱值惩罚的单变量消融（2026-09-29）

§19 回退到单次向量检索后，效果仍偏低（hit@1 26 / hit@5 42 / top-20 46 / MRR 0.6622）。维护者问"是不是偏移了导致效果不行"。为回答这个问题，用同一批冻结输入做了**单变量消融**：只改跨-clause 聚合，其余（query clause 拆解、多视角表示、`task-card`/body 片段证据、全量排序、模型、语料、用例）全部固定。

方法：

- 用例与语料同 §18/§19：冻结 v2 的 50 条 labeled case，冻结 `store-6bf1e1b-v4` 97 Practice / 1232 views，真实模型。
- 复算保护：脚本自带"当前实现"分支并与生产 `scoreSemanticPractice` 逐 Practice 比对，**0 处不一致**（|Δ| ≤ 1e-6），确保消融测的是线上公式而不是另写一套。
- 变体：`β` 为最弱 clause 的混合权重，`S = (1-β)·加权平均 + β·min(clause)`；另有"只取 max clause"作为对照。

| 跨-clause 聚合 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope（forbidden 进 top-5） | forbidden 在 core 之前 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| β = 0.50 min（§19 记录） | 26 | 39 | 42 | 46 | 0.6622 | 2 | 0 |
| β = 0.25 min | 29 | 43 | 44 | 47 | 0.7093 | 2 | 0 |
| **纯加权平均（当前，β = 0）** | **33** | **43** | **45** | 47 | **0.7637** | 2 | 1 |
| 只取 max clause | 27 | 37 | 40 | 49 | 0.6568 | 1 | 2 |

结论：

- 效果偏低的原因确实是一处偏移，而且是"最弱 clause"这一项：它对排序指标单调有害（β = 0.5 → 0.25 → 0 时 hit@1 为 26 → 29 → 33，hit@5 为 42 → 44 → 45，MRR 为 0.6622 → 0.7093 → 0.7637）。该项本意是挡住"背景 clause 独自带过整条 Practice"，但它同时惩罚了"动作 clause 命中、背景 clause 很弱"的正确 Practice。
- 反向极端也不成立：只取 `max(clause)` 虽然把 top-20 抬到 49，但 hit@5 掉到 40、MRR 掉到 0.6568，并新增两条 forbidden 越位。当前采用的纯加权平均不需要可调系数，且是这几个变体里综合最好的。
- 守卫没有丢：动作 clause 的近零余弦会按基准权重计入平均值，把"只命中背景"的 Practice 稀释下去；`min` 只是额外放大了这种惩罚，并把正确的 Practice 一起压低。
- 代价如实记录：纯加权平均下 `issue-pr-readback-pack-context` 的 forbidden 从 core 之后变为 core 之前（core#5 / forbidden#3）。该案例在所有已测配置下本来就是 scope error（forbidden 进 top-5），差异只在两条都进 top-5 的条目之间的先后。

实现与回归：

- 删除 `SEMANTIC_WEAK_CLAUSE_MIX` 与该混合项；`scoreSemanticPractice` 的跨-clause 聚合为按 query view 基准权重的纯加权平均。
- `reader.test.ts` 更新："背景 clause 不能带过整条 Practice"现在断言被稀释到 0.5（两 clause、权重 1:1、分数 1.0 与 0.0），权重缩放断言变为 0.75。
- `bun test packages/engine/src/query/semantic`：通过；`bun run typecheck`：通过；生产函数复算与消融中的"纯加权平均"变体 0 误差。

限制：

- 仍是主仓库本地、非官方 harness 的 50 例定向对照；§3.2/§3.3 未完成。
- `β` 的扫描只到 0.5/0.25/0；没有做逐 case 的显著性检验，也没有在多语言或更大语料上验证。

## 21. 无关 Practice 排名靠前的机制诊断与结构规避（2026-09-29）

本节回答一个问题：**为什么不该赢的 Practice 总能排到前面，机制是什么，怎么从结构上规避。** §20 已把跨-clause 聚合定为纯加权平均并给出当前指标（hit@1 33 / hit@3 43 / hit@5 45 / top-20 47 / MRR 0.7637 / scope 2 / forbidden-before-core 1）。本节不调参、不改生产代码，只做取证、机制归类与修法消融。

### 21.1 方法与复算保护

- 冻结输入：suite `retrieval-ranking/v2` 的 50 例 query；语料 Store `store-6bf1e1b-v4`（97 Practice，按当前 v4 配方投影为 1232 views：full/task-card/body）；模型为本机 granite-embedding-97m-multilingual-r2 GGUF，经 `createEmbeddingProcess`（4 threads、`llamaArguments` 生产 pooling/归一化）编码一次，向量缓存于 `%TEMP%`，分析脚本不重复编码。gold labels 只在检索结果算完之后由分析侧读取，从未进入任何打分路径。
- 临时脚本（dot-prefixed，位于 `packages/backend/src/benchmark/`，本节写完后删除）：`.diagnose-encode.ts`（编码+缓存）、`.diagnose-run.ts`（基线重放+逐例取证）、`.diagnose-hypotheses.ts`（机制检验）、`.diagnose-ablations{,2,3}.ts`（修法消融）、`.diagnose-lib.ts`（共享库）。
- **复算保护**：脚本内独立重推 `scoreSemanticPractice` 的完整分解（task-card 最佳、body 最佳/均值、clause 分数、加权平均），与生产函数逐 Practice 比对：50 例 × 97 Practice = 4850 对，**maxDelta = 0**（远优于 1e-6 门槛）。control 指标与 §20 的"纯加权平均"行逐项一致，"只取 max clause"复算与 §20 同行完全一致（27/37/40/49/0.6568/1/2），证明本节测的是线上公式。
- 指标口径同 §18：scope = forbidden 进 top-5 的 case 数；fbc = 任一 forbidden 名次优于最佳 core 的 case 数。

基线复现（control，生产公式）：hit@1 33、hit@3 43、hit@5 45、top-20 47、MRR 0.7637、scope 2、fbc 1——与交接数字完全一致。`react-hydration-zh` 当前口径：**core #1、forbidden #3**（core 在前，属 scope error 而非 fbc）。

### 21.2 逐例取证

每个 miss/scope case 的 top-5（短 ID + 生产分），以及 core 的名次与关键分解。`tc`/`body` 为该 clause 在此 Practice 上的 task-card 最佳余弦 / body 片段证据（0.5×max+0.5×mean）。

**agentic-acceptance-direct（core `requirements.define-acceptance-and-non-goals` #30，0.7795）**

| # | Practice | 分数 | 依据 |
| --- | --- | --- | --- |
| 1 | verification.close-or-declare-evidence-gaps | 0.8033 | 语料第 3 大 hub（p98）；task-card 含 "acceptance criteria"，两个 clause 都高于 core（0.7628/0.8437 vs 0.7446/0.8145） |
| 2 | implementation.confirm-product-surface-expansion | 0.7978 | 同为 hub 族；c1 tc 0.8718 全场最高之一 |
| 3 | implementation.replan-on-material-drift | 0.7957 | 语料第 1 大 hub（p100），三处 case 的 top-5 常客 |
| 4 | delivery.claim-only-supported-outcome | 0.7955 | "verified/complete" 词族与 c1 的 "we can verify" 重合 |
| 5 | requirements.ground-user-goal | 0.7925 | （另一 case 的 core） |
| 30 | **CORE** | 0.7795 | 两个 clause 都输（差距 0.018/0.029），非 clause 结构问题 |

**agentic-goal-paraphrase（core `requirements.ground-user-goal` #30，0.7764）**

| # | Practice | 分数 | 依据 |
| --- | --- | --- | --- |
| 1 | planning.plan-sufficient-evidence | 0.7970 | c0 "Before planning" 词面直接命中 planning 卡（c0 0.8093 vs core 0.7734） |
| 2 | implementation.surface-unconfirmed-assumptions | 0.7956 | c2 "two plausible interpretations" 命中 "temporary interpretation"（0.7946 vs core 0.7303） |
| 3 | verification.close-or-declare-evidence-gaps | 0.7931 | hub（p98） |
| 4 | pack-creator.authoring.use-realistic-failure-mechanisms | 0.7909 | 跨域：作者域 "plausible failure" 语义搭上 c2 |
| 5 | implementation.replan-on-material-drift | 0.7894 | hub（p100） |
| 30 | **CORE** | 0.7764 | **动作 clause c1 全场第 9（0.8257，高于 winner 的 0.8095）**，被 c0/c2 两个背景 clause 拖死 |

**agentic-proportionate-validation（core `planning.scale-work-to-risk-and-cost` #22，0.7777）**

| # | Practice | 分数 | 依据 |
| --- | --- | --- | --- |
| 1 | implementation.replan-on-material-drift | 0.7946 | **纯 hubness**：winner−core 差 0.0169 中 0.0147（87%）是它在 50 个无关 query 上的平均领先 |
| 2 | verification.bind-evidence-to-artifact-state | 0.7894 | hub（p92） |
| 3 | pack-creator.evaluation.separate-structural-and-semantic-evidence | 0.7893 | hub（p94），c1 "browser matrix/load test" 命中其 "schema checks/retrieval runs" |
| 4 | issue-pr.issue.converge-on-one-problem… | 0.7883 | 语料第 2 大 hub（p99） |
| 5 | delivery.claim-only-supported-outcome | 0.7855 | hub 族 |
| 22 | **CORE** | 0.7777 | 三个 clause 全部处于第 9–22 名，无结构上的单一病灶 |

**agentic-limit-investigation（core `implementation.limit-investigation-to-current-decision` #10，0.7916）**

| # | Practice | 分数 | 依据 |
| --- | --- | --- | --- |
| 1 | pack-creator.design.separate-neighboring-triggers | 0.8122 | c0 "following references into more files" 命中作者域 "reference material/queries"（c0 0.8013 vs core 0.7579） |
| 2 | pack-creator.review.run-subtractive-content-review | 0.8020 | c1 "cannot name the decision each file will change" 命中 "remove content that does not change a decision"（tc 0.8457） |
| 3 | pack-creator.authoring.link-pack-resources-from-the-practice | 0.7993 | "references → 链接补充材料" 跨域碰撞 |
| 4 | agentic.review.run-subtractive-review-before-commit | 0.7992 | hub 族 + "files" 语义 |
| 5 | pack-creator.design.decompose-one-decision-per-practice | 0.7976 | "decision per practice" 与 c1 的 "decision each file" 碰撞 |
| 10 | **CORE** | 0.7916 | c1 名次 #2（仅差 0.0022），c0 第 46 → 被 c0 拖入 pack-creator 阵营 |

**agentic-review-finding（core `review.validate-findings-before-action` #14，0.8055）**

| # | Practice | 分数 | 依据 |
| --- | --- | --- | --- |
| 1 | implementation.replan-on-material-drift | 0.8255 | hub（p100）；gap 0.0200 中 0.0103（52%）为无关 query 平均领先 |
| 2 | testing.classify-failure-before-changing-test | 0.8200 | c1 "against the code and tests" 命中 "test/check" 词族（c1 0.8510 vs core 0.8170） |
| 3 | issue-pr.pull-request.match-the-change-to-the-required-upstream-gate | 0.8170 | 跨域：c0 "review comment" 命中协作流程卡 |
| 4 | correction.restore-authoritative-baseline | 0.8103 | hub（p96） |
| 5 | testing.anchor-tests-to-requirements | 0.8100 | c1 0.8588（"tests" 碰撞） |
| 14 | **CORE** | 0.8055 | 两个 clause 均第 16 名，无单一 clause 病灶 |

**issue-pr-readback-pack-context（core #5，0.7937；forbidden #3，0.7950 → fbc）**

| # | Practice | 角色 | 分数 | 依据 |
| --- | --- | --- | --- | --- |
| 1 | pack-creator.release.verify-the-supported-install-path… |  | 0.7990 | c0 "Pack release issue on GitHub" 直接命中其 release 卡（c0 0.8398） |
| 2 | issue-pr.communication.write-in-the-repos…clean-markdown |  | 0.7966 | c1 的 "saved Markdown" 命中标题 "Clean Markdown"（c1 0.8005） |
| 3 | pack-creator.release.preserve-versioned-content-and-provenance | **FORBIDDEN** | 0.7950 | c0 tc 0.8276：applies_when 含 "Pack content…release sources…publish"，纯领域名词 |
| 4 | pack-creator.discovery.choose-project-local-or-registry-release |  | 0.7940 | 同为 release 词族（c0 0.8389） |
| 5 | communication.read-back-your-post-before-requesting-review | **CORE** | 0.7937 | **c1（动作 clause）全场第 1（0.8012）**，c0 第 13；1:1 平均后被 c0 反超 |

**react-hydration-zh（core `react.rendering.hydration-consistency` #1，0.8083；forbidden `…keep-secrets-and-private-material-out-of-the-diff` #3，0.7829，scope）**

forbidden 是英文协作域 Practice，与中文 hydration query 零词面交集；其 c1 body 最佳余弦 0.8307、总分 0.7829 完全来自模型的"万有高余弦地板"（见 21.3 M2），best body 片段内容为 "A published diff is copied immediately and permanently by crawlers…"，与 hydration 无任何语义关联。此 case 不存在 hubness（core 与 forbidden 的 hub 百分位分别为 p39/p47）。

### 21.3 机制归类（假设 a–f 逐条判定）

**M1 Hubness/通用型 Practice（假设 a）：支持，且可持久化度量。**
- 97 条 Practice 对 50 个 query 的总分均值（即"无关 query 探针"，每条 Practice 对 ≥48 个 query 无关）分布为 0.7481–0.7926：最高为 `replan-on-material-drift`（0.7926），其下依次 `converge-on-one-problem…`（0.7887）、`close-or-declare-evidence-gaps`（0.7865）；最低三条全是 React 专题 Practice（0.7481–0.7538）。
- 5 个 miss case 里压过 core 的 Practice 高度集中于高 hub 百分位：proportionate 前 21 名中 p90+ 有 8 个；review-finding 前 13 名中 p90+ 有 6 个；acceptance 前 29 名中 p90+ 有 9 个。
- 定量归因：winner−core 分差中属于"无关 query 上的平均领先"（hubness 成分）的比例：proportionate 87%（0.0147/0.0169）、review-finding 52%、acceptance-direct 37%、goal-paraphrase 3%、limit-investigation 0%、readback 为负（core 自身均值更高）。
- 生产可计算的先验（该 Practice task-card 对其余全部 task-card 的最佳余弦均值，只依赖已持久化向量）与实测 hub 均值的 **Pearson r = 0.929**。
- 但 scope 两 case 不由 hubness 解释（readback 的 forbidden 仅 p52，core 自身 p85；react-hydration 见 M2）。

**M2 余弦尺度不可比/各向异性（假设 b）：支持，是根底条件。**
- 1232 个 view 向量的语料均值向量范数 0.8918（单位向量均值），随机 view 对余弦 0.794±0.039（min 0.663）。任何两个文本的"地板"就在 0.79 附近：英文 forbidden 对中文无关 clause 也拿 0.83。
- 全部 4850 个 (query, Practice) 分数：min 0.6979 / p25 0.7560 / median 0.7727 / p75 0.7879 / p95 0.8111 / max 0.8838——排序发生在一条 ~0.02 宽的带里。
- 每 Practice 跨 query 分数 std 中位数 0.0221，与 winner−core 分差（0.005–0.024）同量级：**名次由与 query 特定相关度同量级的 practice 固有偏移决定**。
- 但主成分分散（centered 方差 PC1 7.4%、PC2 5.1%、PC3 4.0%、PC4 3.7%），没有单一主导方向——预示"去均值/去主成分"不会是银弹（消融证实，见 21.4）。

**M3 clause 拆解产生泛化片段（假设 c）：支持，对 3/7 个 case 是决定性机制。**
- leave-one-clause-out（只删该 clause、其余不动）对 core 名次的影响：

| case | base | 删 c0 | 删 c1 | 删 c2 |
| --- | --- | --- | --- | --- |
| readback | #5 | **#1** | #13 | （两 clause） |
| limit-investigation | #10 | **#2** | #46 | （两 clause） |
| goal-paraphrase | #30 | #26 | #45 | **#13** |
| proportionate-validation | #22 | #30 | #10 | #54 |
| acceptance-direct | #30 | #23 | #46 | （两 clause） |
| review-finding | #14 | #16 | #16 | （两 clause） |
| react-hydration-zh | #1 | #1 | #1 | #1 |

readback 的 fbc 与 scope 全部由背景 clause c0（"After editing the Pack release issue on GitHub"，corpus 均值 0.7501、std 0.0317、max 0.8398）造成；limit-investigation 由 c0 的跨域 "references" 碰撞造成；goal-paraphrase 两个背景 clause（"Before planning"、复述性陈述）合计把动作 clause 第 9 的 core 拖到 #30。反向证据同样重要：proportionate 删任何背景 clause 都更糟——该 case 的病灶是 M1 不是 M3。
- 最泛化 clause（corpus 均值最高）如 "Before commit"（0.8009）、"While implementing"（0.8115）、"Rewrite the applicability condition"（0.8169）：两词背景/框架片段把整个语料普遍抬高。注意泛化 ≠ 均值高：readback 的动作 clause c1 均值（0.7416）反而低于 c0，但 std 更紧（0.0217 vs 0.0317）——c0 是"上限高、分布散"的误导型 clause。

**M4 body 片段证据的机会偏差（假设 d）：不支持，方向相反。**
- body 块数与无关 query 平均分：Pearson −0.742 / Spearman −0.457；与无关 query body 最佳余弦：Pearson −0.424。`0.5×max + 0.5×mean` 中 mean 半边占优，块多稀释均值；React Practice（12–14 块）恰是 anti-hub。机会偏差在此语料不可见，不是当前错误来源。

**M5 task-card:body 固定 1:1（假设 e）：判定为"非病灶"。**
- λ 扫描（clause 分数 = λ·task-card 最佳 + (1−λ)·body 证据）：λ=0（纯 body）27/32/38/46/0.6308；λ=0.25 28/40/45/47/0.6951；**λ=0.5（当前）33/43/45/47/0.7637**；λ=0.75 32/42/43/48/0.7389；λ=1（纯 task-card）33/40/42/48/0.7423（scope 1、fbc 1）。当前 1:1 已在 hit@1/hit@5/MRR 的局部最优上；加大 task-card 只小幅改善 scope 与 top-20、损伤 hit@3/hit@5。

**M6 领域名词泄漏（假设 f）：部分支持，但不是主通道。**
- task-card 按构造不含 `tech_stack`（逐条断言通过）；检出的 9 处"tech_stack 词出现在 task-card"全部是 React Practice 标题里的自然词 "React"，非投影泄漏。
- 真实泄漏通道是 applies_when/title 的自然领域词：readback forbidden 的 c0 优势（tc 0.8276）来自其 applies_when 的 "Pack content…release sources…publish"；这类词对"背景 clause"有决定性影响（与 M3 叠加）。
- react-hydration 的 forbidden 与 query 零词面交集，其分数是 M2 的地板，与领域词无关。
- **更正（2026-10-01，见 §23）**：117/117 最佳 task-card view 为 `task-card:0000` 的观察成立，但不能据此排除 anti-pattern 文本的影响。冻结语料的 97 条 Practice 共生成 97 个 task-card view；当前首块已经同时包含 title、applies_when、stage 与 anti-pattern name/description。view ID 无法分解块内文本的贡献。§23 的实际单变量实验进一步表明，直接从 task-card 移除 anti-pattern 会降低整体质量；这不等于证明 anti-pattern 不参与错误，也不支持把它作为负权重。

### 21.4 候选修法与单变量消融（同一 50 例）

所有消融只改单一环节，其余（clause 拆解、v4 表示、task-card/body 证据、全量排序、模型、语料）与 control 完全一致；control 与生产公式逐分一致。

| 修法 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope | fbc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **control（生产）** | **33** | **43** | **45** | **47** | **0.7637** | **2** | **1** |
| P1 clause-对比度权重 | **35** | 41 | 44 | 47 | **0.7808** | 2 | 1 |
| P2 clause z-score 标准化 | 32 | 43 | 44 | 47 | 0.7429 | 2 | **0** |
| P3a 语料均值中心化 | 27 | 41 | 41 | 46 | 0.6777 | 3 | 1 |
| P3b +去 PC1 | 29 | 41 | 43 | 47 | 0.7048 | 2 | 0 |
| P3c +去 PC1–2 | 29 | 41 | 43 | 47 | 0.7073 | **1** | **0** |
| P3d +去 PC1–4 | 30 | 40 | 43 | 47 | 0.7078 | **1** | **0** |
| P4a hub 先验 γ=1 | 18 | 29 | 31 | 42 | 0.4979 | 3 | 1 |
| P4b hub 先验 γ=0.5 | 29 | 42 | 43 | 46 | 0.7003 | 3 | **0** |
| P4c hub 先验 γ=0.25 | 31 | 43 | 44 | 47 | 0.7423 | 3 | **0** |
| P4d hub 先验 γ=0.1 | 33 | 43 | 44 | 47 | 0.7703 | 2 | 1 |
| 对照：只取 max clause | 27 | 37 | 40 | 49 | 0.6568 | 1 | 2 |

**P1 信息量驱动的 clause 权重（推荐首选消融对象）**
- 结构：同一遍检索内，每 clause 已对全量 Practice 打分；取 `w_i ∝ max_p a[p,i] − mean_p a[p,i]`（该 clause 把头部拉开的能力），再按 w 加权平均。无新轮次、无词面、无持久化改动。
- 机制对应：M3——误导型背景 clause（readback c0、limit c0）虽有高 max，但只修 hit@1/MRR 方向；实测 readback 反而 #5→#6（c0 的对比度高于动作 clause），修好的是 scope-direct #2→#1、evidence-separation #2→#1、review-finding #14→#13、supported-claim #5→#4，代价 tests-from-acceptance #3→#4、scope-paraphrase #3→#4、hit@3 −2、hit@5 −1。
- 前提假设：一个 clause 的价值由它区分 Practice 的能力决定，而不是均匀 1:1。风险：把"平坦但正确"的动作 clause 降权（readback 即反例）。
- 验证计划：单变量落地后重跑同 50 例，主指标 hit@1/MRR，同时报告 readback 与 tests-from-acceptance 的回归；不改 Profile/迁移。

**P2 clause 分数 z-score 标准化后再聚合**
- 结构：对每 clause 用同遍检索得到的 corpus 分布 (mean_c, std_c) 标准化：`S_p = Σ_i (a[p,i]−mean_i)/std_i / n`。直接回应 design 已识别的"跨轮绝对分不可比"在 clause 维度的残留（readback c0 std 0.0317 > c1 0.0217，标准化等价于给更紧的动作 clause 放大区分度）。无持久化改动。
- 实测：fbc 1→0（readback core #5→#2，forbidden 落到其后），agentic-reground #2→#1；代价 10 个 case 名次小幅下滑（多为 #1→#2/#2→#3），MRR 0.7637→0.7429、hit@1 33→32。
- 与 P1 互斥方向（P1 奖励高方差 clause、P2 惩罚之）；二者不可叠加为默认，只能各自单变量验证后择一。z-score+contrast 组合实测 32/43/44/47/0.7430/scope2/fbc0，无综合优势。
- 验证计划：单变量重跑同 50 例，重点观察 fbc 归零是否稳定、MRR −0.021 是否可接受；不改 Profile/迁移。

**P3 语料锚定的中心化余弦（实测为负结果，保留证据）**
- 结构：build 时持久化语料 view 均值向量（可选前 k 主成分），打分时对 query 与 document 向量同减同投影后再余弦。需 index metadata 扩展 + Profile 升级 + 重建迁移（表示身份变化，旧 artifact 不兼容）。
- 实测：纯去均值 hit@1 33→27、MRR 0.7637→0.6777（变差）；逐步去 PC 后 hit@1 回到 30、scope 2→1、fbc 1→0，但仍全面低于 control。M2 的各向异性是弥散的（PC1 仅 7.4%），方向消减把 pack 级判别信号一并消掉。
- 结论：**在 97 条语料上不作为默认修法**；若未来语料扩大后各向异性集中（PC1 占比显著上升）可重测。

**P4 Practice 侧 hub 校准（机制成立、naive 校准被否决）**
- 结构：build 时持久化每 Practice 的 hub 先验（其 task-card 对全部其余 task-card 的最佳余弦均值，r=0.929 跟踪实测 hubness），打分时 `score − γ·(prior − mean)`。需持久化新列 + Profile 升级。
- 实测：γ=1 崩塌（hit@1 18）；γ=0.25 修 readback fbc 与 proportionate（#22→#21）但 9 个 case 回归（supported-claim #5→#9、review-finding #14→#17）；γ=0.1 中性（MRR +0.0066、hit@5 −1）。根因：**core 自己常是 hub**（readback core p85、review-finding core p87），全局减先验把正确答案一起压掉。
- 结论：先验可靠但"减常数"形态错误；若继续，必须换成按域内（同 pack/同 hub 层）校准或按先验方差的自适应收缩，并先在同 50 例证明无回归。当前不推荐。

**P5 anti_patterns 负证据：不立项。** 首块 ID 不能证明块内 anti-pattern 文本未影响排序（M6 已更正）；当前仍没有证据支持负权重。§23 另行检验的是“从 task-card 移除该文本”，不是负向打分，结果为质量回归，不能把两种干预混为一谈。

**P6 query 侧减少拆分：由 P1/P2 覆盖。** 短背景片段的问题（M3）不在"拆了"，而在"拆完等权"；再引入按长度的合并阈值属于新手调系数，且 leave-one-out 显示删背景 clause 对 proportionate 有害（背景 clause 有时是唯一正确信号）。不单独立项。

### 21.5 规避结论（按机制 → 修法映射）

- **M1 hubness（3/5 agentic miss 的主因）**：单靠检索侧公式修不干净（P4 证伪）；结构性出路在表示/语料层——pack 语义密度差异（agentic 通用词 vs react 专题词）决定了 hub 分布，任何全局先验都会误伤同为 hub 的 core。可持久的观测面：把 hub 先验作为诊断列持久化并在 benchmark 回读，而不是进排序公式。
- **M2 尺度不可比（react-hydration scope 的直接原因）**：中心化在此语料是负结果（P3），但它同时改善 scope/fbc 的信号值得在更大语料复核；不动的理由已量化（PC 占比弥散）。
- **M3 clause 泛化（readback fbc、limit、goal 的主因）**：这是当前最可修的一层——P1/P2 都不改持久化、不引入词面、保持单次全量，且各自有明确的赢/输面。若只选一个进入下一轮单变量验证，选 **P1**（hit@1 +2、MRR +0.0171，代价 hit@3 −2/hit@5 −1 需在冻结集上重新整体判定），并把 readback 的回归作为已知反例同步报告。

### 21.6 限制与未执行项

- 全部数字来自主仓库本地、非官方 harness（dot-prefixed 临时脚本，已删除），不是官方 benchmark run；§3.2/§3.3 仍需正式冻结 build 验证。语料仅 97 Practice / 4 Pack / 单模型；γ、λ、PC 数量扫描粒度粗（0/0.1/0.25/0.5/1 与 0–4 个 PC），无逐 case 显著性检验。
- hub 先验、中心化基向量、clause 权重若落地均需按 design §6 的边界处理：P1/P2 不改持久化与 Profile；P3/P4 需要 Profile 身份/迁移/兼容说明，本轮未实现任何生产代码改动。
- labels 仅在检索结果算完后用于判分；`react-hydration-zh` 的名次结论（core #1 / forbidden #3）基于当前生产公式复算。
- 未执行：anti-pattern 负证据编码（P5 不立项）、多语言更大语料的 hubness/各向异性复核、P1/P2 的正式冻结集重跑。

## 22. "简化公式"假设的对照检验与公式冻结（2026-09-29）

> 背景：维护者质疑当前聚合公式过于复杂、效果仍不理想、后续修补在复杂公式上容易漂移。本节把"简化"作为可检验假设，在冻结 50 例上把每个复杂度元素逐一拆掉测掉，再决定公式去向。

### 22.1 方法

- 输入与复算保护同 §21：冻结 v2 50 例、`store-6bf1e1b-v4` 97 Practice / 1232 views、生产 granite GGUF（4 threads）；本轮重新编码并额外编码每例的整句（trim 后单 view）向量；脚本重推生产公式与 `scoreSemanticPractice` 逐对复算 **maxDelta = 0**，control 复现 33/43/45/47/0.7637/2/1。
- 矩阵：query 侧（默认标点拆分 vs 整句单 view）× clause 证据公式（生产 `0.5·tcMax + 0.5·(0.5·bodyMax+0.5·bodyMean)` / 去 bodyMax 半边 `0.5·tcMax+0.5·bodyMean` / 纯视图最大 `max(tcMax, bodyMax)` / 纯 task-card / 纯 body 证据）。所有配置都是单次全量、纯余弦、K 最后应用。

### 22.2 简化矩阵：每个复杂度元素都在挣钱

| 配置 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope | fbc |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **control（拆分 + 生产公式）** | **33** | **43** | **45** | 47 | **0.7637** | 2 | 1 |
| 整句 + 生产公式 | 31 | 40 | 43 | 47 | 0.7221 | 3 | 2 |
| 整句 + tc+bodyMean | 30 | 37 | 41 | 48 | 0.6991 | 3 | 1 |
| 整句 + viewMax | 24 | 32 | 33 | 48 | 0.5951 | 2 | 2 |
| 整句 + taskCard only | 31 | 37 | 43 | 48 | 0.7071 | 2 | 2 |
| 整句 + bodyEvidence only | 23 | 31 | 34 | 48 | 0.5776 | 3 | 2 |
| 拆分 + tc+bodyMean | 32 | 42 | 44 | 47 | 0.7440 | **1** | 1 |
| 拆分 + viewMax | 26 | 36 | 42 | 46 | 0.6404 | 2 | 1 |
| 拆分 + taskCard only（§21 λ=1） | 33 | 40 | 42 | 48 | 0.7423 | 1 | 1 |
| 拆分 + bodyEvidence only（§21 λ=0） | 27 | 32 | 38 | 46 | 0.6308 | 2 | 0 |

逐元素读法（对照同侧最近配置）：

- **拆 clause 是净收益**：对照"整句 + 生产公式"，拆分把 hit@5 43→45、hit@3 40→43、MRR +0.0416，scope 3→2、fbc 2→1。整句只在 `agentic-limit-investigation` 略好（#6 vs #10），其余被标记 case 全部持平或恶化（proportionate #22→#36、acceptance #30→#23→仍 miss、review #14→#25、readback #5→#7、goal #30→#18）。
- **body max/mean 混合是净收益**：对照"拆分 + tc+bodyMean"，bodyMax 半边把 hit@5 44→45、MRR +0.0197、hit@1 +1；tc+bodyMean 仅 scope 2→1，属单一指标换分，拒绝。
- **去掉全部平均（viewMax）最差**：拆分下 42/0.6404，整句下 33/0.5951——§21 M4 已证明 bodyMean 是反 hub 的关键半边。
- **单侧公式都不行**：纯 task-card（λ=1）42/0.7423，纯 body（λ=0）38/0.6308，与 §21 λ 扫描一致：1:1 是局部最优。

结论：**在当前冻结 50 例、模型与投影下，已测试的 query 拆分和 clause 证据简化都没有整体胜过 control**。这些对照支持保留当前实现、防止无证据漂移；它们不证明公式全局最优、所有复杂度不可替代，或未测试方法的期望收益必然为负。“饱和”仅能描述本次已测试的局部邻域，反复使用的开发集也不能替代独立验证。

### 22.3 决定：冻结公式 + 防漂移守卫

- 新增 `packages/engine/src/query/semantic/index/scoring-formula-pin.test.ts`：golden 向量钉住 `scoreSemanticPractice` 的完整聚合行为（query 权重加权平均、task-card/body 等权、`0.5×max+0.5×mean` body 证据、`full` 不打分、best-view 诊断）。任何改动这些数字的人必须显式改快照，并在本 verification 里记录同 50 例的单变量消融（hit@1/@3/@5、top-20、MRR、scope、fbc 全口径，不得只报改善项）。
- 不合入任何降低 hit@5 的变体：`拆分 + tc+bodyMean`（scope 2→1 但 hit@5 45→44、MRR −0.0197）按"不得为单一指标挑变体"拒绝。
- 提升路径维持 §21 结论：模型精度探针（各向异性根因层）与 query 角色化分解（M3 的修复层）；聚合公式本身不再加项、不加系数。

### 22.4 限制

- 同 §21：主仓库本地非官方 harness、单语料（97 Practice / 4 Pack）单模型、无逐 case 显著性检验；整句对照只测了"trim 后整句单 view"，未测"整句 + 拆分并存"（那是增加复杂度，与本轮目标相反）。
- pin test 断言精度 1e-7：Float32 累积噪声约 5e-8，公式性变化（≥1e-3 量级）必然触发。


## 23. 表示边界与融合归因复核（2026-10-01）

**结论：保留当前生产表示与公式，不采用去 anti-pattern 变体。** §21 关于“首块命中排除了 anti-pattern”的推理已更正；实际移除实验使 hit@5 45→43、MRR 0.7637→0.6740。两个检索信号的职责不同，但本次 5 个 top-5 miss 在 task-card 与 body 两个单独通道中也都 miss，因此没有证据把主要失败归因于融合丢掉了已经找对的通道。只选择某个已有 clause 同样不能解决整批失败。

### 23.1 问题、范围与预先规则

- 对照总目标为 [任务与阶段感知检索演进](../../../docs/research/task-aware-retrieval-evolution.md) 的阶段 B：保留可靠结构，为后续完整任务判断提供可用证据；探索文档不覆盖当前单次全量、纯余弦、K 最后应用的约束，也不授权恢复多轮/RRF 或引入 reranker。
- 单变量干预：只从 task-card 投影移除 anti-pattern name/description。title、applies_when、stage、原始 query 的生产 clause 投影、body/full 向量、模型、pooling、归一化与生产聚合公式均不变。新向量只在实验内存/临时缓存使用，不写生产 index，不更改 Profile、迁移、config 或 canonical Store。
- 预先判定：只有 hit@5 与 MRR 均不降低、至少一个质量指标改善且披露全部逐例回归时，才支持继续验证为默认候选；否则拒绝直接替换。单通道排名仅为归因诊断，不是重新提出已否决的默认公式。

### 23.2 输入与复算保护

- 冻结 v2 50 例、test-owned `store-6bf1e1b-v4`，只读 Pack 文件；生产 v4 投影重建得到 97 Practice / 1232 views（full 289、task-card 97、body 846），query 共 117 clause views。
- 使用固定 Q4_0 SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`，`createEmbeddingProcess`、4 threads、生产 CLS pooling/L2 recipe、当前 Windows source-native candidate；不复用用户 Backend。编码前后校验语料文件与 query digest，输出向量检查 384 维、有限值与单位范数。
- 编码进程不读取 labels。分析进程先计算并保存所有条件的完整 97 项排名，再读取 labels 判分；逐 clause 诊断也先完成/保存全部 117 个条件，再读取 labels。两次分析均不将 labels 输入编码、打分或检索。
- control 与去 anti-pattern 两个条件各有 4850 个 (query, Practice) 分数；独立分解与 `scoreSemanticPractice` 比对 **maxDelta = 0**。control 精确复现 §21/§22 全部七项指标；单通道结果亦复现旧消融。
- query 文件 SHA-256：`54b621402859e637ee1b92a24dc22e5830b289f3ddd2b9fbfc25f924e5e608f1`；全部未判分排名 SHA-256：`fa1f76a712345e6f741cdf0323dd4a91349acb0f38cb8017554ecf2d7e2c7ed6`；baseline/variant 向量缓存 SHA-256：`0fccb7d4dcf5d9c8371b257c5c23db780872786b2f1c2723a336eb29591eeaea`。
- 临时脚本 `packages/backend/src/benchmark/.audit-representation-{encode,score}.ts` 在收尾删除。脚本副本、protocol、vectors、未判分 rankings 与 summary 留在本机 `%TEMP%/lorelum-representation-audit-20261001-<runId>/`，不提交原始 query、正文、labels 或机器路径。实验重放须先把副本恢复到上述原始导入位置；它们不是可从临时目录直接运行的产品入口。

### 23.3 单变量结果

| 条件                             | hit@1 | hit@3 | hit@5 | top-20 | MRR    | scope | fbc |
| -------------------------------- | ----- | ----- | ----- | ------ | ------ | ----- | --- |
| control                          | 33    | 43    | 45    | 47     | 0.7637 | 2     | 1   |
| 只从 task-card 移除 anti-pattern | 27    | 39    | 43    | 48     | 0.6740 | 2     | 1   |
| task-card 单通道（诊断）         | 33    | 40    | 42    | 48     | 0.7423 | 1     | 1   |
| body 单通道（诊断）              | 27    | 32    | 38    | 46     | 0.6308 | 2     | 0   |

去 anti-pattern 后 core 最佳名次：3 例改善、15 例回归、32 例不变；没有新增 top-5 命中，新增 2 例 miss：`agentic-supported-claim` #5→#9、`issue-pr-readback-pack-context` #5→#6。原有 5 个 miss 全部仍 miss：acceptance #30→#42、goal #30→#27、proportionate #22→#17、limit #10→#6、review #14→#14。readback 的 forbidden 仍 #3；hydration 的 core 仍 #1、forbidden #3→#2，scope 与 fbc 总数不变。

全 view 均值向量范数复现 0.8918286；task-card 均值范数由 0.8823361 降至 0.8794749，paired task-card 向量余弦均值 0.9792901。较小的公共分量没有带来更好的标签指标；不能以“地板更低/几何更好”代替质量验证。

### 23.4 融合与 query clause 的归因诊断

| case | control | task-card 单通道 | body 单通道 | 最佳单 clause（事后 oracle） |
| --- | --- | --- | --- | --- |
| acceptance-direct | #30 | #33 | #26 | #23 |
| goal-paraphrase | #30 | #32 | #26 | #9 |
| proportionate-validation | #22 | #18 | #33 | #9 |
| limit-investigation | #10 | #12 | #13 | #2 |
| review-finding | #14 | #13 | #24 | #16 |
| readback-pack-context | #5 | #9 | #1 | #1 |

- 当前 5 个 top-5 miss 在两个单通道都没有进入 top-5；两个通道 top-5 命中的事后并集仍为 45/50。融合相对 task-card 改善 9 例、恶化 4 例；相对 body 改善 20 例、恶化 6 例。不能把“职责不同”直接推成“融合是主因”，也不能宣称融合从不伤害：readback 的 #1→#5 就是局部反例。两通道 top-20 命中的事后并集为 48/50，不是符合当前约束的可部署候选策略。
- 对全部 117 个既有 clause 分别用生产 scorer 做单次全量诊断，不合并名次。检索后借助 labels 统计“任一 clause 的最佳 core 名次”：hit@1 35、hit@3 44、hit@5 45、top-20 49。limit #10→#2，但原本成功的 tests-from-acceptance 在所有单 clause 中最好也只有 #6（control #3），因此 top-5 总数不变。
- 上述最佳 clause 是 **事后 label-conditioned oracle 诊断**，不是自动角色识别器的成绩，也不是重写 query 或任意权重组合的理论上限。它只证明从现有标点片段中选择一个动作片段，不足以解决全部已知失败；不能将这些排名合并为默认检索。

### 23.5 对可行性的当前判断与未验证项

- **支持继续的部分**：schema-backed task-card + 自由 body chunk 为不同证据保留了可读边界；当前融合在这批开发集上整体优于单通道。anti-pattern 对某些 query 可能提供任务识别所需的失败情景，而不仅是“负证据”。
- **不支持的推断**：首块 ID 排除块内影响；高余弦公共分量直接证明 Q4 是根因；有限消融证明公式全局饱和；仅降权背景即可覆盖全部失败。公式 pin 保持不变，但它是行为守卫而非最优性证明。
- **下一项需区分的假设**：完整、保留必要条件的任务表示是否优于标点碎片；同源高精度是否恢复区分能力；若二者均不足，再讨论更适合任务适用性判别的模型/阶段 C 能力。隔离探针不等于已批准产品模型替换或 analyzer 默认启用。
- 验证边界：本轮仍为反复使用的非官方 50 例开发集与单语料/Q4 模型；没有执行官方 benchmark §3.2/3.3、独立 holdout、跨语种大语料、同源 Q8/F16，也没有复验本轮的 canonical assembly/snapshot retry。检索后的 label oracle 不得包装为产品质量收益。
- 生产守卫复验：`bun test packages/engine/src/query/semantic/index/scoring-formula-pin.test.ts packages/engine/src/query/semantic/query-views.test.ts packages/engine/src/query/semantic/projection.test.ts packages/engine/src/query/semantic/no-lexical-scoring.test.ts`：**9 pass / 0 fail**。本轮未修改生产 TS、Profile、schema、迁移或默认行为。


## 24. 评分口径、任务覆盖与融合异质性审计（2026-10-02）

**结论：当前 45/50 是指定 core 的命中率，不是整个结果列表的有用率；失败集中在 agentic 的 requirements 与部分 planning/review。** 评测既存在未判定结果和标签语义需要复审的空间，也有经正文确认的真实任务错配，不能通过把邻居一律算成功解决。两项新融合对照没有提高 hit@5：通道标准化修复了 readback 的 core/forbidden 顺序，但降低整体 MRR；几何融合没有改变 core 名次。

### 24.1 评分器实际保护什么

- 读取 benchmark 仓库的 `src/benchmark/retrieval-ranking/scorer/v1.ts` 与冻结 v2 scorer config：candidateWidth=20、resultLimit=5。官方 scorer 区分 candidate miss、final ranking miss、scope error 和 unlabelled neighbor；它没有把未标注项自动判为错误。每例 `finalHitPassed` 使用 `core.every(...)`，多 core 表示全部必需，而非可替代答案。
- 本套 50 例每例恰有 1 个 core，合计 50 个 core 标注、49 个不同目标 Practice。因此本轮的“任一 core 命中”与官方“全部 core 命中”口径一致；不能把当前 miss 归因于多 core 全满足要求。未来若要表达多个可接受替代项，不能直接把它们追加到现有 `coreIds`，否则评分会变得更严格，需要新 suite/协议设计。
- reader 对全部 eligible Practice 按分数排序再切片；检查 `semantic/index/reader.ts` 与 `semantic/read.ts`，本路径没有用于丢弃低分结果的 minimum-similarity threshold。这些 miss 是相对名次不够靠前，不是调低一个余弦阈值就能修复。
- 250 个 top-5 返回项中，45 个为指定 core、2 个为该 query 的已标注 forbidden、**203 个未判定（81.2%）**。既不能据此计算真实 precision，也不能把未命中指定 ID 等同于没有提供任何帮助。
- 仅 6/50 例标注了 forbidden。已知 scope error 是全套 2/50，也是这 6 个冲突案例中的 2/6；后者样本很小，不能外推总体错误概率。命中 core 且没有已标注 forbidden 的案例为 43/50，仍不意味着这 43 例的每个返回项都适用。官方 core/forbidden 顺序只观察两者都进入最终列表的 pair；本地全排名 fbc 是另一个已说明的口径，不应混称。

### 24.2 通过率按任务分层

分组依据为 gold core 所属 Pack/命名空间，仅用于检索后分析，不输入排序。

| 目标来源           | 案例数 | hit@1 | hit@3 | hit@5 | top-20 | MRR    |
| ------------------ | ------ | ----- | ----- | ----- | ------ | ------ |
| agentic-coding     | 29     | 17    | 23    | 24    | 26     | 0.6948 |
| issue-pr-etiquette | 7      | 5     | 6     | 7     | 7      | 0.8143 |
| pack-creator       | 5      | 3     | 5     | 5     | 5      | 0.8000 |
| react              | 9      | 8     | 9     | 9     | 9      | 0.9259 |

所有 5 个 top-5 miss 都来自 agentic。细分：requirements 0/2（两例 core 均 #30）；planning 3/4、hit@1 0/4；review 1/2；implementation 7/8；verification 3/3、testing 4/4。这些是小样本观察，不是各任务类别的总体准确率，但足以否决“所有场景质量相同”的表述。

覆盖边界同样不均匀：97 条语料中，直接作为 core 的不同 Practice 为 49 条；agentic 28/34、issue-pr 7/12、pack-creator 5/27、react 9/24。React 的目标只覆盖 rendering/state，未覆盖该语料已有的 async/bundle/composition/server；pack-creator 的目标只覆盖 authoring/design/evaluation，未覆盖 discovery/localization/release/review。query 为英文 48 例、中文 2 例；97 个 task-card 均为非中文文本，中文两例只是有限的中→英观察。没有无相关目标的 query，也不能据此验收新 Pack、更多语言或更大语料。不能选择更有利的类别权重，把改变分母包装为检索提升。

### 24.3 “标签过严”与真实错配的区分

本次在检索完成后阅读了目标及相关邻居的完整 Practice 正文，进行单评审者、非盲的语义审计；它不是独立标签复审，也未修改 gold 或计算一个放宽后的“新通过率”。

- **acceptance-direct 值得复审任务边界**：query 的请求仍是模糊的 dashboard 改善，却要求形成可验证结果和非目标。指定 acceptance Practice 的正文要求先有已同意的 outcome sentence，结果不清楚时先 ground-user-goal；后者恰在当前 top-5。它可能是合理的前置帮助，也可能表明该 query 同时涉及目标澄清与验收定义。不能在单评审者看到结果后直接把前置帮助升格为等价替代，应由独立审阅明确主要任务及可接受集合。
- **goal-paraphrase 的主要问题是真实错配**：目标正文明确要求两种解释导致不同结果时确认用户意图；高排的 temporary-assumption Practice 只允许低影响、可逆、不改变产品含义的实现细节。它不能因为同样谈“解释/不确定性”就作为用户目标理解的替代。
- **review-finding 同样有真实触发条件错配**：核实一个 review finding 不等于已有测试失败；高排的 classify-failure-before-changing-test 以 failed check 为前提。replan/material-drift 也以已发现的新事实为前提，不能代替先判断 finding 是否成立。
- 因此，“指定 ID 命中”是偏窄但可解释的契约，仍然能揭示真问题；“结果是否有帮助”则缺少足够判断。建议下一版评测区分必需核心、充分可替代项、前置/补充帮助、无关项与禁项，先对 control 与实验结果的匿名合并池做独立审阅，再冻结新标签。v2 保持不动，不用模型自评或事后改标签为某个变体创造收益。

### 24.4 两项未调参融合对照

复用 §23 的已核验向量与未判分排名缓存，校验排名 SHA-256 和 projection/query/scorer/runtime 五个源文件 digest 未变化；本轮未重编码、未重新访问用户 Store。以 query 内现有等权 clause 聚合分别得到 task-card 均值 T 与 body evidence 均值 B；所有条件先保存完整排名，再读取 labels。新增条件：

1. **通道标准化**：对同一 query 的全部 97 个 T、B 分别计算均值与标准差，`S=0.5*((T-meanT)/stdT+(B-meanB)/stdB)`。这是对两个通道的尺度对齐，不是 §21 的 clause z-score；没有识别角色或改 clause 权重。
2. **通道几何融合**：`S=sqrt(T*B)`，检验减少算术补偿是否有收益。冻结输入的 T/B 均为正值，实验先断言该条件；没有声称此公式已设计好所有负余弦/空通道边界。

它们都只是向量分数的隔离聚合条件，无词面输入、负权重、候选截断、多轮默认或名次融合。生产 scorer/pin 未改，不进行参数搜索或用 labels 选择权重。新排名 SHA-256：`eb86bb9bc3e03ec148d4deff7933d97528d5ce45cc2f2d984e092cc14697cd8c`；临时 `packages/backend/src/benchmark/.audit-scoring-coverage.ts` 收尾删除，脚本副本与 protocol/summary 留在本机临时目录，不提交运行数据。

| 条件         | hit@1 | hit@3 | hit@5 | top-20 | MRR    | scope | fbc |
| ------------ | ----- | ----- | ----- | ------ | ------ | ----- | --- |
| control      | 33    | 43    | 45    | 47     | 0.7637 | 2     | 1   |
| 通道标准化   | 29    | 43    | 45    | 47     | 0.7201 | 2     | 0   |
| 通道几何融合 | 33    | 43    | 45    | 47     | 0.7637 | 2     | 1   |

标准化：5 例 core 名次改善、9 例回归、36 例不变，没有新增/丢失 top-5 命中。readback core #5→#2、forbidden #3→#4，issue-pr 的 MRR 0.8143→0.8571；但 agentic 0.6948→0.6427、pack-creator 0.8000→0.7067、react 0.9259→0.8704。修复一类不能掩盖另外几类的回归。几何融合的 50 个 core 名次全部不变，仅一例 forbidden #23→#24，无质量收益。

两个单通道亦有不同强项：body-only 在 issue-pr 为 hit@1 7/7，但在 agentic 为 hit@5 19/29、MRR 0.4922；task-card-only 在 pack-creator 为 hit@1 4/5，但 agentic top-5 降至 22/29。这支持继续研究任务条件化的证据使用，不支持按这四个 Pack 名字硬编码权重，也不证明哪个自动选择器已经可靠。

### 24.5 K 的敏感性与下一步

| K（诊断） | 指定 core 命中 | 已标注 scope error | core 命中且无已标注禁项 |
| --------- | -------------- | ------------------ | ----------------------- |
| 5         | 45/50          | 2/50               | 43/50                   |
| 10        | 46/50          | 2/50               | 44/50                   |
| 15        | 47/50          | 3/50               | 44/50                   |
| 20        | 47/50          | 4/50               | 43/50                   |
| 30        | 50/50          | 5/50               | 45/50                   |

扩大 K 只改变返回数量，不改善排名。K=30 能做出“全部命中”的数字，但返回项从 5 增到 30、6 个已标注冲突案例中 5 个出现禁项，不是成功的排名改进；本轮不改变默认 K。

当前无需追求全部命中，也不应放松命名目标来制造提高。下一步应先审阅标签池和补齐薄弱/未覆盖任务的独立 query，然后用相同输入粒度对照原文与保留必要条件的任务重述，并独立测同源 Q8/F16。若研究可学习或 query 条件化的非负融合，应使用新的训练/验证划分与独立 holdout，不把未标注邻居一律当负样本，也不把已反复使用的这 50 例当盲测。新 scorer/suite、自动 analyzer 默认行为或模型替换仍需各自设计对齐；本轮不改这些合同。

验证：外部 benchmark scorer 的既有单元测试 `bun test <benchmark>/src/benchmark/retrieval-ranking/scorer/v1.test.ts` 为 **2 pass / 0 fail**；Engine formula pin 与 no-lexical guards 为 **3 pass / 0 fail**。这不是官方 benchmark 全量运行；正式 benchmark、独立标签审阅、人工/自动任务重述对照、同源高精度与更多语料/语言仍未执行。

## 25. G0：隔离 control 重放、协议登记与成本预算（2026-10-08）

**结论：G0 的实验基础成立。** 隔离工具对冻结 v2 的 50 例 × 97 Practice 共 4850 对重放生产评分，独立复算与生产函数的最大绝对误差为 **0**（门槛 1e-6），生产与复算的逐 query 排序完全相同；先保存完整排名与 manifest，再由独立阶段读取 labels，冻结指标逐项复现。这**不说明方案 C 有效**，也不授权进入 G1；本节没有任何角色条件的质量结果。协议、角色样本格式、单一候选策略、pilot 标注规则和成本预算登记在 [G0 协议](../../../docs/research/role-aligned-g0-protocol.md)。

### 25.1 范围与边界

- 新增 `packages/backend/src/benchmark/role-aligned/`（benchmark 内部工具，不在包 exports、CLI 或 Backend API 中）。未修改 `scoreSemanticPractice`、golden pin、Profile、持久化 schema/迁移、active index、公共 Practice/Pack schema、CLI/API 或 v2 gold labels；未使用个人 Store。
- 未实现自动 analyzer、训练器或在线反馈闭环，也未换模型。工作区原有大量未提交改动保持原样。

### 25.2 输入身份

| 项目 | 身份 |
| --- | --- |
| suite | `retrieval-ranking/v2`，50 例；`queries.json` SHA-256 `54b62140…08f1`；labels 修订 v2，SHA-256 `5be85119…d776` |
| 语料 | `store-6bf1e1b-v4`：97 Practice / 1232 views，engine 语料 digest `6d25295b…b0d1`，Store generation 4 |
| 模型 | `model.gguf` SHA-256 `18e8ce8c…f59`（66 345 216 字节，与生产 `EMBEDDING_MODEL` 相同）；native runtime manifest `3c005a0b…de54` |
| 编码合同 | 生产 `createEmbeddingProcess`，4 threads，pooling `cls`，l2 归一化，384 维；Profile `c46b5d2c…2a41` |
| 投影 | document projection v4、query projection v2（均为生产函数） |
| 代码 | commit `8e97b009`，**工作区有未提交改动**（`listedFilesDirty=true`）；21 个被测/工具源码逐文件 digest 合并为 `5f301343…d9e5`。生产 reader/projection/query-views 的字节与此前诊断一致，未被本次修改 |
| 环境 | win32 x64，Bun 1.4.2，i7-13620H（16 逻辑核），16.9 GB |

query、模型与 native manifest 的摘要与 2026-10-01 表示审计 `protocol.json` 逐一相同。开始前核对这些摘要与 97/1232 数量；任一不符为 `input_mismatch`，不会静默换输入。语料 digest 是 2026-10-08 首次观测后固定的（此前的审计记录的是含本机路径的文件列表摘要，不可移植）。

### 25.3 方法

1. 检索阶段（`runControlReplay`）：经 `createLocalStore` 读取冻结 Store 的 canonical 快照，用生产 `projectSemanticPractice` / `projectSemanticQuery` 投影，经生产 `createEmbeddingProcess` 与 `validateEmbeddingBatch` 编码，然后对全部 eligible Practice 各评分两次：生产 `scoreSemanticPractice` 与独立重写的公式（`control-formula.ts`，按 §21 的公式文字写成，不引用生产代码）。逐对写入 `score-comparison.json`，完整排名写入 `ranking.json`，最后写 `manifest.json`。排名不截断，K 只在读取时应用。
2. 评分阶段（`scoreControlRun`）：先验证 manifest 状态为 complete、两份产物 digest 与排名结构（97 项、名次连续、按分数与 ID 有序），通过后才打开 labels；labels 与 query/语料不一致属协议错误。指标：hit@k 要求全部 core 名次 ≤ k，MRR 与 forbidden-before-core 用最差 core 名次（本套每例仅 1 个 core，与 §24 口径一致）。
3. 向量缓存仅在模型、编码合同、threads、native manifest 与全部被测代码 digest 相同时复用，否则丢弃重建。

### 25.4 结果

| 指标 | 冻结基线 | 本次（两次独立冷编码均相同） |
| --- | --- | --- |
| hit@1 / hit@3 / hit@5 / top-20 | 33 / 43 / 45 / 47 | 33 / 43 / 45 / 47 |
| MRR | 0.7637 | 0.763671（四位精度一致） |
| scope（forbidden 进 top-5） | 2 | 2 |
| forbidden-before-core | 1 | 1 |

- 复算：4850 对，`maxAbsDelta = 0`，不一致 0，生产/复算逐 query 排序相同。
- 可重放性：两次从零开始的冷编码（各 1345 次编码）产出的 `ranking.json`（`0365fdfb…1fbe28`）、`score-comparison.json`（`915c1008…d64ca`）与 `vector-cache.json` 字节级相同；三次热缓存重跑的排名同为 `0365fdfb…`，评分仍 33/43/45/47。
- 复现的是 §20–§22 的开发集基线；它是反复使用的非官方开发集，不是独立验收集。

### 25.5 成本实测（本机，control）

| 条件 | 总耗时 | 编码 | 生产评分（50 query × 97 Practice） | 其他 | 评估进程峰值 RSS |
| --- | --- | --- | --- | --- | --- |
| 冷（无向量缓存，1345 次编码） | 161.0–161.3 s | 159.2–159.5 s（均 118 ms/次），runtime 启动 1.0 s | 41.5–43.2 ms（0.83–0.86 ms/query） | 输入校验 0.09 s、语料读取 0.09 s、投影 0.07 s、缓存写 33 ms、产物写 5–9 ms | 124.6–125.4 MB |
| 热（缓存全部命中，0 次编码，3 次） | 764–782 ms | 0 | 41.1–42.3 ms | 输入校验 0.09–0.10 s（含 66 MB 模型 SHA-256）、语料读取 0.09 s、投影 0.07 s、缓存读 9–10 ms（2.85 MB） | 121.7–123.4 MB |

- 独立复算 0.45–0.53 s（约为生产路径的 11 倍），属验证开销，不计入查询成本。
- 全部 11 次冷运行（最终代码 2 次，其余为开发中的运行）：生产评分 0.83–2.1 ms/query（波动原因未单独测量），runtime 启动 1.0–6.5 s；全部运行（冷与热）的评估进程峰值 RSS 为 120.8–128.6 MB。
- native 嵌入进程由外部 PowerShell 每 250 ms 采样 `PeakWorkingSet64`：446–449 MB（采样间隔使其成为下界）。
- query 侧编码延迟（独立探针，预热后顺序编码 50 个 query 的全部 clause，3 次）：每 query 1–4 个 clause（中位 2），每文本 p50 11.3–12.2 ms、p95 19.1–20.0 ms，每 query p50 26.4–28.7 ms、p95 34.8–41.3 ms，最大 39.2–42.2 ms。
- 冷/热边界：向量缓存是唯一被控制的“冷热”变量；操作系统文件缓存与 CPU 频率没有被控制。runtime 启动 1.0–6.5 s 的差异[INFERENCE]与模型文件是否在系统缓存有关，未单独验证。未做并发、长时间或更大语料测量，不构成容量结论。

### 25.6 冻结预算及其修订披露

预算 `role-aligned-cost-budget/1`（代码 `cost-budget.ts`，digest 记入每份 manifest）在任何角色条件结果出现前冻结，限值见 [G0 协议 §6](../../../docs/research/role-aligned-g0-protocol.md)。起草后曾按更完整的测量修订两处，均发生在没有任何角色结果之前：runtime 启动上限由 6.4 s 提高到 8.1 s（后续运行观测到 6.5 s，原依据只覆盖前几次运行）；评分与内存的推导说明改为覆盖全部运行。其余限值未变。analyzer 未实现，其限值是预先固定的门槛而不是实测；预算不构成大规模容量结论。

### 25.7 命令

```text
bun packages/backend/src/benchmark/role-aligned/control-cli.ts replay --out <仓库外运行目录> --queries <suite>/cases/queries.json --store <冻结 Store 根目录> --model <model.gguf> --native-manifest packages/backend/.artifacts/native/embedding/win32-x64/manifest.json
bun packages/backend/src/benchmark/role-aligned/control-cli.ts score  --out <同一运行目录> --labels <suite>/private/labels.json
```

本机路径写入运行目录的 `local-environment.json`，不进入 manifest；运行目录保存 query 文本、向量、排名与 labels 派生分数，位于 `%TEMP%`，不提交。工具拒绝仓库内的运行目录。两条命令之外未运行任何会读取 labels 的步骤。

### 25.8 测试与校验

- `bun test packages/backend/src/benchmark`：**85 pass / 0 fail**（其中新增 role-aligned 目录 9 个测试文件，覆盖：角色样本来源片段/UTF-16 偏移/代理对/重复/缺失/多动作/确定性；候选策略的归一化、去重、负余弦、unknown、回退、tie-break；独立复算与生产函数在 300 个随机 Practice 上 ≤ 1e-6；retrieval/labels 的阶段隔离（manifest 缺失、失败、产物被改、缺比对产物时 labels 读取次数为 0）；全量排序后取 K；缓存复用/身份失效/损坏重建；输入不符、编码失败、评分不一致写 failed manifest 且不被评分；标签与 query/语料错配为协议错误；pilot 标注规则；预算内在一致性）。
- `packages/backend` `bun run typecheck` 通过；`oxlint` 与 `oxfmt --check` 对新目录无告警。
- 生产守卫未受影响：`bun test packages/engine/src/query/semantic`：**46 pass / 1 skip / 0 fail**（skip 为既有）；formula pin 与 no-lexical 守卫 **3 pass / 0 fail**。
- 新目录的代码 digest（`5f301343…d9e5`）是 §25.4/§25.5 所用最终运行的身份；此后未再修改其中文件。

### 25.9 未完成项与限制

- 未做 G1：没有人工 query 角色、没有 Q/Q+I 排名、没有新 pilot query 与 pilot 标注；协议与格式只经过单元测试，未经真实标注者使用。
- 角色样本校验只证明结构与来源锚定，不能证明重述没有补造事实，也不能判断必要条件是否被当作背景。
- 候选策略的权重是先验选择，不是测得最优；它在 G1 前不得因看到新结果而调整。
- 复现仅限一台 Windows x64 设备、一个开发集和一个模型；native manifest 摘要只对 win32-x64 有效。
- 官方 benchmark §3.2/3.3、P1/P2、更大语料、多语言和同源高精度对照仍未执行。

## 26. G1：人工 query 角色（Q）与细粒度交互（Q+I）的开发集探索（2026-10-08）

**结论：在冻结 v2 开发集上，Q 与 Q+I 都未通过研究计划 §6.3 第 3 项，且没有收益能归因于角色；G1 没有完成，20.4 保持未勾选。** 单标注者人工角色使 hit@5 由 45 降到 41、MRR 由 0.7637 降到 0.652（Q）/ 0.653（Q+I），未增加任何 hit@5 命中；不含角色信息的同预算分段对照（`N-segments`）得到几乎相同的指标（41、0.648）。Q+I 与 Q 之间的差异小到不能区分（MRR +0.0008，hit@3 +1）。**独立 pilot 没有运行**：没有取得真实新任务与独立标注者，因此第 2 项（pilot 严格改进）无法判定，不存在对“方案 C 在独立任务上无效”的结论，也不存在“有效”的结论。协议见 [G1 协议](../../../docs/research/role-aligned-g1-protocol.md)。

### 26.1 范围与独立性披露

- 工具：`packages/backend/src/benchmark/role-aligned/` 新增 `role-conditions`（Q/Q+I 评分）、`negative-controls`、`role-authoring`、`role-run-manifest`、`role-replay`（检索阶段）、`role-scoring`（评分阶段与门槛）、`role-cli`，并将 `pilot-labels` 升到协议版本 2（`fullyServed`/`anyHelp`/`success`）。`control-formula` 抽出共享的 `reduceViewCosines`，`control-replay`/`control-cli`/`manifest` 只增加导出。生产 `scoreSemanticPractice`、golden pin、Profile、持久化 schema/迁移、active index、公开 schema、CLI/API、Pack 内容、模型均未改动。
- **角色标注者是我（agent，单人）**：只读 query 原文，未读取目标 Practice 内容、labels 或任何排名后写出 50 条角色与 50 条等义重述；但我在此前工作中读过本 verification 的部分案例诊断，且 50 例是被反复使用的开发集。因此：不是盲标，不是独立验证，只能算**披露过的开发探索**。该披露写入了 manifest 的 `roleProvenance`（`independentOfTargets=false`）。角色标注在运行任何排名之前冻结，之后没有修改；两份样本集 digest 为 primary `c9fcfffa…a26c`、restated `7a2b11d7…c454`。
- 标注规则（运行前）：intent=当前动作或决定；moment=当前状态/事件先后；artifact=动作对象；constraints=改变适用性的必要条件或边界；domain=技术背景；query 中没有明确动作的症状描述不补造 intent（6/50 无 intent，Q 由其余角色计分）。primary 文本一律逐字取自 query 片段；重述只改措辞。校验器证明结构与来源锚定，不能证明重述没有补造事实。
- pilot 采集（24–40 条真实任务）、独立角色标注与独立相关性标注**均未完成**：我没有真实新任务来源，也没有第二标注者。我曾询问来源，未得到答复，所以没有编造、也没有从目标 Practice 反写任务。

### 26.2 对 G0 pilot 协议的修订（运行前）

G0 协议 v1 的成功判定（“前 K 含任一 required-core 或 sufficient-alternative”）与 `required-core`（“缺它任务得不到服务”）不一致：多个 required-core 时命中一个不应算成功。已在任何 G1 评分之前改为协议 v2：`fullyServed`（含一个 sufficient-alternative，或含全部 required-core）、`anyHelp`（含任一可接受项）、主指标 `success=fullyServed∧无禁项`；v2 gold/`coreIds` 不变。该规则是按我的判断提出并采用的，**用户未对其明确确认**（询问被取消）；如需调整，应在任何 pilot 评分前完成。G0 之后没有任何 pilot 标签或评分，所以没有已查看结果受影响。

### 26.3 输入身份与命令

| 项目 | 身份 |
| --- | --- |
| suite / 语料 / 模型 / 编码 / 投影 | 与 §25.2 相同：`queries.json` `54b62140…`，97 Practice / 1232 views，语料 digest `6d25295b…`，模型与 native manifest 同 §25.2，pooling `cls`、l2、384 维、4 threads、document projection v4 / query projection v2 |
| 代码 | commit `8e97b009`，工作区有未提交改动；28 个被测/工具源码合并 digest `0b35d3c6…`（格式化后的最终代码） |
| 环境 | win32 x64，Bun 1.4.2，i7-13620H（16 逻辑核），16.9 GB |
| 运行 | 用途 `development`；全部条件在同一次运行中，1807 个不同文本（含 1232 个文档 view）一次冷编码 |

```text
bun packages/backend/src/benchmark/role-aligned/role-cli.ts author --queries <suite>/cases/queries.json --spec <角色 spec> --out <primary 目录> --out-restated <restated 目录>
bun packages/backend/src/benchmark/role-aligned/role-cli.ts replay --out <仓库外运行目录> --queries <suite>/cases/queries.json --usage development --store <冻结 Store> --model <model.gguf> --native-manifest packages/backend/.artifacts/native/embedding/win32-x64/manifest.json --roles <primary 目录> --roles-restated <restated 目录> --annotator <名称> --disclosure <披露>
bun packages/backend/src/benchmark/role-aligned/role-cli.ts score  --out <同一运行目录> --queries <suite>/cases/queries.json --dev-labels <suite>/private/labels.json
```

`replay` 没有 labels 参数；`score` 验证 manifest 与 9 份排名的 digest 和完整有序性后才读取 labels（测试用读取计数证明，失败/被篡改的运行读取次数为 0）。所有运行产物与角色 spec 存放在仓库外的本地评测目录，不提交。

### 26.4 结果（50 例 × 97 Practice，每个条件对全部 Practice 评分后保存完整排名）

control 在本次运行中复现冻结基线：独立复算与生产函数 4850 对 `maxAbsDelta = 0`，hit 33/43/45/47，MRR 0.763671，scope 2，forbidden-before-core 1。两次独立冷编码运行（格式化前后，代码 digest 不同）的 9 份排名 SHA-256 逐一相同。

| 条件 | hit@1 | hit@3 | hit@5 | top-20 | MRR | scope | forbidden-before-core | 相对 control 的核心名次改善 / 回归（共 50） |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| control | 33 | 43 | **45** | 47 | 0.7637 | 2 | 1 | — |
| **Q** | 25 | 39 | **41** | 48 | 0.6521 | 1 | 0 | 8 / 17 |
| **Q+I** | 25 | 40 | **41** | 48 | 0.6529 | 2 | 0 | 8 / 14 |
| Q-flat（等权） | 27 | 39 | 41 | 47 | 0.6663 | 3 | 1 | 3 / 13 |
| Q+I-flat（等权） | 28 | 38 | 40 | 48 | 0.6734 | 3 | 1 | 6 / 14 |
| N-background（追加背景句） | 21 | 36 | 39 | 49 | 0.5792 | 0 | 1 | 3 / 20 |
| N-segments（同预算无角色分段） | 25 | 38 | 41 | 49 | 0.6478 | 1 | 0 | 8 / 13 |
| Q-restated（等义重述） | 24 | 38 | 41 | 48 | 0.6376 | 1 | 0 | 6 / 17 |
| Q+I-restated | 25 | 38 | 40 | 48 | 0.6429 | 1 | 0 | 5 / 16 |

门槛判定（运行前登记，见协议 §3）：

| 候选 | 1 control 复现 | 3 旧 v2 回归 | 2 新 pilot 改进 | 判定 |
| --- | --- | --- | --- | --- |
| Q | 通过 | **失败**：hit@5 41 < 45，MRR 0.6521 < 0.7637 | 不确定：未运行 pilot | **失败** |
| Q+I | 通过 | **失败**：hit@5 41 < 45，MRR 0.6529 < 0.7637 | 不确定：未运行 pilot | **失败** |

scope（Q 1、Q+I 2）与 forbidden-before-core（均 0）满足不高于 2 / 1，但这不抵消 hit@5 与 MRR 的回归，也不能当作收益（同样低的 `N-segments` 同为 1 / 0）。

### 26.5 归因与逐例

- **角色重述/权重/聚合次序/额外预算分开看**：以核心名次逐例配对，Q 对 N-segments 更好 11 例、更差 12 例；Q 对 Q-flat 更好 11、更差 9；Q 对 Q-restated 更好 14、更差 8；Q 对 N-background 更好 19、更差 11；Q+I 对 Q 更好 6、更差 4；Q+I 对 Q+I-flat 12/10。汇总指标上 Q 与 N-segments 几乎相同，因此 **Q 相对 control 的损失不能归于或排除某一因素，且没有观察到可归于角色的收益**。N-background 在没有任何角色改动的情况下单独造成 hit@5 −6、MRR −0.18，说明这个模型对 query 追加文本非常敏感，任何“角色文本”改动都与这种敏感性混杂。
- **聚合次序（Q+I 对 Q）**：hit@3 +1、MRR +0.0008、回归 14 对 17，量级在逐例噪声内；4 个丢失 hit@5 的 query 在两者中完全相同。没有证据显示联合证据单元更好或更差。两种预期失败路径（同块共同支持提高适用性 / 漏掉分散证据）在汇总上都没有可见效果。
- **分组（样本数小，仅描述）**：agentic 29 例 hit@5 控制 24 → Q 22 / Q+I 22；issue-pr 7 例 7 → 7；pack-creator 5 例 5 → 5；react 9 例 9 → 7。无 intent 的 6 例 5 → 4；有 intent 的 44 例 40 → 37；中文 2 例 2 → 1（Q）。逐例回归不集中在某一小组。
- **hit@5 丢失的 4 例**（Q 与 Q+I 相同）及核心名次（control → Q → Q+I → Q-flat → N-segments → Q-restated）：`agentic-shared-rule-owner` 1→6→6→18→3→10；`agentic-validate-handoff` 1→6→6→3→2→2；`react-shared-state-zh` 1→23→26→6→1→36；`react-lazy-state` 3→8→15→3→12→2。**同一 query 的名次在等义重述与权重方案之间可相差 20 名以上**（`react-shared-state-zh` 在 Q 为 23、在重述为 36、在无角色分段为 1），所以对少量案例的逐例叙事不可靠。没有 query 的 hit@5 由 miss 变为命中。
- **失败类型（仅依据 query 与名次，未回读目标 Practice）**：(1) 表示不足：把 query 切成 3.5 个短片段后，每个片段单独编码丢失整句语境，权重 3 的 intent 文本常常很短且缺少话题词（如“应该怎么组织这个状态”“Decide where that rule belongs”），在这个模型里它们与大量 Practice 都相近；(2) 措辞敏感：等义重述造成大幅名次变化；(3) 角色语义错误、分散证据错误：本数据不能把它们与 (1)(2) 区分开，没有为它们建立独立证据，也没有观察到“联合证据单元”修复任何一例。未判定比例、标注分歧、`forbidden`/`required-core` 覆盖等新协议维度**不适用**：没有 pilot 标签。

### 26.6 成本（本机，按 G0 冻结预算）

| 项目 | 限值 | 观测 |
| --- | --- | --- |
| 每 query 编码文本数 | ≤ 8 | control 4；Q、Q+I 及各对照最多 5（平均约 3.5 条角色文本）。**通过** |
| 每 query 编码延迟 p95（Q 角色文本，冷编码，逐文本相加） | ≤ 165 ms | 57.8 ms（首次运行 61.8 ms）。**通过** |
| 评估进程峰值 RSS | ≤ 190 MB | 140.2 MB（首次运行 147.8 MB）。**通过** |
| 每 query 评分均值 | ≤ 8 ms | **不可与预算比较**：预算基线是生产 scorer（0.8–2.1 ms），本表来自未优化的独立参考实现（control 本身为 10.2 ms）。相对比：Q 14.8 ms、Q+I 15.1 ms，约为 control 的 1.45–1.5 倍；各对照 14.1–15.0 ms。生产形态下的绝对延迟没有测量 |
| 新增文档编码 | Q、Q+I 为 0 | 0（复用文档向量） |
| analyzer 延迟与内存、runtime 启动、native 工作集 | — | 未测量：没有 analyzer；本次未重新采样 native 进程 |

一次冷运行总耗时约 207 s（1807 次编码，编码 199 s）。成本只约束接入，不改变质量结论；这里质量已失败。

### 26.7 测试与校验

- `bun test packages/backend/src/benchmark`：**132 pass / 0 fail**（role-aligned 新增覆盖：Q 与 Q+I 在构造向量上给出相反排序且数值可手算；多角色、多动作、重复文本、缺失角色、负余弦、无 task-card/body 的失败、缺向量失败；Q 与登记策略的 `fuseRoleEvidence` 一致；负对照的确定性与不切代理对；全量排名后才取 K；故障/被篡改/失败运行不触发 labels 读取；标签与 query/语料错配为协议错误；pilot 协议 v2 的多 required-core 与 sufficient-alternative 判定；门槛的 pass/fail/uncertain 分支；自动分析被拒绝；缺角色文件是输入错误而非回退）。
- `packages/backend` `bun run typecheck` 通过；`oxfmt --check` 对新目录无差异；`oxlint` 仅有顺序 `await` 的 `no-await-in-loop` 警告（编码保持与生产相同的顺序，样本逐个读取）。
- 生产守卫：`bun test packages/engine/src/query/semantic` **46 pass / 1 skip / 0 fail**（skip 为既有，含 formula pin 与 no-lexical 守卫）。

### 26.8 建议与停止决定

**建议：停止“query 侧人工角色加权”这一方向，不进入 G2/G3，不构建 analyzer 或学习器；保留 Q+I 的实现但不继续验证它。** 依据：Q 与 Q+I 在旧开发集上同时低于 hit@5 与 MRR 门槛，且无角色的同预算分段对照给出相同量级的结果，没有可归因于角色的收益，Q+I 相对 Q 也没有可辨别的差别。该判断是否适用于独立标注者与独立真实任务，**证据不足**——本次的单标注者角色可能代表不了其它标注方式，pilot 未运行；但在旧集上已失败这一点，不需要 pilot 才能成立（第 3 项明确要求不允许以新增收益掩盖旧损失）。

如果仍要继续，应当先改变假设而不是调权重：(1) 查询向量保留整句语境（Q 现在丢掉了），例如只对生产 clause 加角色维度，需另立设计；(2) 面对对 query 追加文本极敏感的表示，先评估表示质量（研究计划 §2 已列出的公共分量/hub 问题）；(3) 若要获得独立证据，需要真实新任务与独立标注者，补采后用同一工具运行 `--usage pilot`。权重、条件和门槛在看到本节结果后**没有**被修改，下一轮若调整须重新登记并说明已被查看的结果。

### 26.9 未完成项与限制

- §26.4–26.8 的结论来自开发集；§26.10 补做了一次小规模 pilot，但只有 5 条任务有可接受目标，统计功效不足，且相关性标注是单评审者（agent）。协议 v2 的成功判定和覆盖可比性规则在 §26.10 首次被真实标签使用。
- 协议 v2 规则未获用户明确确认（见 §26.2）。
- Q 与 Q+I 对多动作 query 只做角色内平均，`actionGroup` 不影响分数；这是登记策略的限制，不是对多意图任务的验证。
- 同一模型、同一 97 Practice 语料、同一设备；开发集 50 例同源任务簇未去重。
- 负对照 `N-segments` 是一种固定的确定性切分，不代表所有“同预算非角色文本”的做法；`N-background` 只有一句固定背景。
- 评分延迟用的是独立参考实现，不是生产 scorer；未测 analyzer、native 工作集与启动。
- 运行之后新增了 `pilot-queries.py`（见 §26.10 的选择规则，脚本不在仓库）与 `pilot-queries.ts`（intake 校验）及其测试；§26.3 的代码 digest 描述的是新增 `pilot-queries.ts` 之前的 28 个文件，pilot 运行时目录有 29 个（digest `4c68c992…`）。

### 26.10 真实任务 pilot（2026-10-08，用户授权从 Lorelum 仓库抽取）

**结论：数据不足以判定收益，也没有任何收益迹象。** 40 条真实任务中只有 5 条被评审者认为语料里存在可接受目标；在这 5 条上 control 成功 3、Q 与 Q+I 成功 2（回归 1 条，改善 0 条），并多出 1 条含禁项的 query。按预登记规则 Q 与 Q+I 的 pilot 判定为“失败”，但这是 5 个样本上的一次回归，不能当作统计结论。方向与 §26.4 的开发集结果一致：没有可归于角色的收益。

**任务来源与选择规则（运行前固定，不看内容）**

- 总体：用户授权从 `lorelum/lorelum` 与 `lorelum/lorelum-packs` 抽取；`gh api` 取全部 issue（不含 PR，state=all）共 145 条（主仓库 129、packs 仓库 16），主仓库在前、编号降序。
- 排除（按标题/标签的机械规则）：标签含 research 或 evaluation；标题匹配 `semantic|embedding|ranking|hybrid|retriev|语义|检索|评测|benchmark|\beval|bench\(`（避免与本研究本身相关的 issue 混杂）；标题以 chore、ci、release、prepare 开头。剩余 103 条。
- 抽样：系统抽样，取第 1、3、5…条，满 40 条为止；结果 40 条全部来自主仓库（packs 仓库没有被抽到）。query 为 issue **标题原文**，未改写；任务簇 = issue 号（40 个独立簇）；其中 13 条中文、27 条英文。目标 Practice 内容在选择时未被打开。`queries.json` SHA-256 `97f1e01f…dba0c`，保存在仓库外。
- 该来源的局限：全是 Lorelum 项目自身的工程任务（CLI、backend、插件、CI、站点），不是 Pack 的主要使用场景；同一团队的 issue，不是外部用户任务。粗粒度类别（按标题机械标注）：状态/条件 7、动作 vs 背景 33，**多意图、薄弱/未覆盖、无目标三类标记为 0**，是机械标注的缺口，并非语料没有这些情形——真实的无目标数由相关性标签决定（见下）。

**标注（与实验设计者隔离）**

- 角色：另一个 agent（`RoleAnnotator`）只读 40 条标题，不读 Practice、labels、排名或本实验文档，写出角色与等义重述（无动作组）。同一模型家族，单标注者，无一致性度量；manifest 记录 `independentOfTargets=true` 与此披露。
- 相关性：4 个 agent 评审者，每个 Pack 一个，只读自己 Pack 的 canonical 内容与 query，看不到排名、条件或角色标注，未列出的 Practice 记为“已审阅并判为无关”。因此每个评审者不能看到其他 Pack，`required-core` 只相对其 Pack 成立；单评审者、非人工、无双评审与一致性度量，**评分时 `labelsIndependent=false`**。评审者的耗时只有 36–51 秒，Practice 全文是否都被认真比对无法核实。
- 标签分布（40 × 97 = 3880 项）：required-core 3、sufficient-alternative 2、prerequisite-or-supplement 37、forbidden 1、undetermined 0、irrelevant 3837。有可接受目标的 query 5 条（lorelum-247、238、227、97、75）；其余 35 条 `noRelevantTarget`。

**结果（40 条 × 97 Practice，9 个条件，每个条件完整排名；control 复算 3880 对 `maxAbsDelta=0`）**

| 条件 | 成功（有目标 5 条中） | 禁项 query（共 40） | 前 5 名中的 irrelevant 槽位 / 200 |
| --- | --- | --- | --- |
| control | 3 | 0 | 189 |
| Q | 2 | 1 | 188 |
| Q+I | 2 | 1 | 188 |
| Q-flat / Q+I-flat | 2 / 2 | 1 / 1 | 188 / 188 |
| N-background | 3 | 0 | 188 |
| N-segments | 3 | 1 | 184 |
| Q-restated / Q+I-restated | 3 / 3 | 1 / 1 | 186 / 186 |

- 逐例：Q 与 Q+I 在 lorelum-247 上由命中变成 miss（唯一的 control→Q 变化），lorelum-238、75 仍命中，lorelum-227、97 在所有条件都未命中。含禁项的 1 条是 lorelum-72（站点 Star 计数缓存 API）里的 `react.server.request-dedup-cache`：Q、Q+I、flat、N-segments、重述条件都把它排进前 5，control 与 N-background 没有。
- 门槛：第 2 项 Q 与 Q+I 均为失败（成功数不严格增加，禁项 query 由 0 增到 1）；标注覆盖可比（未标注槽位均为 0）。第 3 项在本次运行中没有旧集 labels，沿用 §26.4 的失败。样本总数 40 满足登记的 24 条下限，但有目标的只有 5 条，这个判定只能说明没有收益迹象，不能说明收益不存在；标注非独立（单评审者 agent）也使任何“通过”都不可能。
- 一个与角色无关的观察：在 control 下，40 条 query 的前 5 名共 200 个槽位中，189 个被评审者判为 irrelevant，8 个是 prerequisite-or-supplement，3 个是 required-core，0 个禁项。也就是说语料覆盖（35/40 条任务没有可接受目标），而不是排序，是这批真实任务的主要限制。检索总会返回 5 项，本计划没有新增拒答阈值。

**限制**：目标只有 5 条且分散；评审者是 agent，单评审者，按 Pack 隔离；来源是单一项目的 issue 标题（无正文）；任务同一团队同一时期；标题是任务描述而不是 agent 在编码过程中真实发出的 query。本次运行代码 digest `4c68c992…`（29 个文件），原始数据、标签与角色文件存放在仓库外的本地评测目录，不提交。

**建议更新**：停止 query 侧人工角色加权的建议不变，且现在有两份一致的证据（开发集失败、pilot 无收益）。若要继续提升“真实任务适用性”，最大的杠杆是语料覆盖（这批真实任务 87.5% 没有可接受目标）与适用边界，而不是 query 侧角色。

### 26.11 概括视图探索前的任务来源审计(2026-10-08)

为概括视图草案([summary-view-protocol](../../../docs/research/summary-view-protocol.md))取新的有目标任务,两次采集均未达到协议要求的至少 10 条有目标 query,**概括视图条件未运行、未评分**。

| 来源 | 40 条 query | required-core + sufficient-alternative 的 query 数 | 标注 |
| --- | --- | --- | --- |
| pilot B:lorelum 仓库 issue 标题(与 pilot A 互补位置) | 40 | 0 | 4 个 Pack 各一名 agent 盲标 |
| pilot C:facebook/react、vercel/next.js、anthropics/claude-code、openai/codex 各最新 10 条 issue 标题 | 40 | 2(均为 issue 写作类 Practice 对信息不足报告) | 同上 |

- 本用户的提示历史只有 1 条记录,不能作为来源。
- 结论:公开 issue 标题描述的是产品自身缺陷或功能,不是 Practice 所服务的“工程师/Agent 如何做事”任务;换仓库不能解决覆盖不足。需要真实的、语料确实覆盖的任务(如 agent 会话中的请求)。
- 这些采集是固定规则、内容盲选,没有按 Practice 反向挑选;原始数据与标注在仓库外。

### 26.12 pilot D(真实 Codex 会话提示)上的 G1 与概括视图(2026-10-08)

**来源与标注**:维护者授权读取本机 Codex 会话中其亲自输入的提示(2026-05 至 09,653 条经形式过滤;不含 2026-10 的 G1 会话)。固定种子哈希分层(项目配额 14/8/8/10,每会话至多 2 条)取 40 条,原文(空白折叠),37 条中文,32 个会话簇。角色标注与 4 个 Pack 的相关性标注由互相隔离的 agent 完成,仅见 query 原文或 Practice 全文。agentic-coding 与 issue-pr 两个 Pack 第一轮因未读全部正文/query 被截断而作废并重标(程序缺陷,不是结果不满意),第一轮产物未使用。结果:10 条有目标 query(8 个 required-core,5 个 sufficient-alternative),`labelsIndependent=false`(单评审 agent)。

**G1(pilot D,`--usage pilot`,control 4850/3880 对 `maxAbsDelta=0`)**:

| 条件 | 成功 / 有目标 | 禁项 query | 逐例变化 |
| --- | --- | --- | --- |
| control | 5 / 10 | 0 | - |
| Q | 5 / 10 | 0 | 无 |
| Q+I | 5 / 10 | 0 | 无 |

**概括视图(S,协议修订 1 冻结于运行前)**:

| 条件 | pilot D 成功 | 旧 50 例 hit@5 | MRR | scope | forbidden-before-core |
| --- | --- | --- | --- | --- | --- |
| control | 5 / 10 | 45 | 0.7637 | 2 | 1 |
| S | 5 / 10(无变化) | 44 | 0.7469 | 2 | 0 |
| S-dup(无新信息对照) | 6 / 10(`task-1b324d88` 改善) | 43 | 0.7563 | 1 | 1 |
| F(整篇向量对照) | 5 / 10 | 44 | 0.7352 | 2 | 1 |

- 门?:S 第 1 项通过;**第 2 项失败**(pilot 5 对 5,无严格改善);**第 3 项失败**(旧 50 例 hit@5 44 < 45,MRR 0.7469 < 0.7637)。结论 **fail**。
- 归因:唯一的 pilot 改善出现在不含新信息的 S-dup,不在 S;F 也无收益。概括内容没有显示额外信号。
- 成本:新增编码 97+ 条概括文本(distinct 1953,含全部条件文本);S 的评分 p95 113 ms(control 103 ms),进程 RSS 约 141 MB,均在预算内。
- 样本很小:有目标 query 10 条,单评审 agent 标注,`labelsIndependent=false`;pilot 的 5 条失败不能解释为排序问题,可能是语料覆盖或评审分歧。结论方向是“没有证据支持”,不是“已证无效”。
- 实现:`summary-view.ts`、`summary-conditions.ts` 与测试;`role-replay.ts` 新增 S/S-dup/F 条件,`role-scoring.ts` 把 S 加入门?候选。`bun test packages/backend/src/benchmark` 152 pass / 0 fail,backend typecheck 通过。原始数据与标注保存在本机私有评测目录,不随仓库提交。

## 27. 高级检索前的离线探索：subagent 适用性判断与融合对照（2026-10-13）

**结论：** 在 69 条开发请求上，LLM 只看请求原文与候选的标题、`applies_when`、例外边界做适用性判断，单独按判断排序时前 5 命中由对照 33/69 提升到 54/69（逐例 +25 / -4）。预登记的融合规则（向量名次与判断名次平均）相对对照有改善（40/69，+7 / -0），但远低于判断单独排序，且 hit@1 由 41 降到 26。判断单独排序是本节才加入的条件，未预登记，只在同一批开发请求上测过，不能当作已证结论。本节不证明生产有效性，不替代 G1，20.4 保持未勾选。

### 27.1 范围与披露

- 用户决定：本方向不做独立标注或独立请求验证，以开发集结果推进高级检索设计。本节记录该决定，但不把开发集结果写成独立验证。
- 请求集：`diag/reaudit/cand-private.json` 中的 69 条有金标 query（旧 v2 开发集，全部被反复使用）。
- 金标：既有双评审 `j-a`/`j-b` 中两者均为 `serves` 的条目，共 76 项，其中 64 项在向量前 24 池内。金标由 LLM 评审生成，与判断者同源，存在循环偏高。
- 判断者：6 个独立 subagent（JudgeS0–JudgeS5），每个读取一个分片文件，不访问仓库或其他标签。

### 27.2 判断输入与身份

- 候选池：仓库外独立对照运行的 `ranking.json` 中向量前 24，共 1656 对。每条请求内候选顺序随机打乱并匿名为 `k00`–`k23`，映射仅存于仓库外。
- 判断包字段：`request`（原文）、候选的 `title`、`applies_when`、`exceptions`（"Exceptions and boundaries" 段前 600 字符）。不含正文、向量分数、名次、来源或任何标签。
- 判断类别：`fit` / `same-topic` / `not-applicable`。判断标准与提示词原文登记于 `docs/research/advanced-retrieval-handoff.md`。
- 判断计数：fit 157，same-topic 290，not-applicable 1209；平均每条请求 2.28 个 fit。
- 原始判断与分片保存于仓库外的私有运行目录（路径不入库），不提交。

### 27.3 结果（69 条请求，前 5 命中）

| 条件 | hit@1 | hit@3 | hit@5 | 相对对照 hit@5 |
| --- | --- | --- | --- | --- |
| 对照（向量） | 18/69 | 30/69 | 33/69 | - |
| judge-only（判断优先，同类内按向量名次） | 41/69 | 52/69 | 54/69 | 改善 25，回归 4 |
| fusion（向量与判断名次平均，预登记） | 26/69 | 36/69 | 40/69 | 改善 7，回归 0 |

- 池内金标 64 项中 56 项被判 fit（88%）。hit@5 上限为 58/69（池 24 的覆盖），judge-only 达到 54/58。
- 对照 33/69 与 v2 的 50 例 hit@5 45 不是同一集合，不可直接比较。

### 27.4 解释

- 预登记融合被否定：把向量名次等权混入判断名次，hit@1 由 41 降到 26，hit@5 由 54 降到 40。融合规则不得为这批数据调参后当作结论。
- judge-only 有强信号，但属于本节事后加入的条件。要作为正式结论，需要新的预登记规则与新请求。

### 27.5 成本与延迟（未测准）

- 6 个 subagent 并行，每个 11–12 条请求，墙钟 1.5–3.6 分钟；未记录 token 用量，不能据此推算产品延迟或单次成本。
- 同期本地 reranker 试验（Qwen3-Reranker 0.6B，`/completion`，池 24，8 线程 CPU）：冷启动 1.03 s，首次请求 5.35 s，第二次 4.85 s；融合 43/69，单请求中位 5.46 s，p95 6.08 s。该试验与本节条件不同，仅作对照记录。本地 reranker 不进入产品规划。

### 27.6 限制

- 开发集被反复使用；金标与判断者同源；判断只看标题、适用条件与例外，未看正文。
- 每个分片只由一个 subagent 判断，没有重复采样，没有判断一致率数据。
- 25 个改善与 4 个回归未逐条人工核对。
- 没有独立请求、人工复核子集或非官方 Pack 数据；覆盖与泛化未知。
- 本节未修改生产代码：`scoreSemanticPractice`、golden pin、Profile、持久化 schema、CLI/API、v2 gold labels 均未改动。

### 27.7 测试与校验

- `bun test packages/backend/src/benchmark`：154 pass / 0 fail（20 个文件）。
- `packages/backend` `bun run typecheck`：通过。

### 27.8 停止决定与下一步

- 角色方向（§26 的 Q / Q+I）停止，不进入 G2/G3。
- 高级检索方向：判断信号在开发集上强，融合规则被否定。下一步在新仓库/新会话推进：接口合同、判断标准版本化、真实延迟与成本、重复判断一致性。
- 本地向量检索的 PR 留到高级检索服务开始时再提，本次不提交、不推送。
- 20.4 保持未勾选。

## 28. #236 验收：评测集、候选与排序分离报告、CR 案例（2026-10-13）

**结论：#236 仍未满足验收第 3 条（Registry/Pack 减法 CR 案例），不能关闭。** 评测集、候选与最终排序记录、召回与排序分开报告已建立。v1 的 40 条中，有金标的 34 条里 hit@5 为 26，候选召回（前 20）为 32，排序失败 6，召回失败 2。Registry/Pack CR 案例在修正版诊断中核心 Practice 排第 4，排第 3 的是 Registry/Pack 发布类 Practice，因此不通过。

### 28.1 范围与披露

- 查询集 `issue236-v1`：40 条，8 类各 5 条。由一个作者 agent 编写，只读 97 条 Practice 目录（id、标题、`applies_when`、stage、例外），未运行检索。**不是人工编写或人工审核。**
- 标注：两名独立 agent（A、B）各自读完整目录（无排名），分 `required` / `helpful` / `forbidden`。金标 = 两人 `required` 的交集。分歧 2 条：`paraphrase-3`、`adjacent-5`。
- **v1 设计缺陷**：`task_domain_conflict-1` 的查询原文要求“再给安装和发布指导”，使 install-path 成为合理的 required，不再是领域干扰项。该条不作为 CR 验收依据，结果保留但不计入 CR 结论。
- 修正版 CR 诊断 `i236-cr-v2-1`（单条，只问提交前减法 review）是在看到 v1 结果之后新增的，属于事后修正，已在此披露。v1 的其它 39 条没有改动。

### 28.2 冻结与身份

- `queries-v1.json`：revision `issue236-v1`，40 条，sha256 `6ef0db67e8e89097fd338e486669ee2887a9dc81b67582d5fb3c85053789a39a`。
- 重放：`control-cli replay`（生产 `scoreSemanticPractice` 公式），store `store-6bf1e1b-v4`（97 Practice / 1232 views），模型 granite Q4（`18e8ce8c…`），win32-x64 native manifest，4 threads。manifest `status=complete`；与生产评分比对 3880 对，`maxAbsDelta = 0`，排序完全相同。
- CR 诊断：revision `issue236-cr-v2`，1 条，同一 store 与模型；比对 97 对，`maxAbsDelta = 0`。
- 原始排名、标签、分片与脚本保存在仓库外的私有运行目录（路径不入库），不提交。

### 28.3 结果（v1，N=20，K=5，金标为两人交集，有金标 34 条）

| 指标 | 结果 |
| --- | --- |
| hit@5（任一金标在前 5） | 26/34 |
| 候选召回（任一金标在前 20） | 32/34 |
| 排序失败（前 20 有金标，前 5 无） | 6 |
| 召回失败（前 20 无金标） | 2 |
| 全部金标在前 5 | 24/34 |
| 前 5 含禁项的查询 | 7（禁项排在最佳金标之前：3） |
| 无金标查询（不计入命中） | 6（near_miss 5，adjacent 1） |

按类别（hit / 排序失败 / 召回失败 / 无金标）：direct 4/0/1/0；paraphrase 2/2/1/0；near_miss 0/0/0/5；adjacent 4/0/0/1；task_domain_conflict 4/1/0/0；same_topic_stage 5/0/0/0；chinese_cross_lingual 5/0/0/0；mixed_long 2/3/0/0。

### 28.4 失败分型

- **召回失败（2）**：`direct-4`（只跑了单元测试，能否声称集成完整）与 `paraphrase-1`（一台笔记本通过，能否声称全平台就绪）。金标 `claim-only-supported-outcome` 分别排第 49 和第 64。Practice 适用条件描述的是“声明完成前的证据”，查询是具体场景说法，表示层未对齐。
- **排序失败（6）**：金标排第 7–18，前 5 多为通用流程类 Practice（如 `converge-on-one-problem`、`replan-on-material-drift`、`close-or-declare-evidence-gaps`）。归类为通用项挤压具体项。
- **分散证据（1）**：`mixed_long-3` 的两条必需 Practice 分别排第 8 与第 73，同一查询需要两段分散的证据。
- **标注分歧（2）**：见 28.1。

### 28.5 Registry/Pack 减法 CR 案例（验收第 3 条）

- v1 `task_domain_conflict-1`：金标 `run-subtractive-review-before-commit` 排第 10；install-path 排第 1 且被两人标为 required。因设计缺陷不计入结论（见 28.1）。
- v2 诊断（issue 描述的场景，只问减法 review）：
  - 核心 `agentic-coding.review.run-subtractive-review-before-commit` 排第 4，进入前 5；两人一致标为 required。
  - 排第 3 的 `pack-creator.discovery.choose-project-local-or-registry-release` 是 Registry/Pack 发布类 Practice。标注者未将其列为 helpful 或 forbidden，但按 issue 对“仅领域相似项”的定义，它属于领域项，且排在核心之前。
  - 排第 6 的 `pack-creator.review.run-subtractive-content-review` 被标为 forbidden，排在核心之后。
  - **判定：不通过。** 该判定依据 issue 的定义，不是标注结论；标注者未标该 Practice，此点需要维护者确认。

### 28.6 验收项状态

| 验收项 | 状态 | 依据 |
| --- | --- | --- |
| 8 类、经审核的评测案例 | 部分 | 40 条 8 类覆盖；作者与标注均为 agent，未人工审核；1 条设计缺陷；2 条标注分歧 |
| 每例记录候选名单与最终排序 | 满足 | 仓库外 v1 运行的 `ranking.json` 每条 97 项全量排名，比对 `maxAbsDelta = 0` |
| Registry/Pack CR 案例排序 | 未满足 | 28.5 |
| 召回与排序分开报告，未召回记为召回失败 | 满足 | 28.3、28.4 |
| 内部候选宽度与公开 top-k 分离，不泄露诊断 | 未在本次新增检查 | 既有 N/K 边界记录见 §2；本次 engine 测试全部通过 |
| 无新 Markdown 正文格式、无手填结构化 query | 满足 | 本次未引入 |
| canonical 内容与 snapshot 一致性 | 满足 | 本次未修改 store、scorer、pin、Profile |
| OpenSpec proposal 先行并验证 | 满足 | `openspec validate advance-task-aware-semantic-retrieval --strict` 通过 |

### 28.7 限制与下一步

- 标注不独立于 LLM；查询与目录同源，可能存在目录偏好；没有人工复核子集。
- 40 条样本，有金标 34 条；每类 5 条，不足以做统计结论。
- 排序失败与 CR 失败的共同形态是通用项挤压具体项，属于排序问题，不是召回问题。纯向量下改善这一点需要新的排序设计，不能在 v1 上调参后当作验证。
- 下一步需要维护者决定：是否在纯向量前提下设计新的排序方案（例如按任务与阶段角色组织 query 与 Practice 视角，或改进通用项的降权），并在一个新的留出集上验证。
- #236 保持开放，不关闭；`20.x` 任务状态不因本节改变。
