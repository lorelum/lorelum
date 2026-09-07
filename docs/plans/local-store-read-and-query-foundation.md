# LocalStore 读取架构与 Query 基础设计

> Draft，供维护者评审。当前 PR 实现点查部分（#59），关键词 Query 部分由后续 PR（#60）交付。本文不是 Accepted ADR；当前实现按 [Issue #59](https://github.com/lorelum/lorelum/issues/59) 及本阶段 Query 交付范围推进，合并后的 ADR 才是不可变合同。
>
> 相关文档：[LocalStore ADR](../adr/0007-engine-local-store.md)、[精确读取与 QueryService ADR（Proposed）](../adr/0011-local-store-point-read-and-query-boundary.md)、[点查实现 issue #59](https://github.com/lorelum/lorelum/issues/59)、[QueryService 实现 issue #60](https://github.com/lorelum/lorelum/issues/60)、[关键词检索研究 issue #57](https://github.com/lorelum/lorelum/issues/57)、[ORM 研究 issue #58](https://github.com/lorelum/lorelum/issues/58)、[`get` 当前合同](../cli/get.md)、[Query roadmap](./query-roadmap.md)。

此前 PR #54 中的 Keyword Query ADR 已由 PR #56 完整撤回，未经过维护者设计评审。本文重新给出当前关键词实现的合同；撤回的 ADR 不作为依据。

现在的 `get` 会调用 `LocalStore.open()`，得到全部 Effective Practice，然后在 CLI 里用 `.find()` 找 ID。这条路径让第一个精确读取命令快速落了地，但不适合继续成为 Query 的读取底座。

这次调整应该直接解决两个已经存在的问题：精确读取属于 Engine，不属于 CLI；按 ID 读取应该使用 SQLite 主键，而不是先构造全库对象。与此同时，Query 不能只被设计成一个“数组进、数组出”的算法函数。CLI 和 MCP 都会执行同一个完整用例，因此 Engine 还需要一个稳定的 Query 入口，把 Store 读取、检索和结果组装放在同一个责任边界里。

本阶段实现精确读取、QueryService 和请求内 SQLite FTS5 关键词检索；持久索引、daemon 和通用检索插件体系按后续需求与性能证据推进。

## 先把三类边界分开

是否保留一个抽象，不能只看今天有几个实现。更重要的是：没有它是否会让已经确定的两个入口复制同一套业务流程，或者让下一个阶段必然改写上层 API。按这个标准，本设计保留三层：

```text
CLI / MCP
  -> QueryService                 查询用例：校验、读取、检索、组装
      -> LocalStore               当前内容与一致快照的事实来源
      -> keyword retrieval        M1 的具体检索实现
      -> retrieval index          后续阶段的可重建派生状态
```

`LocalStore` 负责“当前有哪些有效 Practice，以及怎样一致地读出来”；它不负责理解自然语言和排名。`QueryService` 负责“一次 query 怎样完成”；它不拥有 SQLite schema，也不重解析 Pack。关键词、向量和融合算法是 Query 内部可演进的检索能力，不应泄漏到 CLI 或 MCP。

因此 `QueryService` 现在就有明确价值；相反，`ReadPlan`、Repository 层级和通用 Retriever 插件协议目前没有必须解决的问题。它们不是永远禁止，而是要等真实的第二种执行方式暴露出共同合同后再定义。

具体取舍如下：

| 能力 | 现在的决定 | 理由 |
| --- | --- | --- |
| `LocalStore.getEffectivePractice` | 现在加入 | `get` 已有点查需求，SQL 主键能直接消除全量读取 |
| row materializer / 一致读取 helper | 现在抽取，保持包内 | 已有全量与点查两个调用方，共享的是 correctness |
| `QueryService` | 本阶段加入并作为 Engine 公共 API | CLI、MCP 共享完整查询用例，后续索引变化不应穿透 adapter |
| 具体 `KeywordIndex` | 本阶段封装 Bun SQLite FTS5，包内使用 | 复用全文索引和 BM25，不自研排名算法、不引入 MiniSearch |
| `RetrievalStore` | 保留独立所有权，按性能证据启动 | 后续持久索引确实需要独立生命周期，但 M1 未证明现在就要建库 |
| 批量 Practice 读取 | 持久候选索引接入时加入 | 现在没有调用方；届时它能避免 N+1 并保证同一快照回填 |
| 通用 `Retriever` / `CandidateIndex` 接口 | 等第二种召回来源再提炼 | 方向明确，但异步、rank、profile、stale 语义尚未确定 |
| Session、ReadPlan、Repository 层级 | 不加入 | 不提供跨进程复用，也没有需要它们承载的当前决策 |

## 现在的成本在哪里

`createLocalStore()` 只是创建一个很小的 facade，没有打开数据库。当前读取时间主要花在 `open()`：

```text
读取 manifest
  -> 打开 SQLite
  -> 物化并校验全部 Effective Practice
  -> 重算全部活动 Pack artifact digest
  -> 校验 projection 和来源
  -> 返回完整数组
  -> CLI 再查一个 ID
```

所以把 `.find()` 换成 Map 不能解决问题。Map 仍要从完整数组构建，前面的全量 I/O 和解析都已经发生。

进程内 session 也不是跨命令缓存。每次执行 `lore get` 或 `lore query` 都会启动新进程，命令结束后连接和内存自然消失。一次请求内保持同一个 SQLite transaction 仍然有意义，因为它保证结果来自同一个快照；但不需要为这个事实设计公开的 Session 对象。

## Engine 应该提供什么接口

直接给 `LocalStore` 增加精确读取，而不是先做一个只移动 `.find()`、没有性能收益的过渡版本：

```ts
interface LocalStore {
  getEffectivePractice(
    root: StorageRoot,
    practiceId: string,
  ): Promise<EffectivePractice | undefined>;

  // 现有 open/install/upgrade/uninstall/reindex/readEffectivePractices 保留。
}
```

它的语义很简单：

- ID 合法且存在：返回完整 `EffectivePractice` 和所有来源。
- ID 合法但不存在：返回 `undefined`。
- Store 正在变化：抛 `StoreBusyError`。
- Manifest 与 SQLite 无法对账：抛 `StoreRecoveryRequiredError`。
- ID 格式非法：抛 `InvalidPracticeIdError`。

Practice ID 的格式规则已经属于 `@lorelum/format`。CLI 可以在打开 Store 前调用同一规则，尽早返回 `usage.invalid`；Engine 也调用它，因为公开 API 不能假设调用者一定经过 CLI。这里是同一规则在两个信任边界执行，不是写两套校验。实现继续复用现有 `ID_REGEX`；没有出现新的复用需求前，不再额外包装一层 validator。

同理，`--store-root` 的解析继续复用 CLI 现有的 `resolveInvocationStorageRoot()`。共享规则应放在拥有它的领域模块里；“共享”不等于所有东西都移动到 `@lorelum/shared`。

## 点查怎样实现

现有 LocalStore 已通过 `bun:sqlite` 执行 SQL、迁移和事务。本次继续使用参数化 SQL，不安装额外 SQLite 驱动或 ORM。轻量 ORM 的类型推断和查询组合可能减少维护成本，但不能替代 canonical、digest 和跨介质一致性校验；后续由 [issue #58](https://github.com/lorelum/lorelum/issues/58) 评估 Drizzle 与直接 SQL，再决定是否迁移。

SQLite 已经有 `effective_practices.practice_id` 主键，来源表也有以 `practice_id` 开头的索引，不需要先修改 schema。storage 层增加一条 joined query，同时读取 Practice 和来源：

```sql
SELECT
  e.practice_id,
  e.content_digest,
  e.canonical_content,
  e.title,
  e.stage,
  e.tech_stack_json,
  e.applies_when,
  e.severity,
  e.effective_revision,
  s.pack_name,
  s.source_path,
  s.content_digest AS source_digest
FROM effective_practices AS e
LEFT JOIN practice_sources AS s
  ON s.practice_id = e.practice_id
WHERE e.practice_id = ?
ORDER BY s.pack_name, s.source_path;
```

目标 Practice 和所有 sources 在一条 SQL 里返回，不产生 N+1。读取结果继续走现有 canonical materializer：解析 `canonical_content`、执行 Practice schema、重新 canonicalize 和计算 digest、比较重复列，并校验 source digest。

建议从现有 `snapshot-reader.ts` 抽出可以同时服务“全量快照”和“单条结果”的 row materializer，再新增 `practice-reader.ts` 放点查 SQL。这里只抽一个已经出现两个调用方的具体能力，不引入 Repository、ReadPlan 或 Reader 层级。

```text
storage/sqlite/snapshot-reader.ts   全量读取
storage/sqlite/practice-reader.ts   按 ID 读取
storage/sqlite/row-materializer.ts  两者共用的行校验和组装
```

如果后续 Query 确实需要按候选 ID 批量取回，再在 `practice-reader.ts` 增加有界的 `WHERE e.practice_id IN (...)` 查询。ID 超过 SQLite placeholder 预算时分批，但所有批次仍在同一个 read transaction 中执行。现在不为了未来接口提前实现它。

## 一致性逻辑只抽一个函数

按 ID 读取仍然不能绕过 Manifest 与 SQLite 的提交一致性。现有 `readEffectivePractices()` 已经实现了 manifest A、SQLite transaction、manifest B 的读取和重试。新增点查如果复制一遍这套循环，很快会出现两套恢复和错误语义。

这里值得抽离的是一个包内函数，而不是新的对象模型：

```ts
async function readConsistentSnapshot<T>(
  rootPath: string,
  read: (database: Database, metadata: StoreMetadataSnapshot) => T,
): Promise<T>;
```

它只接受 Engine 内部的同步、只读函数，负责：

```text
读取 manifest A
  -> 在一个 SQLite transaction 中校验 metadata 并执行 read()
  -> 读取 manifest B
  -> A、SQLite tuple、B 一致时返回
  -> 否则按现有规则重试或抛 typed error
```

全量读取与点查共用这个包内函数；数据库连接、transaction 和关闭也由 LocalStore 内部管理，不暴露给 adapter 或 QueryService。由于回调可能被重试，其中只能读取和组装数据，不能发送通知、执行网络请求或产生其他外部副作用。

Pending journal recovery 不硬塞进这个 helper。`getEffectivePractice()` 在进入一致读取前继续调用现有 journal convergence，并在 mismatch 后重新检查 journal，以保持当前 `get` 的恢复语义；`readEffectivePractices()` 不会因为共享 helper 就被顺便改成另一种公开行为。

## 为什么普通 `get` 不再扫描所有 artifact

当前 `get` 使用 `open()`，所以即使查询一个不存在的 ID，也会重新 hash 所有活动 Pack，并解析所有 SQLite canonical row。这个行为对恢复诊断很强，但它不是精确读取成立所必需的条件。

建议把普通读取的保证收敛为：

- Manifest A、SQLite metadata、Manifest B 属于同一个 commit。
- 返回的 Practice canonical content、digest、重复列和 sources 自洽。
- 遇到未完成 journal 或并发 mutation 时，不返回混合快照。

普通 `get` 不承诺在返回前发现与目标无关的 artifact 或 canonical row 损坏。全库 artifact 校验继续存在于 install/upgrade/uninstall 的 preflight 和 `reindex`，因为这些操作确实需要在完整 Store 上做恢复或产生新状态。

这会改变 [`get` 当前合同](../cli/get.md) 中“未知 ID 前也先检查全部完整性”的描述，因此需要先完成 design alignment，再在同一个实现 PR 中更新文档和 corruption 测试。没有明确的人工审计场景前，不额外设计 `lore verify`；以后如果需要主动巡检，再作为独立能力讨论。

这项取舍不是以安全换速度而不说明边界。快速读取证明的是“这条结果来自一个一致的已提交 SQLite 快照，而且返回行有效”，不是“整台机器上的所有 Pack 文件此刻都未被改动”。后者需要全库 I/O，应由真正需要它的操作承担。

缺失 Store 的现有 initialize-on-read 行为也保持不变。它与点查性能无关，不在这次改造里顺便修改。

## CLI 只做适配，并共用一份 Store

当前命令 factory 各自有默认 `createLocalStore()`。这不会造成明显性能问题：facade 本身不打开数据库，而且一次 CLI 进程只执行一个命令。把它改成每个进程只创建一份，主要收益是依赖所有权清楚，并让未来常驻 MCP 能显式复用同一组服务；不能把它描述成跨命令连接池或缓存。

生产依赖在 registry 这个 composition root 组装，再传给各命令：

```ts
const localStore = createLocalStore();
const storageRoot = defaultStorageRoot();
const queryService = createQueryService({ store: localStore });

const commandRegistry = snapshotCommandDefinitions([
  createInstallCommand({ store: localStore, storageRoot }),
  createGetCommand({ store: localStore, storageRoot }),
  createQueryCommand({ queryService, storageRoot }),
  ...createLocalizationCommands(),
]);
```

Store、QueryService 和默认 root 由组装处提供，作为 command factory 的必填依赖，避免命令内部再次隐式创建。各命令只声明实际使用的能力：

```ts
interface GetCommandServices {
  readonly store: Pick<LocalStore, "getEffectivePractice">;
  readonly storageRoot: StorageRoot;
}

interface QueryCommandServices {
  readonly queryService: QueryService;
  readonly storageRoot: StorageRoot;
}
```

Install 同样声明它需要的 Store 方法；registry loader、source materializer 等命令专属依赖可以保留局部默认值和测试替换入口。测试直接提供满足最小接口的替身，不需要通用 `CliServices` 容器。当前 `get` 没有额外用例编排，直接调用 LocalStore 即可，不增加只转发一次调用的 `GetService`。

`get` 的主体会缩成：

```ts
const id = invocation.positionals[0];
if (id === undefined || !ID_REGEX.test(id)) throw invalidInvocationError();

const root = resolveInvocationStorageRoot(invocation.options.storeRoot, services.storageRoot);
const effective = await services.store.getEffectivePractice(root, id);
if (effective === undefined) throw practiceNotFoundError();

return { data: toGetResult(effective) };
```

这里没有 Store 读取规则、SQL 或恢复逻辑。`toGetResult()` 只有在第二个 adapter 也需要相同投影时才抽成共享函数；当前只在 `get` 使用，直接保留在命令模块更简单。

## QueryService 是用例边界，不是算法插件

本阶段的关键词 Query 需要一份一致的 Effective Practice 语料，但它做的不只是对数组排序。一次完整调用至少包含请求校验、读取当前语料、检索字段投影、建索引或选择已有索引、召回、稳定排序和公开结果组装。未来 CLI 与 MCP 都需要完全相同的行为，这就是 `QueryService` 现在应当存在的理由。

Engine 暴露下面这组稳定类型：

```ts
interface QueryRequest {
  readonly text: string;
  readonly limit?: number;
}

interface QueryHit {
  readonly practiceId: string;
  readonly title: string;
  readonly stage: string;
  readonly techStack: readonly string[];
  readonly appliesWhen: string;
  readonly severity: "info" | "warn" | "critical";
  readonly contentDigest: string;
}

interface QueryResult {
  readonly mode: "keyword";
  readonly results: readonly QueryHit[];
}

interface QueryService {
  query(root: StorageRoot, request: QueryRequest): Promise<QueryResult>;
}

interface QueryDependencies {
  readonly store: Pick<LocalStore, "readEffectivePractices">;
}

function createQueryService(deps: QueryDependencies): QueryService;
```

`QueryRequest.text` 会先 trim，不能为空，长度上限为 trim 后的 4,096 个 Unicode code points；`limit` 省略时为 5，最大为 50，必须是正整数。`query(root, request)` 只执行 keyword 模式，调用方不传 mode。以后加入 semantic 或 hybrid 时，`mode` 类型和结果诊断字段仍要经过对应阶段的兼容性设计，并不是现在偷偷把尚未支持的模式塞进当前合同。

M1 的 factory 只依赖全量一致读取，因为它确实需要全库 corpus。它不依赖 `getEffectivePractice()`：如果排名后对每个 ID 再调用点查，会产生 N+1 SQL，而且每次点查可能属于不同快照。M1 应直接从本次读取的同一份 immutable snapshot 组装摘要和 `contentDigest`。

这里有意使用 ADR 0007 已有的 public read path，而不是 `open()` 的全量 artifact 审计。它继承 `readEffectivePractices()` 当前的 lock-free 一致性和错误语义，`QueryService` 自己不检查 journal，也不偷偷触发 Store 写恢复。Query 与 get 的 journal 行为不同，调用方不应据此假定每次读取都会写恢复。

`QueryService` 内部拥有领域校验。空白文本、长度和 limit 范围只定义一次，失败抛 `InvalidQueryRequestError`。CLI 负责把 `--top-k` 的原始字符串解析成十进制整数，以及识别重复 option、缺失 positional 这类传输语法错误；MCP 负责自己的 JSON schema。两个 adapter 都不重新实现查询领域规则。CLI 的 parser 在打开 Store 前可以拒绝明显的传输错误，但领域校验仍调用 Engine 的同一实现。

沿用现有 LocalStore 的工厂函数风格，QueryService 实现为闭包返回的小型服务对象。下面是本阶段编排；校验、投影、索引和结果组装各自拥有实现细节：

```ts
function createQueryService(deps: QueryDependencies): QueryService {
  return {
    async query(root, request) {
      const input = parseQueryRequest(request);
      const practices = await deps.store.readEffectivePractices(root);
      const documents = practices.map(projectKeywordPractice);
      const index = buildKeywordIndex(documents);
      try {
        const candidates = index.search(input.text, input.limit);
        return assembleQueryResult(practices, candidates);
      } finally {
        index.close();
      }
    },
  };
}
```

依赖在创建时绑定，root、请求、快照和候选属于每次调用。服务不保存 `currentQuery`、`currentRoot` 或本次结果，避免常驻 MCP 的并发请求互相覆盖。使用 class 也能实现相同边界，但目前无需为此改变工厂函数惯例或增加继承体系。

`parseQueryRequest()`、投影、分词和结果组装采用无 I/O 的纯函数，不修改传入的 Practice。它们可以独立测试；简单的结果映射先留作模块私有函数，不要求每个函数独占文件。FTS5 的连接、建表、写入和查询封装在 KeywordIndex 内部；`readonly` 只是 TypeScript 约束，仍需通过私有引用和必要的边界复制保证状态归属。

Store error 到 CLI error code、MCP error 的翻译仍在 adapter 边界。`InvalidQueryRequestError` 映射为 `usage.invalid`；`KeywordIndexUnavailableError` 映射为 `query.unavailable`；其他 `KeywordIndexError` 映射为 `query.failed`。`QueryService` 不依赖 Commander、stdout、JSON envelope 或 MCP SDK；反过来，adapter 也不知道 tokenizer、字段权重和索引结构。

建议的文件边界保持具体，不先做框架：

```text
packages/engine/src/query/
  query-service.ts          QueryService factory 与用例编排
  request.ts                QueryRequest 领域校验和默认值
  types.ts                  对外 QueryRequest / QueryResult
  errors.ts                 Query typed errors
  keyword/
    projection.ts           EffectivePractice -> KeywordDocument
    tokenizer.ts            query/document 共用的 tokenizer
    keyword-index.ts        内存 FTS5 的构建、查询、分数映射和关闭
```

`query/index.ts` 只导出 public types、errors 和 `createQueryService()`。`KeywordDocument`、`KeywordCandidate`、倒排表结构和 score 不导出到 CLI/MCP，避免内部算法一变就变成跨包兼容问题。

## M1 内部具体到什么程度

本阶段使用 `bun:sqlite` 创建请求内的 `:memory:` 数据库，通过 SQLite FTS5 执行全文检索和带列权重的 `bm25()`。倒排表、词项统计和基础排名交给 SQLite；我们负责字段投影、分词适配和候选映射，不自研 BM25，也不把 FTS5 的列权重称为 BM25F。此数据库不写入 `store.sqlite`，不引入持久索引迁移；每次查询从同一份 LocalStore 快照构建，结束后关闭。

Bun 提供内置 SQLite 驱动，无需新增 npm 依赖。本次在本机 Bun 1.3.8 上已实际验证 FTS5 建表、参数化插入、MATCH 与 bm25 查询成功；这不代替目标平台与 compiled CLI 的能力验证。M1 集成检查需要在支持的平台执行同样的 smoke test，缺少 FTS5 时报告明确的 Engine typed error，不静默改用其他算法。检索方案的质量和运行成本对比留给 [issue #57](https://github.com/lorelum/lorelum/issues/57)，不阻塞当前 FTS5 路线。

索引字段包含 `id`、`title`、`applies_when`、`tech_stack`、`stage`、`anti_patterns` 和 `body`，身份与 digest 另作 UNINDEXED 列。投影和 `tokenizeKeywordText()` 保持纯函数，覆盖 Unicode NFKC、大小写、点分 ID、snake/kebab/camelCase、中英混排与 CJK bigram。M1 先在 TypeScript 中生成由字母、数字和 CJK 字符组成的 token 流，以空格连接后交给 FTS5 `unicode61 remove_diacritics 0`；文档与 query 使用相同路径。必须测试 FTS5 二次分词不会改变预期 token 边界，不能假设内置 tokenizer 已解决中文检索。

Query 的 token 去重后逐项编码为 FTS5 引号字面量，再用 `OR` 连接以召回包含任一词项的候选；无 token 时返回空结果。SQL 参数绑定与 MATCH 表达式编码分别负责 SQL 和全文查询语法，不能将原始用户文本直接作为 FTS 运算符执行。字段权重在本阶段固定为 `id: 8`、`title: 5`、`appliesWhen: 3`、`techStack: 2`、`stage: 1`、`antiPatterns: 1`、`body: 1`，属于包内实验参数，不作为用户可配置 API；具体 token 示例和质量结果由质量集验证。不声称 FTS5 支持任意调节其内置 BM25 参数。

查询形状如下，七个固定索引列的权重统一来自包内配置：

```sql
SELECT practice_id, content_digest, bm25(keyword_documents) AS distance
FROM keyword_documents
WHERE keyword_documents MATCH ?
ORDER BY distance ASC, practice_id ASC
LIMIT ?;
```

FTS5 的 BM25 值越小越相关，所以 SQL 升序取前 k；适配器转换为 `score = -distance`，使包内候选继续遵循分数越大越相关的约定。同分时在 LIMIT 之前按 Practice ID 排序。SQL 有 LIMIT 不代表整个排名过程只处理 k 条，搜索成本仍需实测。

`KeywordIndex` 封装实际拥有的 FTS5 连接及其资源生命周期。下面是具体关键词实现的包内接口，不向 QueryService 暴露 Database 或 Statement：

```ts
interface KeywordIndex {
  search(text: string, limit: number): readonly KeywordCandidate[];
  close(): void;
}

function buildKeywordIndex(documents: readonly KeywordDocument[]): KeywordIndex;

interface KeywordCandidate {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly score: number;
}
```

`buildKeywordIndex()` 创建私有连接，在事务中批量插入投影后的字段，全部成功才返回可搜索对象；构建失败自行关闭连接并抛 typed error。返回后只允许搜索和幂等关闭，不提供增删接口。QueryService 通过 `finally` 保证搜索或组装失败时也关闭资源；每次请求独立建库，不共享活动连接。关闭后搜索属于调用错误，应明确失败。

候选按 score 降序、Practice ID 升序稳定排序。score 是算法内部值，不放进公开 `QueryResult`。这样排名代码不拥有 CLI/MCP 的摘要格式，而 `QueryService` 可以从同一快照组装最终结果。

不在 M1 定义通用 `CandidateIndex` 或 `Retriever` 接口，并不等于删除这个未来扩展点。现在还不知道它应当是同步还是异步、返回 score 还是 rank、怎样表达 profile、过期快照和降级；过早冻结只会让向量与混合检索迁就关键词实现。等持久关键词索引或向量召回成为第二种真实来源时，再从两者共同的数据流中提炼接口，`QueryService.query()` 的上层合同无需变化。

## 持久索引到来时怎样演进

第一版每次 CLI 调用都要全量读取并构建关键词索引。这可能足够，也可能不够，应先把成本拆开测量：

```text
LocalStore 一致读取与 materialization
Practice -> keyword document 投影
tokenize / index build
search / top-k
QueryService 总耗时
compiled CLI 进程总耗时与 peak RSS
```

用固定种子的 100、1,000、5,000、20,000 条 synthetic Practice 记录 p50、p95 和 peak RSS，再用真实公开 Pack 做校验。关键词质量与性能基线将在 #60 对应的实现 PR 中交付。这些数据只能说明测量环境和样本下的基线，不能证明持久索引必要或不必要。产品延迟/内存预算应在 M1 issue 中结合基线确认；超过预算才提前进入持久化设计。

判断时要看瓶颈落在哪一段：如果主要时间在 LocalStore materialization 和索引构建，持久派生索引有直接收益；如果主要时间是 CLI 启动，增加 SQLite 表并不会解决问题；如果只有更大规模下的 search 变慢，才需要优化 top-k 或索引结构。质量基线也要单独记录 Recall@k、MRR/nDCG 和越界误报，不能用延迟变快替代检索结果正确。

如果需要持久化，`RetrievalStore` 仍然是有意义的所有权边界：它与 LocalStore 分库、可删除重建、拥有自己的 schema 和索引发布规则，不进入内容安装事务。检索层只返回 `practiceId + contentDigest + rank/score` 等候选身份，不能把索引中缓存的正文当作当前事实。

这时 `QueryService` 会先取候选，再回到当前 LocalStore 批量确认和组装结果。不能循环调用 `getEffectivePractice()`；应在那个阶段增加一个有界的批量读取 API，所有 ID 在同一个 read transaction 中读取，并逐项核对 digest。候选缺失或 digest 不一致时，不得返回旧内容；重试、关键词降级还是报索引过期，由持久索引阶段根据公开模式合同决定。

当前只确定请求内 FTS5 的实现方向，持久索引 schema、active pointer、构建锁和 stale fallback 留到该阶段设计。未来向量索引同样按 Embedding profile 隔离，关键词和向量各自召回后由 QueryService 融合；BM25 与 cosine 原始分数不能直接相加。

## CLI 与 MCP 的生命周期不同

共享 `QueryService` 不表示共享生命周期策略。CLI 每次运行都是冷进程，M1 的进程内索引会随命令退出；把它包装成 Session 不能解决跨命令复用。常驻 MCP 可以在后续缓存索引，但缓存键至少要绑定 Store root、Effective Practice 快照身份和 tokenizer/algorithm 版本，并在请求开始时固定本次所见快照。

这些缓存规则应在 MCP 或持久索引阶段实现，不成为 M1 CLI 正确性的前提。`QueryService` 的价值是两种宿主复用同一个查询语义，而不是假装它们具有相同的连接和缓存行为。

## 分阶段落地

第一步只改精确读取，可以放在一个聚焦的 Engine/CLI issue 中：

1. 建立当前 `get`、SQLite 点查和 CLI 总耗时的基线。
2. 抽出共用 row materializer 和 `readConsistentSnapshot()`。
3. 增加 `practice-reader.ts` 与 `LocalStore.getEffectivePractice()`。
4. 在 CLI composition root 复用 LocalStore，并让 `get` 调用 Engine。
5. 更新 `get` 的完整性合同和 corruption 测试。

这一阶段验收：点查不物化无关 Practice、不扫描无关 artifact；ID 与 Store-root 规则没有重复实现；当前 JSON、错误码和 exact-ID 行为不变；并发 mutation、journal 恢复、目标行损坏、无关 artifact 损坏和 Store 隔离都有测试。benchmark 应分别报告 Engine SQL、完整 Engine 调用、CLI 启动和端到端耗时。

本阶段同时交付 `QueryService`、FTS5 `KeywordIndex`、CLI adapter 和质量/性能基线。纯规则测试不需要数据库；排名测试使用真实内存 FTS5，验证中文 token、MATCH 字面量、分数方向、同分 top-k、空结果和资源释放。用最小 Store 替身验证校验先于读取、每次查询只读一次语料，以及并发请求不串用 root 和结果。真实 Store 集成测试验证快照与摘要一致，adapter 测试验证参数和错误映射，目标平台 compiled CLI 验证 FTS5 可用。该阶段不依赖 MiniSearch、ORM、Embedding 或持久索引。

实现依据：[Bun SQLite 文档](https://bun.sh/docs/runtime/sqlite)、[SQLite FTS5 文档](https://www.sqlite.org/fts5.html)。检索替换与 ORM 引入分别在 issue #57、#58 中形成独立结论，不成为本阶段的前置工程。

第三步只有在 M1 证明确有读放大、冷启动或内存问题时才设计 RetrievalStore；语义与混合检索继续按 [Query roadmap](./query-roadmap.md) 后续阶段推进。这样既不会为了未来一次性造完整框架，也不会删掉已经确定会被多个入口和检索阶段复用的 Query 用例边界。
