# ADR 0012: 跨 CLI 进程复用关键词派生索引

- **Date:** 2026-09-08
- **Status:** Accepted
- **Related:** [Issue #63](https://github.com/lorelum/lorelum/issues/63), [ADR 0007](./0007-engine-local-store.md), [ADR 0011](./0011-local-store-point-read-and-query-boundary.md)
- **Decision authority:** Lorelum Owner。于 2026-09-08 批准并开始实施。
- **Supersession on acceptance:** 仅替代 ADR 0011 §4 中每请求全量读取、构建与关闭内存索引的生命周期，以及相应 QueryDependencies；保留查询输入、摘要、排序和错误协议。

## Context

当前 `QueryService.query()` 校验请求后，调用 `LocalStore.readEffectivePractices()`，投影、分词、构建 `:memory:` SQLite FTS5，然后搜索并关闭索引。CLI 每次新建进程，无法复用上一请求的工作。

仓库提交 `aff93d1` 的实现与[已有 benchmark](../development/keyword-query-benchmark.md)吻合。下表是历史观测，不是本方案重新测量，也不是产品 SLO。环境为 macOS arm64、Bun 1.3.8，20 次测量，文件系统缓存已预热，compiled CLI 每次启动新进程。

| Practice 数量 | 全量读取 p50 / p95 ms | 分词、构建与关闭 p50 / p95 ms | compiled CLI p50 / p95 ms | CLI 峰值 RSS MiB |
| --- | --- | --- | --- | --- |
| 1,000 | 15.33 / 16.94 | 31.21 / 31.38 | 108.24 / 109.54 | 113.8 |
| 5,000 | 78.24 / 80.19 | 157.97 / 159.26 | 302.29 / 307.96 | 173.7 |
| 20,000 | 314.84 / 322.80 | 636.33 / 645.41 | 1026.97 / 1048.63 | 420.9 |
| 公开 agentic-coding Pack，30 条 | 1.57 / 1.99 | 5.74 / 6.87 | 60.80 / 63.62 | 70.6 |

20,000 条时索引内搜索 p50 为 4.74 ms，主要成本在准备语料。各阶段分位数不能相加当作同一次请求耗时。合成语料只有少量主题模板，每条一个来源，不能外推至任意正文长度或 Pack 数量。

Issue #63 要求跨进程复用、Store-root 隔离、索引身份、更新失效和一致快照；新持久化生命周期先形成设计。代码现有 `generation`、`effectiveRevision`、canonical manifest 序列化、事务读取、row materializer 和 typed error 可以复用，但目前没有返回快照身份的读取接口。

## Decision

### 1. 独立的 SQLite 派生索引

推荐在每个显式 Store root 下增加 `indexes/keyword/v1/active.sqlite`。索引包含现有七个投影字段的分词结果、Practice ID、contentDigest 和 checkpoint metadata；摘要仍从 LocalStore 校验后的 canonical 行生成。

FTS5 schema、字段权重、分词逻辑、MATCH literal 编码、BM25 和 ID tie-break 复用现有实现。没有新增依赖、后台服务、ORM、Embedding、公共索引命令或配置项。`store.sqlite` 不存 FTS 表，安装提交不等待索引构建。

首次构建、索引损坏、实现版本变更和变更历史不可用时完整重建。正常 install、upgrade、uninstall 和 reindex 通过持久的 effective-revision 变更日志增量同步。安装本身不等待索引工作；下一次 query 把索引从其 checkpoint 补到当前 revision。因此连续安装 100 个 Pack 后只 query 一次时只同步一次；每次安装后都 query 时，也只处理该次影响的 Effective Practice，不重扫此前所有 Pack。

### 2. 索引身份由已验证 Store 快照和实现版本共同决定

包内快照身份的建议结构如下；字段名为拟议合同：

```ts
interface StoreSnapshotIdentity {
  readonly rootBinding: string; // SHA-256(realpath of the selected root)
  readonly generation: number;
  readonly effectiveRevision: number;
  readonly manifestDigest: string; // SHA-256(serializeManifest(validatedManifest))
}

interface KeywordIndexCheckpoint {
  readonly rootBinding: string;
  readonly effectiveRevision: number;
}
```

LocalStore 在 manifest A、SQLite metadata、manifest B 对账成功后产生身份；不可只信任磁盘 manifest 或调用者传入的 revision。活动 Pack 行在同一事务中验证并与 manifest 对账。空 Store 使用现有合法空状态规则，在初始化目录后取得 realpath。

`StoreSnapshotIdentity` 用于保证一次读取来自一个已提交 Store；`KeywordIndexCheckpoint` 只绑定会改变检索语料的 `effectiveRevision`。安装了一个只增加相同来源、但没有改变任何 Effective Practice 的 Pack 时，generation 和 manifestDigest 会变化，却不需要改写 FTS 文档。不同 root 仍不能复用索引；搬迁目录或复制到另一 root 会重建；不保存原始机器路径到 metadata。

每个 effective revision，即使 delta 为空，也可以推进索引 checkpoint；reindex 因而不需要全量重建。一个 `indexVersion` 同时代表 FTS schema、投影、分词和排序实现；任一部分改变结果时都递增它，并由目录 `indexes/keyword/v<indexVersion>/` 隔离旧索引。它不是用户可选参数。

首次构建额外记录按 ID 排序的 `[practiceId, contentDigest]` 数组之规范 JSON 的 SHA-256 和 documentCount，作为构建验证证据。增量同步只验证受到 delta 影响的 ID，复用时不重新遍历全部 ID/digest。可信 LocalStore mutation 必须维持 manifest、artifact、canonical 行的一致性；普通 query 不承担发现绕过 Store API 修改所有无关行的全库审计，这一完整性范围需随实现明确更新 CLI 文档。

### 3. LocalStore 拥有快照读取，QueryService 拥有检索编排

保留 `query(root, request)` 和 `createQueryService({ store })` 的组装形式；扩展 LocalStore 的窄读取能力，QueryDependencies 改为选择这些方法。下列是拟议 Engine API，须与本 ADR 一起评审；旧的 `getEffectivePractice` 和 `readEffectivePractices` 不删除。

```ts
interface EffectivePracticeSnapshot {
  readonly identity: StoreSnapshotIdentity;
  readonly practices: readonly EffectivePractice[];
}

interface EffectivePracticeChangeSnapshot {
  readonly identity: StoreSnapshotIdentity;
  readonly deltas: readonly { readonly revision: number; readonly delta: RevisionDelta }[];
  /** Final canonical rows for the union of added and changed IDs that still exist. */
  readonly currentPractices: readonly EffectivePractice[];
}

interface LocalStore {
  readSnapshotIdentity(root: StorageRoot): Promise<StoreSnapshotIdentity>;
  readEffectivePracticeSnapshot(root: StorageRoot): Promise<EffectivePracticeSnapshot>;
  readEffectivePracticeChanges(
    root: StorageRoot,
    afterEffectiveRevision: number,
  ): Promise<EffectivePracticeChangeSnapshot | undefined>;
  readEffectivePracticesAtSnapshot(
    root: StorageRoot,
    expected: StoreSnapshotIdentity,
    ids: readonly string[], // distinct valid IDs, at most the query limit of 50
  ): Promise<readonly EffectivePractice[]>;
}
```

这些方法复用现有 manifest A → SQLite read transaction → manifest B 协议；不把 Database、长事务或 callback 暴露给 QueryService。快照身份和内容必须从同一次读取产生，不能先读 revision 再调用旧全量 API 拼接。

批量读取用参数化 ID 集合查询和来源 JOIN，一次事务读取全部候选，复用 canonical/digest/source row materializer。它先验证 expected 对应的已提交状态，返回同一事务内存在的 Practice；结果顺序不作为排名。缺失 ID 由 QueryService 识别为索引不匹配，不静默减少 top-k。即使 ids 为空也要校验身份。身份变化抛新增 `StoreSnapshotChangedError`，QueryService 有界重试；不是 `practice.not-found`。

`readEffectivePracticeChanges` 是包内的增量索引输入。它从 `afterEffectiveRevision + 1` 到当前 revision 按顺序读取完整、连续的 delta，并在同一快照中物化这些 delta 的 `added ∪ changed` 中仍存在的最终 canonical 行。`invalidated` 只提供 ID，索引删除不需要旧正文。若 `afterEffectiveRevision` 落后于已保留日志、revision 不连续、日志格式损坏，或其大于当前 revision，返回 `undefined`；调用方走全量重建，不能猜测遗漏的删除。

现有 `effective_revision_outbox` 是外部 hook 的 at-least-once 队列，delivery 成功后会删除，不能承担索引补齐。新增内部 `effective_revision_log` 表：每个 committed effective revision 追加一行 `{ revision, delta_json }`，包括空 delta。它与 canonical 状态在同一 SQLite transaction 写入，不由 hook 消费。初始保留最近 1,024 个 revision；后续 mutation 在 transaction 中裁剪更早记录。超过保留窗口的旧 index 允许完整重建。这是内部存储参数，不是 Pack、CLI 或用户配置合同。

新增查询读取能力沿用当前全量 query 的无 journal convergence 行为；不借用带恢复写入的 get 循环。LocalStore 继续拥有 StoreBusy/StoreRecoveryRequired 分类。测试必须保持旧 query 对损坏 Store、pending mutation 和无隐藏恢复写入的语义。

包内责任：`local-store/lifecycle` 负责身份和有界一致性，`storage/sqlite` 负责 metadata、revision log 与批量物化，`query/keyword` 负责 FTS 版本、SQLite 更新和文件生命周期，QueryService 负责请求、命中校验、重试和摘要。`index.ts` 仍只是 barrel。

### 4. 一次 query 的完整流程

1. 校验 text/limit，非法请求不得读取 Store 或创建缓存。
2. 读取已验证身份 S，打开 `active.sqlite` 并检查 root binding、实现版本和索引 checkpoint。
3. 若 checkpoint 等于 S.effectiveRevision，直接搜索，得到最多 50 个 ID/digest。
4. 若 checkpoint 落后但 root binding 和实现版本匹配，取得 `readEffectivePracticeChanges(root, checkpoint)`。日志连续时，在索引自己的 SQLite write transaction 中删除每个 `changed` 与 `invalidated` ID，写入 `added` 与 `changed` 的最终 canonical 行，并将 checkpoint 原子推进到返回快照 T 的 effectiveRevision。一次更新可以跨越多个 revision；同一 ID 在这些 revision 中变化多次也只写最终行一次。
5. 若索引缺失、损坏、版本/root 不匹配，或变更日志不连续，读取一次完整快照 T 并创建全新 FTS 文件。全量重建是恢复路径，不是普通 Pack 更新路径。
6. 搜索与索引 checkpoint 相同的 T，然后调用 `readEffectivePracticesAtSnapshot(root, T.identity, ids)`。从这些 canonical 行生成原有摘要，并按候选顺序排列，逐一比较 ID/digest。空结果也执行快照身份校验。
7. 如果步骤 4 或 6 发现 Store 已推进，丢弃候选并继续补 delta；整个 query 最多三轮，之后返回 `store.busy`。如果在批量读取完成并验证后有新提交，允许返回已读到的旧快照，不承诺线性化到输出时刻，也不为随后 get 固定版本。

常见未变化请求不读取全量正文、不解析全部 Practice、不分词语料、不写 FTS 表；只做 Pack manifest/metadata 对账、FTS 搜索和 top-k 的 canonical 校验。普通更新后的请求只读取和分词 delta 影响的 canonical 行，并做相应的 FTS 删除/插入。该路径仍有 O(Pack 数量) 的身份对账成本，不能声称严格 O(1)，搜索复杂度也不等同于只读取 top-k 行。

### 5. 发布、并发与清理

首次创建或全量重建时，构建者使用唯一 `build-<uuid>.sqlite`，单事务填充 FTS 和 metadata，完成 FTS integrity-check、documentCount、ID/digest 集合验证后关闭并原子发布为 `active.sqlite`。首次发布后，正常 delta 同步在 `active.sqlite` 内使用 SQLite WAL 和一次 write transaction 完成：文档删除、文档插入和 checkpoint 更新不可分割。读者保留自己的 SQLite read snapshot，写者不原地替换一个正在使用的数据库。

索引维护使用独立的 index-writer lock，只串行首次创建、全量重建和 delta transaction；它不持有 Store mutation lock。Store 内容读取始终走已有的一致快照协议，索引写入只发生在取得完整快照或连续 delta 后。首次发布前再次确认当前 Store 身份；完整读取、分词和建索引均在 Store lock 外。失败不得修改 Store manifest、SQLite canonical 状态、outbox、revision log 或安装结果。每个锁取得路径都在 finally 释放。

两个进程可以同时准备首次构建；拿到 index-writer lock 后，后者若发现已有匹配 checkpoint 就丢弃临时文件。普通 delta update 由同一个 lock 串行，后者重新检查 checkpoint 后只补尚未写入的 revision。需要报告并发首次构建的额外峰值资源；若真实并发工作负载显示明显放大，再评估更早阶段的 single-flight。

读取者把一次打开的数据库连接视为一次 SQLite read snapshot；WAL writer 的提交不能混入已经开始的搜索。首次发布或全量替换时的路径替换行为需在目标平台测试；目标被打开而不支持替换的平台返回 typed publication failure，不能先删除 active 再发布。macOS compiled CLI 是本 issue 的最低验证平台，其他平台未经测试不宣称已验证。

正常 finally 只删除本次构建的临时文件。进程被终止时可能留下临时文件，下一次 query 不信任也不读取它；不按照文件年龄自动删除可能仍在构建的其他进程文件。文档提供停掉相关 Lorelum 进程后删除该 root 的 `indexes/keyword/v1/` 的恢复说明。缓存清理范围不得扩展到 Store 本身。

### 6. 失败与完整性范围

| 事件 | 规定行为 |
| --- | --- |
| 安装、升级、卸载、reindex 成功 | 原提交成功与否不受 FTS 影响；下次 query 用连续 revision delta 增量同步，日志不可用才重建 |
| active 缺失、格式/版本过旧、SQLite 检测到损坏 | 最多尝试一次从 canonical 快照重建；成功才返回普通成功 |
| active checkpoint 落后且 revision log 连续 | 在一个索引 SQLite transaction 中应用全部 delta；不全量物化或重分词无关 Practice |
| active checkpoint 落后但 revision log 被裁剪、缺行或无法解析 | 视为不可安全补齐，最多一次全量重建 |
| active 候选 ID 缺失或 digest 不同，Store 行本身合法 | 视为索引不匹配，最多重建一次；重复出现则 `query.failed` |
| canonical 行、来源或 manifest/SQLite 对账失败 | 保留 `store.recovery-required` / `store.busy`，不得从缓存摘要兜底 |
| 构建、搜索、写入、发布失败或磁盘空间不足 | `query.failed`；清理本次临时资源，保留此前 active，不返回过期结果 |
| FTS5 不可用 | `query.unavailable`，不重复重建 |
| 构建中进程退出 | active 保持先前完整版本或不存在，下次根据身份重新构建 |
| 发布后进程退出 | 已发布文件可以复用；未完成输出不影响 Store；文件不可读时走重建 |
| 内容持续变动 | 最多三轮，不无限重试；最终 `store.busy` |

一次 query 最多进行一次完整重建；三轮是快照变化重试上限，不能形成三次构建的隐含乘积。连续 delta 同步可在这三轮内继续推进 checkpoint，但每轮只能从一个已验证快照产生输入。所有资源在成功和异常路径关闭，错误原因内部保留，stdout 继续只输出原有 JSON envelope。

每次命中都进行全文件 checksum 或 FTS integrity-check 会重新引入与索引大小相关的扫描，本方案只在构建完成时做全量验证。复用依赖 SQLite 的打开/读取错误、版本 metadata 和命中 ID/digest 检查。合法 SQLite 文件中的蓄意 FTS 改写，或未触及读取页的损坏可能不被单次 query 发现；尤其“错误空结果”无法仅靠 digest 检查发现。该限制必须公开写入实现说明并纳入 Owner 对本方案的审阅，不能将普通 query 宣称为全库审计。检测到的损坏必须重建或失败，绝不能静默截断结果。

## Performance acceptance

以下是本方案建议的验收预算，待 Owner 接受后作为 #63 的工程目标；不是已有 SLO 或已测结果。使用同一机器上的新旧实现配对测试，保留所有样本。适用语料为既有固定种子、长度分布、查询和 top-k=5。

| 场景 | 建议预算 |
| --- | --- |
| 1,000 条复用 | compiled p95 ≤ 配对基线的 80%，峰值 RSS ≤ 基线 |
| 5,000 条复用 | compiled p95 ≤ 基线的 50%，峰值 RSS ≤ 基线的 80% |
| 20,000 条复用 | compiled p95 ≤ 基线的 25%，峰值 RSS ≤ 基线的 60% |
| 公开 30 条 Pack 复用 | compiled p95 ≤ 基线 + 15 ms，峰值 RSS ≤ 基线 + 15 MiB |
| 所有规模首次构建、日志缺失后的重建 | compiled p95 ≤ 对应基线的 2 倍 + 50 ms，峰值 RSS ≤ 基线的 1.25 倍 + 20 MiB |
| 有连续变更日志的更新后首次 query | 只物化、分词和插入 `added ∪ changed` 的最终当前行；不得触发全量读取或重建 |

预算考虑首次构建增加持久化、完整性检查和 flush；任何未达标项保留数据并分析，不能测试后悄悄放宽。额外报告索引大小、临时磁盘峰值、多 Pack/多来源、长正文和两个并发 builder，但不把未定预算声称为已通过。

正确性验收同时要求：未变化复用阶段完整 Practice 物化数量为 0、语料分词与索引 INSERT 数为 0、canonical 校验仅覆盖候选及其全部来源；连续日志的更新阶段，完整 Practice 物化数量为 0，语料分词与索引 INSERT 数等于最终受影响且仍存在的 `added ∪ changed` 行数。结果 ID、顺序、摘要、digest 与内存基线逐项一致。这些计数通过测试注入/benchmark instrumentation 采集，不加入公共 CLI 响应。

增加一个安装交错基准：从固定规模的 Store 开始，连续执行 100 次确定性的 Pack mutation，每次 mutation 后执行一个 compiled query。除了最初建库和人为制造日志缺口的恢复样本，该序列的全量物化与全量 FTS 构建次数必须为 0；累计分词和 FTS INSERT 数只能随 100 次 delta 的实际有效 Practice 变化数增长，不能随第 N 次时 Store 总大小增长。报告每轮和整个序列的 p50/p95、累计耗时、峰值 RSS、索引大小与磁盘写入量。

## Implementation and verification

设计接受后按四个可审查步骤实施；若拆 PR，均围绕 #63 链接并说明前后依赖：

1. 增加 `effective_revision_log` migration、写入、保留裁剪和带身份的 change-snapshot 读取。先以测试冻结连续性、缺口、空 delta、回退和并发合同，保留现有 query 行为。
2. 增加带身份的全量读取、轻量身份读取和受身份约束的批量读取。
3. 实现首次 FTS 构建、WAL delta transaction 和 QueryService 复用流程，更新 CLI 指南、依赖类型与测试。达到跨进程结果一致、未变化复用工作量归零和普通更新仅处理 delta 后再进入性能验收。
4. 扩展现有 benchmark，提交新旧配对结果、100 次安装交错序列、平台信息、真实 Pack 固定提交和恢复说明。达到全部验收后才关闭 #63。

回归矩阵必须覆盖安装、同内容来源变化、升级、卸载、reindex、空 Store、无匹配、非法请求、连续 100 次安装后每次查询、同 revision 不同 root/manifest、目录搬迁、版本变化、revision log 裁剪/缺行/损坏、两个进程首次构建、delta update 与 mutation 交错、搜索后更新、空结果后更新、读取者仍持有 WAL read snapshot 时写入、损坏 active、构建/flush/rename/WAL transaction 失败、进程退出。使用可控屏障强制交错，不能仅靠 sleep 概率复现。检查 source/canonical 损坏仍有原错误，索引损坏不影响成功安装；增量和重建失败均不抹去此前有效 active。

性能实验在隔离临时 Store 上使用现有 1,000 / 5,000 / 20,000 合成数据和固定公开 Pack。公开 Pack 固定为 `lorelum/lorelum-packs` 提交 `4e0ba43d4274c4908c3eb6bf178ec666980f49ea` 的 30 条 agentic-coding，并复用原查询与标签。每组至少 20 个 compiled 新进程样本，分别测：删除派生缓存后的首次构建、已有缓存未变复用、连续 revision log 下固定内容更新后的增量查询、日志缺口后的重建，以及更新后复用。安装和更新操作在 query 计时外，但单独报告其耗时；每次首次构建样本重置缓存，每次更新样本执行同样的内容改动。

拆分身份读取、revision log 读取、delta canonical 物化、全量物化、分词/构建、delta transaction、验证与发布、搜索、候选物化、完整 QueryService、完整 CLI；各项记录 p50/p95，CLI 记录最大峰值 RSS，说明 warm filesystem 与进程启动条件。质量脚本同时在内存基线和持久索引上运行，验证排序完全相同。对 compiled CLI 做 query → get 的 ID/digest 往返。普通 source CLI 检查遵循开发指南的 lore-dev 约束；benchmark 编译二进制只在隔离 Store 上运行。

## Compatibility and recovery

需要一次内部 `store.sqlite` migration 新增 `effective_revision_log`；不迁移 canonical Practice、Pack 格式或 manifest。已有 Store 首次 query 延迟构建；已有 CLI 忽略派生目录和未知 revision-log 表并继续内存检索，因此回退二进制不需要回退 Store。未来不兼容索引版本使用新的版本目录；旧文件可在进程停止后清理，不在查询时迁移旧 FTS 内容。

CLI 请求、JSON 摘要和既有错误码不变，但只读文件系统上原本可以完成内存检索的情况会因需要构建/发布缓存而失败；这是需要明确接受的兼容性代价。当前版本不加静默内存 fallback，避免掩盖缓存不可用。若只读 Store 是正式需求，应在接受本方案前补充显式运行模式及其可观测性合同。

## Alternatives and consequences

进程内 Map/Session 无法跨 CLI 进程复用。每次只加载持久 FTS、再全量读取正文仍保留主要成本，因此同时引入受身份约束的批量读取。每次 revision 不匹配就全量重建会在“安装—查询”交错时产生二次方工作，不能作为普通更新策略。现有 `effective_revision_outbox` 不保留已成功投递的历史，不能作为索引输入。将 FTS 写入 Store 数据库并在 mutation 事务中维护会扩大安装失败面和迁移范围；daemon 则引入本问题不需要的服务生命周期。当前已有 Bun SQLite 与 FTS5 足以实现所需机制。

推荐方案将全量准备成本移至首次构建、索引恢复、实现升级或 revision history 缺口；普通更新后的查询只承担实际 changed Practice 的处理成本。代价是额外磁盘文件、revision log 的有限存储、首次写入成本、并发索引写入与明确收窄的普通 query 审计范围。实现与后续评审聚焦 revision-log 保留窗口、性能预算，以及完整性和只读 Store 的兼容性取舍。
