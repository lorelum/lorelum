# ADR 0011: LocalStore 精确读取与关键词 Query 基础

- **Date:** 2026-09-07
- **Status:** Proposed

> Delivery note: this PR implements the point-read portion under #59. The QueryService decision below is the agreed follow-up under #60; the query API and its benchmarks are not included in this first implementation PR.

- **Related:** ADR 0002, ADR 0004, ADR 0007, [Issue #59](https://github.com/lorelum/lorelum/issues/59)（LocalStore 点查与服务组装）, [Issue #60](https://github.com/lorelum/lorelum/issues/60)（QueryService 与 FTS5）, [Issue #57](https://github.com/lorelum/lorelum/issues/57)（关键词检索研究）, [Issue #58](https://github.com/lorelum/lorelum/issues/58)（ORM 研究）, [LocalStore 读取与 Query 基础设计](../plans/local-store-read-and-query-foundation.md), [Query 分阶段规划](../plans/query-roadmap.md)

## Context

当前 `lore get <practice-id>` 通过 `LocalStore.open()` 物化整个 Effective Practice 集合，再由 CLI 对数组执行 `.find()`。这能返回正确结果，但一次精确读取会承担与目标 Practice 无关的 canonical 解析、来源组装和活动 Pack artifact 校验。随着 `query` 需要复用同一份 Store 内容，这条路径会把全量打开和 CLI 适配器误当成 Engine 的查询基础。

本阶段有两个确定需求：按 ID 读取必须属于 Engine，并且不能绕过 LocalStore 已有的 manifest、SQLite 和 operation journal 一致性规则；CLI 与未来 MCP 需要共享完整的查询用例边界，不能各自编排读取、检索和结果组装。与此同时，进程每次执行完命令就退出，Session、连接缓存或跨命令索引并不能解决当前问题。持久检索索引、Embedding 和 ORM 也没有足够的规模或性能证据成为本阶段前置条件。

## Decision

### 1. LocalStore 增加按 ID 的 Engine API

保留现有 `open()`、`readEffectivePractices()`、安装和恢复 API，并增加一个精确读取入口：

```ts
interface LocalStore {
  getEffectivePractice(
    root: StorageRoot,
    practiceId: string,
  ): Promise<EffectivePractice | undefined>;
}
```

合法且存在的 ID 返回完整 `EffectivePractice`，包括 canonical Practice、`contentDigest` 和按确定顺序排列的全部来源。合法但不存在的 ID 返回 `undefined`。Store 忙、manifest 与 SQLite 无法对账、目标行无法通过 canonical/digest 校验时，继续抛出已有 typed error；CLI 只负责把它们翻译成现有 `get` 错误码。Practice ID 规则仍由 `@lorelum/format` 拥有，Engine 和 CLI 在各自信任边界调用同一规则，不复制正则或范围常量。

### 2. 点查使用 SQLite 主键 JOIN，不物化无关 Practice

storage 层使用参数化 SQL，按 `effective_practices.practice_id` 主键过滤，并在同一条查询中带出来源：

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
LEFT JOIN practice_sources AS s ON s.practice_id = e.practice_id
WHERE e.practice_id = ?
ORDER BY s.pack_name ASC, s.source_path ASC;
```

目标行和全部来源因此只需要一次有界的 SQL 读取，不产生按来源逐条查询的 N+1。点查与全量读取共用同一个包内 row materializer：解析 `canonical_content`，重新通过 Practice schema 和 canonicalizer，核对 digest、重复列、effective revision、source digest 和路径。这样优化的是读取范围，不是降低数据校验标准。

### 3. 一致性读取复用同一套 manifest/SQLite 对账

点查和全量读取都通过包内的只读一致性 helper 完成以下流程：

```text
读取 manifest A
  -> 在一个 SQLite read transaction 中读取 metadata 和对应数据
  -> 读取 manifest B
  -> 只有 manifest A、SQLite (generation, effectiveRevision) 和 manifest B 相同才返回
```

并发 mutation 导致 tuple 不一致时按现有规则重试或抛 typed error。点查在进入这一流程前仍执行已有 operation-journal convergence；未完成 journal 不会被点查静默绕过。全量 `readEffectivePractices()` 保持现有调用路径，不因为共用一致性 helper 而新增 journal 写恢复。数据库连接、transaction 和关闭由 LocalStore 内部拥有，adapter 不接触 `bun:sqlite` 的 `Database` 或 statement。

普通 `get` 的完整性范围改为“目标结果来自同一已提交快照且自身自洽”。合法但不存在的 ID 返回 `undefined`，由 CLI 映射为 `practice.not-found`；只有目标 SQLite 行存在但格式、digest 或来源校验失败时才是存储错误。它不再扫描或 hash 任何 Pack artifact，包括目标 Practice 所属的 artifact，也不承诺发现无关 canonical row 的损坏。全库 artifact 校验继续由需要完整 Store 的 open/preflight/reindex 路径承担；如果未来需要主动巡检，另行设计验证命令，不把审计成本隐含在精确读取中。

### 4. QueryService 负责本阶段关键词查询用例

`QueryService` 是 Engine 面向 CLI 和 MCP 的稳定用例边界，负责一次 query 的请求校验、读取一致快照、调用具体召回实现、稳定排序和结果组装。它不拥有 SQLite schema、不重解析 Pack，也不把 FTS5、BM25 或内部排名分数暴露给 adapter；adapter 消费的是下面定义的公开摘要。

```ts
interface QueryService {
  query(root: StorageRoot, request: QueryRequest): Promise<QueryResult>;
}
```

本阶段冻结最小公开合同：

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
```

`QueryRequest.text` 会先 trim，不能为空，长度上限为 trim 后的 4,096 个 Unicode code points；`limit` 省略时为 5，最大为 50，必须是正整数。QueryService 只执行 keyword 模式，不公开 semantic、hybrid 或索引控制参数。它从一次 `readEffectivePractices()` 得到的同一份一致快照构造请求内 `:memory:` FTS5 数据库，查询和结果组装完成后在 `finally` 中关闭；不会循环调用 `getEffectivePractice()`，也不会把索引正文当成事实来源。

M1 的关键词实现使用 Bun 内置 SQLite FTS5，BM25 由 SQLite 提供；本阶段不把索引写入 `store.sqlite`，不引入 MiniSearch、Embedding、ORM、`Session`、`ReadPlan` 或通用 Retriever 插件协议。字段权重是包内实现参数，不作为用户可配置 API；后续持久索引和语义检索仍需独立设计。

关键词字段权重固定为 `id: 8`、`title: 5`、`appliesWhen: 3`、`techStack: 2`、`stage: 1`、`antiPatterns: 1`、`body: 1`。它们只影响内部 BM25 排名，不出现在 `QueryResult`。`InvalidQueryRequestError` 在 CLI 映射为 `usage.invalid`；FTS5 不可用时的 `KeywordIndexUnavailableError` 映射为 `query.unavailable`；其他 `KeywordIndexError` 映射为 `query.failed`，Store 的 `busy`/`recovery-required` 错误继续使用既有映射。

### 5. 由 composition root 创建共享服务

CLI 进程只创建一份 `LocalStore` facade，并把它注入命令 factory；factory 不再隐式构造另一个 Store。facade 创建本身不打开数据库，真正的数据库连接和 transaction 仍是每次调用的局部资源。这个调整明确依赖所有权，也让未来常驻 MCP 能显式复用服务，但不声称提供跨进程连接池、缓存或快照。

```ts
const store = createLocalStore();
const getCommand = createGetCommand({ store, storageRoot });
const queryService = createQueryService({ store });
```

`get` 没有独立的 `GetService`：它只做参数和 Store-root 适配，然后调用 `getEffectivePractice`。只有拥有跨入口编排语义的 QueryService 才作为独立用例边界保留。

## Consequences

精确读取的 SQL 工作量与目标 Practice 的来源数量相关，不再先构造完整 Practice 数组；但本 ADR 不给出未经基准验证的延迟或内存承诺。结果仍受 SQLite、manifest 和 journal 一致性规则保护，普通 `get` 的全库 artifact 审计范围则明确收窄。

Engine 成为 get 和 query 的真实业务入口。Engine 拥有 query 请求校验，CLI 继续拥有命令行 Store-root resolver 和 CLI 错误码翻译，未来 MCP 负责自己的协议解析和错误映射；它们共享的是 Engine 用例，不是复制规则实现。`QueryService` 保留稳定边界，但没有为未来检索后端提前引入插件体系。

## Rejected alternatives

- **继续 `open()` 后 `.find()`：** 保留了全量 I/O 和物化成本，无法成为精确读取或 query 的长期底座。
- **只把全量数组换成 Map：** Map 仍需先读完整 Store，不能消除无关读取。
- **为每个命令建立公开 Session 或缓存：** CLI 是短生命周期进程，跨命令无法复用；缓存还需要快照身份、失效和并发合同，本阶段没有证据支持。
- **Repository、ReadPlan 或通用 Retriever 层级：** 当前没有需要独立计划、多个后端或第二种真实召回来源的共同语义；新增层只会增加状态和迁移负担。
- **在 LocalStore 中加入 ORM 或 MiniSearch：** 当前 SQL 和 Bun SQLite 已满足点查；ORM 是否降低长期维护成本、MiniSearch 是否优于 FTS5 留给各自研究 issue，不把未验证收益变成本阶段依赖。
- **普通 get 继续扫描全部 artifact：** 这是审计级保证，不是按主键返回一条已校验记录的必要条件；完整校验保留在 recovery/reindex 等明确需要它的路径，普通 get 连目标 artifact 也不 hash。

## Implementation and verification

实现按 [Issue #59](https://github.com/lorelum/lorelum/issues/59) 与 [Issue #60](https://github.com/lorelum/lorelum/issues/60) 的范围交付：增加 `LocalStore.getEffectivePractice`，抽出全量和点查共用的 row materializer 与一致性读取 helper，加入 `QueryService`、请求内 FTS5 `KeywordIndex`、CLI `query` adapter，改造 CLI composition root，并同步本文件所述的 get/query 文档合同。不得改变现有 JSON envelope、exact-ID 语义、Store-root resolver、journal recovery、来源排序或 typed error 到 CLI code 的映射。Engine 直接调用的非法 ID 抛 `InvalidPracticeIdError`；CLI 在协议边界将同一输入映射为 `usage.invalid`。

验证覆盖目标存在、目标不存在、空 Store、非法 ID、来源合并、canonical/digest 损坏、manifest/SQLite tuple 不一致、并发 mutation、pending journal、Store 隔离和无关 artifact 损坏不阻塞普通点查。点查性能应拆分 SQLite 点查、Engine 调用、CLI 冷启动和端到端耗时。当前数据集只能作为基线，不能据此宣称已达到未来 query 的规模目标。

本 PR 包含[点查基线](../development/local-store-point-read-benchmark.md)。关键词实现及其基线由 #60 的后续 PR 交付；检索方案比较与 ORM 选择继续由 #57 和 #58 研究。ADR 合并前保持 Proposed，合并后按仓库约定转为 Accepted。

## References

- [ADR 0002: Bun/TypeScript toolchain](./0002-bun-typescript-toolchain.md)
- [ADR 0004: Agent-first CLI protocol](./0004-agent-first-cli-protocol.md)
- [ADR 0007: Engine LocalStore storage & lifecycle contract](./0007-engine-local-store.md)
- [LocalStore 读取架构与 Query 基础设计](../plans/local-store-read-and-query-foundation.md)
- [Lorelum Query 分阶段实施规划](../plans/query-roadmap.md)
