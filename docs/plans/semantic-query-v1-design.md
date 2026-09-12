# Semantic Query v1 设计

- 状态：分阶段设计；semantic index 阶段已在 #116 实现，semantic query 仍待后续设计与实现
- 日期：2026-09-10；最后更新：2026-09-12
- 范围：为已安装的 Practice 增加本地优先的 semantic query；不实现 Hybrid 或后续检索优化。
- 关联 Issue：[Semantic Query v1 设计 #92](https://github.com/lorelum/lorelum/issues/92)、[后续模型评测 #85](https://github.com/lorelum/lorelum/issues/85)。
- 前置文档：[Query 功能路线](./query-implementation-design.md)、[持久关键词 index ADR](../adr/0012-persistent-keyword-index.md)、[Query CLI 合同](../cli/query.md)。
- 相关设计：[本地常驻后端](./local-backend-service-design.md) 和 [第二阶段模型驻留](./local-backend-stage-2-design.md) 定义服务与模型基础；semantic index 的已实现边界见[服务边界文档](./semantic-query-v1-dependency-boundaries.md)和[增量 build 设计](./semantic-index-incremental-build-design.md)。
- 实施依赖、服务关系、目录归属与阶段顺序以[服务边界、依赖关系与推进顺序](./semantic-query-v1-dependency-boundaries.md)为准；本篇保留 Semantic Query v1 的产品合同与数据不变量。

## 结论

Semantic Query 是 Lorelum 的目标默认检索方式：Semantic Query v1 交付后，未指定 `--mode` 的 `lore query` 使用本地 semantic Profile。当前默认 keyword query 只是已交付的过渡能力，不是最终产品方向。keyword query 保留为显式 `--mode keyword` 的零配置、离线模式。

Semantic Query v1 使用固定 default Profile：[`ibm-granite/granite-embedding-97m-multilingual-r2`](https://huggingface.co/ibm-granite/granite-embedding-97m-multilingual-r2)。它于 2026 年发布，采用 Apache-2.0 许可，规模为 97M、输出 384 维，面向多语言检索，也覆盖中英和代码。它符合“本地、够用、不要太大”的约束。

Semantic Query v1 的目标链路是：固定本地 default Profile、显式构建 index、执行 semantic query、再用 `lore get` 读取完整 Practice。当前已完成显式 index status/build/rebuild 及增量构建；semantic query、默认路由和 query 结果合同仍待下一阶段。首次模型下载、index 初建和强制 rebuild 仍由显式命令触发；多 Profile、远程 provider 和模型选择不属于 v1。

## 现状

以下内容已由代码和已接受 ADR 确认：

- `QueryService` 当前只有 keyword query；请求只有 `text` 和 `limit`，结果 `mode` 固定为 `keyword`。见 [query-service.ts](../../packages/engine/src/query/query-service.ts)、[types.ts](../../packages/engine/src/query/types.ts)。
- CLI 只暴露 `lore query <text> [--top-k]`，默认离线运行。见 [query-command.ts](../../packages/cli/src/query/query-command.ts) 和 [Query CLI 文档](../cli/query.md)。
- keyword index 是 LocalStore 之外的派生 SQLite 数据；它绑定经过验证的 Store snapshot，并使用 `effectiveRevision` 和 revision delta 保持同步。canonical Practice 和 `contentDigest` 仍然是结果的事实来源。见 [ADR 0012](../adr/0012-persistent-keyword-index.md)。
- 共享 config、固定本地模型、Backend 生命周期、embedding service、`lore index status/build/rebuild` 与增量 build/发布一致性已在当前工作树中落地；semantic query CLI、默认路由和 query 结果合同仍未实现。

因此，Semantic Query 不能把向量或缓存正文写入 LocalStore 的内容事务，也不能把 index 当作 Practice 内容或来源的事实来源。

## 本阶段目标与边界

### Required

- Semantic Query v1 改变 `lore query` 的默认检索方式为 semantic；keyword query 的现有行为、离线属性、JSON 摘要和 keyword index 保留在显式 `--mode keyword` 下。
- 没有 `--mode` 或指定 `--mode semantic` 时执行语义检索；没有配置或没有可用 index 时明确报错，不能退回 keyword query 假装成功。
- 默认 semantic query 使用固定的本地 default Profile。没有有效本地配置、没有 active index、index/Profile 不兼容，或无法证明旧向量与当前 Store 的安全关系时明确报错；index 正在追赶一个较新的 Store 时可返回明确标记为 partial 的 semantic 结果。远程 provider 不属于 v1。
- 每个 semantic index 必须同时绑定 Store snapshot 与 EmbeddingProfile。不同模型、模型 revision、输入投影、向量维度或归一化方式不得混用数据。
- 用户必须先显式执行 `lore index build`。这条命令才允许编码完整 Practice 集；普通 query 不得隐式发送内容、花费远程额度或长时间占用本地资源。
- 本阶段以正确性、可恢复性和可观察的错误为目标，不设高性能目标。

### Deferred

- Hybrid：同时融合 keyword 和 semantic 候选。
- reranking、ANN、多向量/chunk、query rewrite 和受控翻译。
- 持久任务队列、外部向量数据库，以及 Pack mutation 的可靠后台追赶；分别见 [Issue #115](https://github.com/lorelum/lorelum/issues/115) 和后续独立设计。
- Pack 更新后的自动 embedding。v1 仍由用户显式执行 `index build`，不会自动占用模型或资源；显式 build 的增量同步规则见 [semantic index 增量 build 设计](./semantic-index-incremental-build-design.md)。
- MCP 适配。长驻进程的 config 刷新、连接复用和请求隔离是单独设计问题。

## 固定 default Profile 与本地服务

v1 固定使用 Granite 97M：384 维、32K context、Apache-2.0。其模型卡记录的 MTEB Multilingual Retrieval 为 60.3、Code 为 60.4；这些分数仅说明它是合理的轻量候选，不是 Lorelum 的质量承诺。

本地推理路线已确定为由 Lorelum 后端管理的 llama.cpp + Q4_0 CPU，替代早期 TEI 验证目标。固定 384 维、CLS pooling 与 L2；native 以 2048 context 初始化，但 Lorelum 不暴露 token 上限、不按 token 数拒绝输入。接入合同与产物身份以[第二阶段计划](./local-backend-stage-2-design.md)为准，GPU 留待后续。

具体 endpoint、Apple Silicon 兼容性、实际向量维度、数值有效性和归一化必须在实施中验证。模型比较、benchmark 和新增 Profile 已移至后续 [Issue #85](https://github.com/lorelum/lorelum/issues/85)，不阻塞 v1。

## 公共行为

### Config 与 Profile

模型运行配置归共享 `~/.lorelum/config.yaml` 的 embedding 段，资源身份由固定 manifest 确定，不再采用早期 `<store-root>/config.json` 中保存模型 revision 的提案。index 与 Store 的绑定仍归 Engine；`--store-root` 仍由现有 resolver 决定，模型配置不能重定向 Store。

Lorelum 本地后端服务固定监听 `http://127.0.0.1:26186`。`26186` 表示 `26-186`：2026 年的第 186 天，即 Lorelum 仓库创建日期 2026-07-05。它只绑定 loopback，不能监听 `0.0.0.0`、`::` 或其他网络接口。Semantic Query v1 通过后端 client 使用第二阶段定义的认证 embedding 入口；端口本身不专属于 embedding，未来本地能力可以复用此后端服务。`baseUrl` 不进入 config，也不允许用户改成常用端口或远程地址。

运行配置、固定 GGUF 资源与 llama.cpp build 身份由[第二阶段计划](./local-backend-stage-2-design.md)统一定义；本篇不另设 modelRevision、provider 或 endpoint 配置。

v1 的 default Profile 不是用户可选 alias，但仍需要内部 `profileId` 作为向量空间和 index 身份。它由固定模型 `ibm-granite/granite-embedding-97m-multilingual-r2`、固定源 revision、Q4_0 GGUF 摘要、经过验收的编码实现版本、document/query 输入投影、384 维、归一化、距离度量及其版本确定性生成。固定 endpoint 不进入 `profileId`；实测维度必须为 384，否则 build 失败。index metadata 记录 `profileId` 和实测维度，禁止通过实测值改变既有身份。

`transport` 在 v1 固定为 `local`；远程 provider 不在范围内。config、`show` 和错误输出不得保存或展开密钥。没有有效 local config 时，普通 semantic query 返回 `semantic.config-invalid`。固定端口没有 Lorelum 后端服务、端口被其他进程占用或该服务的 embedding 路由不符合协议时，返回 `semantic.provider-failed`；不得扫描或随机改用其他端口。

本阶段不再沿用 `set-model-revision` / `unset-model-revision` 的旧配置提案。未来 semantic CLI 的状态输出复用已验收模型身份；写入配置、启动模型和构建 index 的职责分离，具体命令在 semantic 接入阶段对齐，不作为模型常驻阶段的附加任务。

### Index 命令

```sh
lore index status
lore index build
lore index rebuild
```

- `status` 只读取 config、Store identity 和 index metadata，返回 `missing`、`ready`、`stale` 或 `incompatible`，不调用 provider。
- `build` 在 ready 时不重复编码；index 过期时优先消费连续 Store revision delta，仅编码受影响且投影变化的 Practice。历史不可安全复用时，才读取完整、已验证的 Store snapshot 并全量构建。两条路径都在 staging SQLite 中完成验证后原子发布 active index；详细一致性规则见[增量 build 设计](./semantic-index-incremental-build-design.md)。
- `rebuild` 对固定 default Profile 新建 staging index，并在成功验证后原子替换 active index；失败时保留此前完整 active index。清理旧 index 是单独命令，不隐含在 rebuild 中。
- Pack 内容、有效 Practice 集或 Profile 编码合同变化后，`status` 必须显示 `stale`。v1 的 semantic query 不会把 stale index 伪装成完整结果：若能以连续 revision delta 排除所有受影响的旧向量，它返回 `coverage: "partial"` 的安全子集；否则明确报错。用户执行 build/rebuild 后恢复完整覆盖。

建议目录为：

```text
<store-root>/indexes/semantic/v1/<profileId>/active.sqlite
```

它和 keyword index 一样是独立的派生文件。删除该目录只会删除可重建搜索数据，不得删除 Pack、`store.sqlite` 或 config。

v1 只有固定 default Profile 对应的一个 active index。固定合同变化产生新 `profileId` 和目录，旧 index 保留直到显式清理。未来增加 Profile 时，仍不能只依据模型名或向量维度判断兼容。

### Semantic query

Semantic query 阶段拟采用以下请求合同：

```ts
type QueryMode = "semantic" | "keyword";

interface QueryRequest {
  readonly text: string;
  readonly limit?: number;
  /** Omitted means semantic after Semantic Query v1 is released. */
  readonly mode?: QueryMode;
}
```

v1 没有 `--profile`。Semantic Query v1 合入前，现有 CLI 仍只有 keyword query，本段不改变已发布行为。

```sh
lore query "如何避免组件直接请求接口"
lore query "database migration rollback" --mode keyword
```

未指定 `--mode` 或指定 `--mode semantic` 时，使用固定 local default Profile。没有有效 local config 时返回 `semantic.config-invalid`。`--mode keyword` 才跳过 semantic config，并继续返回 `mode: "keyword"`。

Semantic query 的成功 JSON 保持现有 `results` 摘要形状，并返回：

```json
{
  "mode": "semantic",
  "profileId": "sha256:...",
  "results": []
}
```

不公开 cosine score。结果仍然通过 Store snapshot 批量读取 canonical Practice，并逐一核对 `practiceId` 与 `contentDigest`；semantic index 只返回候选身份、内部 rank 和相似度。

建议新增以下错误码，具体命名在 CLI 设计 Issue 中冻结：

| 情况                               | 可见错误                                       |
| ---------------------------------- | ---------------------------------------------- |
| config 缺失、损坏或版本不支持      | `config.invalid`                               |
| semantic index 不存在或过期        | `semantic.index-not-ready`                     |
| index 与 Profile/Store 不兼容      | `semantic.index-incompatible`                  |
| 本地 provider 不可用、返回非法向量 | `semantic.provider-failed`                     |
| Store 无法获得稳定 snapshot        | 复用 `store.busy` 或 `store.recovery-required` |

所有失败保持现有单行 JSON envelope 和退出码约定。semantic query 不静默回退 keyword query。

## 数据、一致性与责任

### 模块责任

| 模块 | 责任 |
| --- | --- |
| LocalStore | 验证并提供 canonical Practice、来源、digest 和 Store snapshot；不执行 embedding。 |
| config | 解析、验证和原子写入 Store-scoped config；隐藏凭证值。 |
| 本地后端服务 | 独占 loopback `26186`，并提供 Semantic Query v1 所需的 `/v1` embedding 路由；其他本地路由不在本阶段定义。 |
| embedding provider | 按 Profile 编码 document/query，验证向量数量、维度、有限值和归一化合同。 |
| semantic index | 保存向量、Practice binding、profileId、snapshot identity 和构建状态；负责 staging、发布和清理自身文件。 |
| QueryService | 固定请求所见 snapshot，选择 keyword 或 semantic retriever，回读并验证候选后组装摘要。 |
| CLI | 解析 mode/index 命令，并把 typed error 转成既有 JSON 协议。 |

### 最小 index 数据

semantic index 需要四类数据：

- Profile metadata：`profileId`、不可变编码合同、声明维度和 index format version。包含 Practice 的 build 会在写入前验证实际向量维度；空 Store 不需要发送 probe。
- Snapshot metadata：Store root binding、generation、effectiveRevision、manifest digest 和 build 时间。
- Embedding record：输入投影 digest、Float32 vector BLOB、维度。
- Binding：`practiceId`、`contentDigest`、Embedding record 引用。

每个 Effective Practice 在 v1 只生成一个 document 向量。向量扫描在内存中执行精确 cosine；当前预期规模下这比先引入 ANN 或外部向量数据库更容易验证和恢复。向量不能跨 `profileId` 复用。

空 Store 可以构建 empty index：它记录 Profile 声明的维度，不发送空文本 probe。semantic query 在 empty index 上直接返回空结果，也不调用 provider。第一次构建包含 Practice 的 index 时，实际向量维度必须与声明值一致，否则构建失败。

### 构建与查询流程

1. `index build` 解析选定 Profile 并读取 active index。ready 时直接结束；兼容但过期的 index 读取连续 revision delta，不可安全复用时才读取完整 Store snapshot。
2. 增量路径只对最终受影响且 projection 变化的 Practice 调用 provider；新增、更新、删除和反复变化会收敛为最终 canonical 状态。未变化的向量只在 digest 可验证时复用。强制 `rebuild` 与任何全量 fallback 才编码完整语料。任何缺失、错误数量、错误维度、NaN 或 Infinity 都使本次构建失败。
3. 结果写入唯一 staging SQLite 文件。增量路径复制旧 active 后在一个 SQLite 事务中删除/写入受影响行并更新完整 metadata；完成后校验 Binding 数量、Practice ID/digest 集合、Profile metadata 和 SQLite 完整性。
4. 发布只在短暂 Store snapshot fence 内执行：核对目标 identity 仍然有效后，原子替换 active index。Store 已变化则本次不发布，原 active 保留；不会在编码期间锁 Store。
5. semantic query 先核对 active index 的 root binding、profileId 和 Store snapshot。Profile/root 不匹配或没有 active index 时返回 not-ready/incompatible；只有从 index checkpoint 到当前 Store 的连续 delta 可用时，才可排除全部受影响 ID 并查询未变化的旧向量，结果必须标为 `coverage: "partial"`。不能证明安全时不读取旧向量作为结果。
6. 匹配时，provider 编码 query，semantic index 返回候选；QueryService 从同一 snapshot 回读 canonical Practice 并核对 digest，随后组装现有摘要。

active index 损坏、metadata 缺失或 staging 发布失败时，不修改 LocalStore。查询返回明确失败；用户可通过 `index build` 或强制 `index rebuild` 恢复。并发 build 使用 index 自己的 writer lock，不持有 LocalStore mutation lock；第二个 build 在获得 lock 后重新核对 active index 是否已满足目标。

## 最小接口

以下是包内设计边界，不是对外 SDK 承诺：

```ts
interface EmbeddingProfile {
  readonly profileId: string;
  readonly providerNamespace: string;
  readonly model: string;
  readonly modelRevision: string | undefined;
  readonly dimensions: number;
  readonly documentInstruction: string | undefined;
  readonly queryInstruction: string | undefined;
  readonly documentProjectionVersion: number;
  readonly queryProjectionVersion: number;
  readonly tokenizerRevision: string;
  readonly maxInputTokens: number;
  readonly normalization: "l2";
  readonly distanceMetric: "cosine";
  readonly runtimeVariant: string | undefined;
}

interface EmbeddingProvider {
  embedDocuments(
    profile: EmbeddingProfile,
    inputs: readonly string[],
  ): Promise<readonly Float32Array[]>;
  embedQuery(profile: EmbeddingProfile, input: string): Promise<Float32Array>;
}

interface SemanticCandidate {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly rank: number;
  /** Internal only; never serialized in the CLI result. */
  readonly similarity: number;
}
```

`EmbeddingProvider` 不接触 LocalStore、CLI 或 SQLite。`SemanticIndex` 不重新解析 Pack、也不返回正文。QueryService 保留完整请求编排和 snapshot 校验责任，从而使未来添加 Hybrid 不必绕过当前一致性边界。

## 分阶段实施

当前阶段（#116）已经完成 Backend 托管的 semantic index：Engine 提供固定 `profileId` 的 status/build/rebuild、增量同步、staging 发布、过期检测和恢复；Backend 托管 operation 和已加载模型；CLI 只调用 Backend client。此阶段不改变 `lore query` 的当前 keyword 默认行为。

下一阶段才设计和实现 Backend 托管的 semantic query：Backend 在进程内托管 Engine semantic QueryService，CLI 将 semantic 路径路由到 Backend，`--mode keyword` 继续直连 Engine。只有该阶段完成并通过真实进程验收，才能称 Semantic Query v1 已交付。

Hybrid 或更进一步的性能优化，以 v1 的实际使用和测量数据为依据另行设计。

## 验收

- `--mode keyword` 保持既有 keyword query 的零配置、离线行为和结果合同；Semantic Query v1 交付后，普通 `lore query` 返回 `mode: "semantic"`。
- `config -> index build -> semantic query -> get` 在隔离 Store 上以真实进程跑通。
- 无 config、未构建 index、无可安全复用历史的 stale index、provider 超时、非法向量、index 损坏和 Store 变化都有确定的 JSON 错误；可安全排除变更 ID 的 stale index 返回 `coverage: "partial"`。
- `config` 写入与 `index status` 不连接 provider、不下载模型、不构建 index；v1 只连接 local endpoint，不提供 remote Profile。
- build/rebuild 失败时保留此前 active index；source-only Store 变化也必须将绑定完整 snapshot 的 index 标记为 stale。
- 空 Store 可以完成 build/status/query：index 不调用 provider，semantic query 返回空结果；第一份 Practice 写入后必须重新 build 并验证实际维度。
- 同一 Profile 下，重复执行 semantic query 的结果顺序和摘要确定；删除或更新的 Practice 不会从 stale index 返回。新增或更新 Practice 的向量尚未发布时，query 只能返回其余未受影响 Practice 的 partial 结果。
- 固定模型 revision、384 维、投影或归一化改变后，旧 index 不可用也不可复用。

## 设计对齐门槛

semantic query 阶段开始前，仍需在对应 Issue 或 Discussion 中确认 query 的 Backend operation/轮询合同、错误码、index 清理行为，以及 Granite 97M 的真实运行验证结果。多 Profile、远程 provider 和模型评测由后续 Issue 单独对齐。
