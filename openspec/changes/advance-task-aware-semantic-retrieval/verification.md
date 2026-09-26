# Verification Plan

> 本文件记录 Lorelum 主仓库实现的验证方案；完整 query 集、gold labels 和正式 benchmark record 由关联 benchmark 工作流维护，不复制进 Core 测试目录。§1–9 是历史记录；下列核查限制与 §10 的新实现验证优先，不应将旧作者陈述视为本轮重新验证。

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

baseline 已由 benchmark 侧在 `caecc53` 上冻结，记录见 benchmark 仓库 `results/records/retrieval-ranking-v2-baseline-caecc53.json`（replay record 一致）与其 `verification.md`：50 例全部 `status=ok`，core candidate recall 49/50、core final top-5 42/50、scope error 2。主仓库 §1.1 的单次冒烟只验证进程协议与真实 runtime，不计入 baseline。改动后本地对照见 §9；官方逐例对比由 benchmark 侧用新 run ID 执行，CLI 独立观察不得和 harness trace 混同。

| Date | Lorelum commit/build | Eval revision / corpus digest | Harness protocol/scorer | Profile | N/K | Candidate core present? | Baseline rank | Updated rank | CLI IDs observed separately? | Scope | Cost / limitations | Test-owned artifacts removed? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD | TBD |

## 9. 任务感知最终排序（改动后）

实现（design Decision 7）：`packages/engine/src/query/semantic/task-relevance.ts` 在同一次检索、同一 snapshot 内重排已经过 canonical 校验的候选。相似度是基础顺序；任务/阶段信号取自 canonical Practice 字段，用既有 keyword projection 与固定 keyword field weights 建立 request-private、离线的确定性 FTS5 BM25 打分，并在候选集合内归一化。最终顺序为 `similarity + SEMANTIC_TASK_SIGNAL_WEIGHT × taskStrength`，权重固定 0.05。`packages/engine/src/query/semantic/query-service.ts` 在读取 canonical Practices 之后、结果装配与 K 截断之前调用它，因此 `candidateIds` 与 `finalIds` 仍来自同一 attempt 和同一 snapshot。

历史作者曾记录“先更新设计并 strict validation 后实现”；本轮没有原始执行日志，无法从同一提交内的文件证明该顺序。CLI flag、协议字段未增加，但公开导出的 SemanticQueryDependencies 曾增加 taskSignal 属性，本轮收回。

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

灵敏度：把权重设为 0.03–0.06 得到同一组判定（core final top-5 48/50、forbidden 先于 core 0、无既有命中被挤出），0.08 起才出现 top-5 命中被挤出，这只是历史作者的参数扫描记录，题集已参与方法选择，不能据此证明无过拟合或未见数据泛化。权重取值的历史依据见 design Decision 7。

限制与非目标：

- `agentic-acceptance-direct` 仍是 candidate miss：该 core 在 semantic reader 与任务信号下都不进 top-20，池内重排不能修复。此前将新增候选来源直接等同 Profile/index 变化的判断已撤回；需比较来源与查询处理，只有实际改变持久化表示时才处理兼容迁移（tasks 3.2）。
- `agentic-limit-investigation` 在 baseline 已是排序失败（candidate rank 6），返回 candidateIds 位置由 6 到 11，但两版观察顺序不同，不能称原始召回下降。另有四个仍命中的 final 名次下降，见 analysis.md；不能称它是唯一负面影响。
- 本表是主仓库本地对照，用于确认 build 行为与排除回归；官方改动前后对比由 benchmark 侧在同一 revision、同一 Profile、N/K 与 scorer 下重跑，主仓库不据此声明改善。

干净 checkout 的 harness 对比（同一冻结 Store/cache、Profile、N=20/K=5，先在 `caecc53` 后在本次 build 各跑同一请求）：

| case | baseline `finalIds` 前 3 | 本次 build `finalIds` 前 3 |
| --- | --- | --- |
| `issue-pr-body-scope-conflict` | `react.server.request-dedup-cache`（forbidden）、core、`react.server.no-module-request-state` | **core**（`issue-pr-etiquette.pull-request.write-the-pr-body-for-a-cold-reviewer`）、`react.server.request-dedup-cache`、`react.server.no-module-request-state` |
| `issue-pr-readback-pack-context` | `pack-creator.release.verify-the-supported-install-path-before-claiming-release`、`…clean-markdown`、`pack-creator.review.run-subtractive-content-review` | `…clean-markdown`、**core**（`issue-pr-etiquette.communication.read-back-your-post-before-requesting-review`）、`pack-creator.release.verify-the-supported-install-path-before-claiming-release` |
| `agentic-supported-claim` | `agentic-coding.verification.map-evidence-to-acceptance`、…、…（core 不在前 3） | **core**（`agentic-coding.delivery.claim-only-supported-outcome`）、`agentic-coding.implementation.confirm-product-surface-expansion`、`agentic-coding.verification.map-evidence-to-acceptance` |

该 checkout 内 `bun test packages/engine/src/query/semantic packages/engine/src/query/artifacts` 为 48 pass / 1 skip，`git status` 干净；`bun install` 无依赖变化，因此同一 SHA 可直接重建运行，无需新的 Profile 或索引迁移。


## 10. 候选观察与词面证据修正

维护者确认方向后，先更新 design §8、spec 和 tasks，并执行 OpenSpec strict，再修改实现。先加入回归测试：原实现有 7 个定向失败，分别暴露 FTS 隐藏降级、I/O 片段误匹配、微差放大、孤立词满额、无有效词仍加分、candidate 顺序和 digest 校验时序。之后另外用独立合成输入发现“追加未命中背景词会稀释证据”，在中间 coverage 实现上产生 1 个失败；按 design §8 的匹配数自然饱和修正后通过。没有修改冻结题面或按真实 query/Practice ID 写特例。

最终实现的验证：

| 检查 | 结果 |
| --- | --- |
| `bun test packages/engine packages/backend/src/benchmark packages/backend/src/modules/index packages/cli/src/query` | 325 pass、1 skip、0 fail；跳过项仅 Windows 文件关闭/rename 场景 |
| 定向 tokenizer / task relevance / query service / ProjectContext / harness tests | 52 pass、0 fail |
| `bun run typecheck` | 通过 |
| `bun run lint` | 通过，保留无关文件既有 warnings |
| `bun run fmt:check` | 通过 |
| `openspec validate advance-task-aware-semantic-retrieval --strict` | 通过 |
| `git diff --check` | 通过 |

首次阅读阶段缺依赖的 0 pass / 3 errors 与本次安装锁定依赖后的结果分开记录；未修改依赖 manifests 或 lockfile。公开 SemanticQueryDependencies 不再包含 taskSignal；测试注入保留在非 barrel 的内部 trace。普通 keyword tokenizer、embedding projection/Profile、持久化 schema、N/K 和 harness v1 字段未改。

FTS 不可用现在返回已有 SemanticIndexQueryError，harness 映射 retrieval_failed，不再悄悄换回纯语义顺序。这是明确的失败行为修正，并非性能或质量提升证据。旧 candidateIds 的位置按历史语义解释，新实现恢复 reader 顺序；两版候选集合的比较与 final 排名比较仍须分开。

临时诊断只运行经维护者批准的 13 个 query 和预设合成对照；没有运行全量 benchmark。最初比例覆盖度公式的局部回退已导致该中间方案被否决，最终匹配数饱和公式按独立合成不变量冻结，不继续围绕该题集扫描。现有模型的 title+applies_when 单视角试验也被否决，未进入产品表示或 active index，详见 analysis.md。

新 build 的正式 candidate recall、final hit、四条降序、六条收益保留及 scope error 均待 benchmark 使用新 run ID 独立对照。不能继承 09e64be 的 48/50 或宣称 #236 完成。历史独立 CLI 观察和清理仍未补证；本轮的机器路径、诊断脚本、模型、向量、Store/cache、query/labels 和日志不进入提交。
