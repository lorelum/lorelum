## Context

动机与用户流程见 [proposal.md](./proposal.md) 和 [product.md](./product.md)。本节为已核对的现状，其余 Decisions 为拟议实现，不代表代码已经完成。

| 证据 | 对本设计的约束 |
|---|---|
| `origin/main:packages/engine/src/query/semantic/projection.ts`、`profile.ts`、`index/reader.ts` | 原实现将完整 query 与每条 Practice 的完整文本各编码一次，以余弦排序；不是 keyword。恢复时保持原字段标签、ID、字段顺序和正文配方。 |
| 当前 `semantic/projection.ts:245–281`、`query-views.ts:56–67`、`index/reader.ts:228–286` | 多视角投影、query 分句和评分混在公共 semantic 路径中；当前以 view 同时指表示类别与具体编码单元。 |
| `semantic/profile.ts:26–41` | Profile 只绑定全局配方；当前文档版本为 5，query 版本为 2，无方法选择。 |
| `semantic/query-service.ts:183–249`、`query/result.ts:16–42` | 查询 attempt、全量候选、canonical 校验、snapshot retry、K 和结果摘要已有共同所有者。 |
| `query/artifacts/semantic.ts:90–124`、`semantic-progress.ts`、`vector-cache.ts` | Store 与 ProjectContext 复用索引基础设施，完整索引、progress 和缓存都受配方影响。 |
| `query/artifacts/cache.ts:69–91`、`project-context/resolver.ts:322` | 通用语料摘要直接调用 semantic projection，连 keyword artifact 身份也受它影响。 |
| `backend/.../content-addressed-semantic-runtime.ts:130–173,612–745` | 一个 runtime 持有固定 Profile，并拥有队列、operation 和 target 当前性检查。 |
| `cli/src/query/settings.ts:41–58`、`query-command.ts:309–379` | 配置由消费者加载校验，CLI 每次构造请求；方法可以随请求选择，不必重启 daemon。 |

主 specs 的旧 Store-only 手工构建规则与已实现的 `add-project-context-packs` delta 不一致。本变更保留后者的自动构建、持久 operation、current-target progress、partial coverage 与单模型调度，不恢复旧生命周期。两者都修改 `Query mode and input validation`：本变更的版本以 `add-project-context-packs` 的 wait/coverage 条款为基础，只扩展 mode 取值，因此归档时须排在其后。`advance-task-aware-semantic-retrieval` 的多视角规则限定到显式 `multi-view-vector`，历史研究结论不当成单向量方法的证据。

## Goals / Non-Goals

**Goals:**

- 默认恢复 `single-vector`，实验方法为显式 `multi-view-vector`；文档投影、query 投影、评分及配方成组选择。
- 区分 canonical Practice、待编码投影和已编码索引记录，避免把实验算法的 views 固化为通用文档结构。
- build/query/status/progress/cache/安装同步选中同一方法，不复制 canonical、发布、模型和调度规则。
- 提供准确的向量方法扩展边界，新增同类算法不需改写索引 IO 或完整用例。

**Non-Goals:**

- 不建立万能 Document、不要求 keyword 或未来非向量方法实现向量 scorer，不引入带可选 vectors/tokens/graph 字段的通用对象。
- 不做动态插件、继承树、DI 容器、执行计划框架、远端服务、MCP、hybrid、新模型或适用性判断。
- 不为各方法新建队列、锁、缓存管理器或 Store；不承诺旧二进制与新协议混用，沿用兼容握手，不保留旧别名。

## Decisions

### 1. 模式与向量方法分开，使用组合

Backend 的 `mode: semantic | keyword` 离线/模型边界保持。CLI 的 `--mode` 接受 `semantic | keyword | single-vector | multi-view-vector`；`semantic` 按配置选择方法，两个方法 ID 是本次调用的方法选择，在请求组装时映射为 `mode: semantic` 与对应 `retrievalMethod`，不增加 Backend 或结果 mode。CLI 的方法 mode 列表直接取自 Engine catalog，新增内置方法自动获得同样的单次选择。CLI 结果 data 以 `retrievalMethod` 回报本次发送的方法，Backend 响应形状不变。`query.retrievalMethod` 的两个合法值为 `single-vector | multi-view-vector`。旧规划值不作为别名。`VectorRetrievalMethod` 只表达当前向量家族，不声称代表一切 semantic retrieval。

```text
packages/engine/src/query/
  keyword/                         # 原有离线索引和查询，不实现向量合同
  semantic/                        # 当前 semantic 的向量执行路径
    methods/
      types.ts                     # VectorRetrievalMethod、recipe 和 scorer
      catalog.ts                   # 方法 ID、默认值与唯一内置解析点
      single-vector/
        method.ts
        projection.ts
        scoring.ts
      multi-view/                  # 算法目录；公开 ID 为 multi-view-vector
        method.ts
        projection.ts
        query-views.ts
        scoring.ts
    representation.ts              # 编码输入、投影与向量结果的中立类型
    profile.ts                     # 从编码合同与方法配方生成绑定身份
    encoding.ts                    # 共享 embedding 端口与数值约束
    read.ts                        # 共享 query 编码与搜索编排
    query-service.ts               # snapshot/coverage/canonical/K
    index/                         # 共用 reader/build/incremental/DB/metadata/paths
  artifacts/                       # 既有 content-addressed/progress/vector cache
```

方法之间不互相 import，不依赖 IO/Backend/CLI；通用点积归 semantic 向量模块，不放进无所有者的 shared。barrel 只导出，catalog 负责内置分派，不维护可变注册表。

### 2. 内容、编码输入与向量记录分开建模

canonical 内容继续使用 `EffectivePractice`，不新增向量字段。原 `SemanticDocument` 实为算法派生投影，改称 `PracticeVectorProjection`；原 view 混合的概念拆为编码单元与类别。以下是拟议关键类型，省略 imports；现有 Store/embedding 类型直接引用。

```ts
interface EmbeddingInput {
  readonly inputKey: string;
  readonly channel: string;
  readonly ordinal: number;
  readonly text: string;
  readonly inputDigest: string;
}

interface PracticeVectorProjection {
  readonly practiceId: string;
  readonly contentDigest: string;
  readonly projectionDigest: string;
  readonly inputs: readonly EmbeddingInput[];
}

interface DocumentVector {
  readonly inputKey: string;
  readonly channel: string;
  readonly ordinal: number;
  readonly embedding: Float32Array;
}

interface QueryEmbeddingInput {
  readonly inputKey: string;
  readonly text: string;
  readonly weight: number;
}

interface QueryVector {
  readonly inputKey: string;
  readonly embedding: Float32Array;
  readonly weight: number;
}
```

这些类型归 `representation.ts`，不依赖 reader 或数据库。持久化 adapter 的记录包含 DocumentVector 加 practiceId/contentDigest/inputDigest；scorer 只接收计算所需的 DocumentVector，不获得连接、路径或文本。query 有权重而文档编码单元有 channel/ordinal，两者不为复用名字强行统一。

- **channel** 是表示类别：multi-view 的 `task-card`、`body`，不是每个正文块一种视角。公共层把它当不透明字符串，合法类别及组合由方法校验。
- **inputKey** 是一条 Practice 的当前投影内唯一地址，例如 `body:0002`，不是全局 ID，不承诺跨重分块永久稳定。持久化主键为 Practice ID + inputKey。
- **inputDigest** 由方法 ID、文档配方版本、inputKey/channel/ordinal 和实际文本确定，判断该编码单元能否安全复用。相同 key 的文本修改必须改变 digest；digest 不替代地址。
- **projectionDigest** 汇总完整投影配方及有序输入身份，证明某条 Practice 的预期编码集合；它与单个 inputDigest 不混用。
- **embedding** 是已产生的向量，不能放进等待编码的 EmbeddingInput，也不能成为 canonical Practice 的属性。

链路是 `EffectivePractice → PracticeVectorProjection.inputs → embedding → DocumentVector[] → index`。正文内部仍可称 BodyChunk，但 task-card 是字段合成文本，公共输入不一律称 chunk。向量索引具有自己的数据模型；keyword 保留倒排表示，未来其他家族按真实需要定义合同，不提前实现通用索引插件。

### 3. 方法和 execution 合同

```ts
type VectorRetrievalMethodId = "single-vector" | "multi-view-vector";

interface VectorMethodRecipe {
  readonly methodId: VectorRetrievalMethodId;
  readonly documentVersion: number;
  readonly queryVersion: number;
  readonly scoringVersion: number;
}

interface VectorRetrievalMethod {
  readonly recipe: VectorMethodRecipe;
  projectDocument(practice: EffectivePractice): PracticeVectorProjection;
  projectQuery(text: string): readonly QueryEmbeddingInput[];
  prepareScorer(
    queries: readonly QueryVector[],
    dimensions: number,
  ): VectorPracticeScorer;
}

interface VectorPracticeScorer {
  score(vectors: readonly DocumentVector[]): number;
}

interface VectorExecution {
  readonly method: VectorRetrievalMethod;
  readonly profile: EmbeddingProfile;
  // 实际类型包含 profile.ts 模块私有 unique-symbol brand。
}

function resolveVectorRetrievalMethod(id: VectorRetrievalMethodId): VectorRetrievalMethod;
function createVectorExecution(
  encoding: EncodingContract,
  method: VectorRetrievalMethod,
): VectorExecution;
```

方法必须成组提供文档表示、query 表示和评分，不能只注入 score 或三个互不绑定的函数。execution 工厂从同一 recipe 生成 Profile，以模块私有 brand 阻止外部字面量错配 method/profile；服务只接收 execution，不接受两个可独立选择的参数。

`prepareScorer` 每次 query 调用一次，检查查询维度/权重并捕获只读向量；`score` 每条 Practice 调用，只有局部累加器，无跨请求状态。避免每条 Practice 重复创建 scorer、验证整组 query 或为纯数字累加分配数组。方法不决定 top-k、不读 Store/SQL、不拼路径或管理模型。内部 benchmark 诊断由多视角模块单独提供，不强迫所有 scorer 返回最佳命中字段。

### 4. 两种方法保留的语义

`single-vector`：恢复原完整文档文本配方，一条 Practice 生成 channel `full`、inputKey `full:0000` 的一个编码输入；完整 query 生成一个权重 1 的 QueryEmbeddingInput，以归一化向量点积打分。保留原字段标签、ID、顺序、anti-pattern 和正文，不借重构分块或改变输入长度限制。

`multi-view-vector`：算法目录保留 multi-view，表示类别为 task-card/body；各类别可含多个编码单元。迁入 384 估算 token 预算与标题处理，query 分句不变。task-card 取最佳相似度，body 使用 `0.5 × max + 0.5 × mean`，对存在的两部分平均，再跨 query 输入加权平均；其他 channel 或没有可评分输入时为 typed failure。不加关键词、RRF、最弱 clause 惩罚或调参。

multi-view 不编码整篇 Practice 的 `full` 表示。它原本只被编码保存、从不评分，而有效 Practice 总有 task-card，所以不存在需要它兜底的情况；实测它约占首次构建一半的估算 token（见 verification）。删除后文档配方版本由 5 升到 6，旧 multi-view index 按 Profile 不兼容重建；排序不变，因为打分从未读取它。`single-vector` 唯一的 `full:0000` 输入不受影响。

两方法都在全部 eligible Practice 上打分，公共 reader 按分数/Practice ID 稳定排序，query service 完成 canonical 校验后应用 K。N 只限制内部 benchmark 报告，不截断评分集合。

### 5. 配置、协议和身份边界

```yaml
query:
  retrievalMethod: single-vector
```

CLI 的 `loadSemanticRetrievalSettings` 只消费方法项，普通 semantic query、index 和安装同步复用。query 指定 `--mode single-vector` 或 `--mode multi-view-vector` 时直接选择该方法，不调用方法配置 loader；不影响 wait/coverage 的既有读取及输入错误优先级。原 `loadQuerySettings` 继续拥有 wait/coverage，不复制方法校验。默认值和允许值来源为 Engine catalog。

协议校验只从 `@lorelum/engine/vector-methods` 取得纯 catalog 的方法允许值和默认值；package export 直接指向该模块，不经 Engine root barrel，也不引入转发层，避免客户端 DTO 加载 Store/SQLite 依赖。HTTP adapter 在完成 wire shape 校验后统一解析请求方法，以既有 `usage.invalid` 返回非法方法；keyword 不经过该解析。

- query DTO 使用 `query.retrievalMethod`；index status/build/rebuild target DTO 使用顶层 `retrievalMethod`。
- 仅准确的两个新 ID 有效，null/其他类型/旧规划值/拼写错误不容错。CLI 文件错误为 `query.config-invalid`，API 请求错误沿用 `usage.invalid`。
- CLI 每次读取并显式发送，Backend 协议入口对省略字段解析为 `single-vector`；直接 API 不读取 CLI YAML。Engine 深层没有隐藏默认方法。
- Backend 不在启动时冻结方法，不设置全局 currentMethod。已接受 operation 固定原 execution；不需要重启 daemon。
- keyword 不读取或校验向量方法项，仍离线；单次方法选择复用 `--mode single-vector | multi-view-vector`，不增加独立方法 flag、环境变量或配置写回，也不影响后续 query/index/安装同步。Pack canonical 安装后的配置/索引失败只报告 indexSync failure，不回滚安装。

通用 `indexCorpusDigest` 改为按稳定 Practice ID 顺序汇总 canonical ID/contentDigest，并版本化，解除 resolver/keyword 对向量投影的依赖。第一次摘要迁移会导致旧 content-addressed keyword/semantic cache miss，不改变内容与 keyword 排序。

Profile 身份包含编码 ID、维度、归一化/距离规则及方法 ID/documentVersion/queryVersion/scoringVersion，输入配方版本化。保留既有 EmbeddingProfile 类型作为服务绑定身份，其含义不等于仅一个模型文件。共享向量缓存仍按 Profile + inputDigest 复用，不新建缓存机制；同方法跨语料可复用，跨方法不混用。

query/scoring 变更也使 Profile 改变并保守重建；本次不同时设计编码缓存身份与评分策略身份分离，只有实际成本证据支持时再做。canonical 身份不依赖该选择，旧缓存交既有管理器回收，不做兼容读或切换即删除。

### 6. 扩展范围与共享约束

开放的是向量家族的组合边界，不是万能 Retriever。Engine 只导出必要方法/表示/execution 类型、解析工厂与既有用例；SQL codec、benchmark 和算法诊断不新增公开入口。

新增同类内置方法实现投影/query/scorer、配方及 catalog/协议枚举，不改 canonical、发布与模型队列。候选生成、远端生命周期等不同的检索需要另行设计，不伪装成 score 实现。共同约束是 canonical 身份、快照、输出合同；编码与向量存储只在当前家族共享。保留现有 Bun/Drizzle/config/embedding 能力，不添加抽象框架或依赖。

### 7. 现状与目标调用链

**已核对现状：** `cli/query-command.ts:createQueryCommand().handler` 经 settings 与 `runtime-client.ts` 接入 Backend；`backend/query/controller.ts:queryController` 调 `ContentAddressedSemanticRuntime.query → queryCurrent → queryTarget`。complete 分支由 `withContentArtifactLease` 包围 `artifacts/semantic.ts:createContentAddressedSemanticServices`，其 `queryDependencies` 绑定不可变 corpus，再进入 `createSemanticQueryService → executeSemanticQuery → searchSemanticArtifact`。目前 search 直接调用全局 `projectSemanticQuery`，reader 的 `readCandidateRows` 直接调用 `scoreSemanticPractice`；query service 读取 canonical，经 `assembleSemanticArtifactResult → assembleQueryHits` 校验摘要并取 K，finally 关闭 reader。controller/CLI 各自转换响应和错误。

**拟议目标：** 入口解析方法 ID → runtime 从 encoding contract 选方法并创建 execution → source target 捕获 execution → 共享 artifact/progress factory 注入该 execution → method 生成 QueryEmbeddingInput → 共享编码 → method 准备 scorer → reader 读 DocumentVector 并调用 scorer → 原有 canonical/attempt/K/结果流程。reader 不按 channel 分派算法。

完整 artifact 不可用时仍由 runtime 的 start/progress.queryPartial 或 pending 分支处理，不另起算法服务。输入解析、source resolver、snapshot adapter、输出、失败映射和模型接入均复用；迁移的是算法依赖与固定 Profile，新增的是方法选择和中立表示合同。

### 8. 一致的组装与调用示例

以下为拟议边界代码，省略 imports、既有 store/paths/definition 的展开和内部错误分支，不是运行记录。中立类型不依赖 SQLite row。

```ts
const multiViewMethod: VectorRetrievalMethod = {
  recipe: multiViewRecipe,
  projectDocument: practice =>
    projectMultiViewDocument(practice, multiViewRecipe),
  projectQuery: projectMultiViewQuery,
  prepareScorer: prepareMultiViewScorer,
};

interface SemanticIndexReader {
  readonly metadata: SemanticIndexMetadata;
  hasEligibleVectors(excluded: ReadonlySet<string>): boolean;
  search(
    scorer: VectorPracticeScorer,
    excluded: ReadonlySet<string>,
  ): readonly SemanticCandidate[];
  close(): void;
}

function createContentAddressedSemanticServices(
  snapshot: ContentAddressedCorpus,
  cacheRoot: string,
  execution: VectorExecution,
  embedding: EmbeddingPort,
): ContentAddressedSemanticServices;
```

multiViewRecipe 归 multi-view/method.ts；projection 显式接收 recipe，子模块不反向 import method。catalog 只导入方法及类型，不 import services 或配置。query/index dependencies 中独立 profile 参数替换为 execution，store、paths、definition 保留。reader 返回全量排序，不接收 query vectors/limit。

runtime 仍由既有 composition root 创建一次，注入编码合同和既有 query/document embedding ports；每个不可变 target 增加 `execution: VectorExecution`。同一 factory 创建 index/query 时使用同一个 execution。complete 查询组装为：

```ts
const { execution, corpus, cacheRoot } = target;
const paths = contentSemanticIndexPaths(
  cacheRoot, corpus, execution.profile.profileId,
);
return withContentArtifactLease(paths.directory, async () => {
  const services = createContentAddressedSemanticServices(
    corpus, cacheRoot, execution, this.queryEmbedding,
  );
  return services.query.query(services.root, query);
});
```

build/progress 沿用 runtime 的 document embedding port，query 使用 query port，二者编码身份一致。progress 同样接收 execution，复用投影和 query helper，不复制公式。query helper 的调用顺序是：

```ts
if (!reader.hasEligibleVectors(excludedPracticeIds)) return [];
const inputs = execution.method.projectQuery(text);
const embeddings = await embedInBatches(
  execution.profile, embedding, inputs.map(input => input.text),
);
const queries: readonly QueryVector[] = inputs.map((input, i) => ({
  inputKey: input.inputKey,
  embedding: embeddings[i]!,
  weight: input.weight,
}));
const scorer = execution.method.prepareScorer(
  queries, execution.profile.dimensions,
);
return reader.search(scorer, excludedPracticeIds);
```

embedInBatches 已保证输出数量、维度及归一化。helper 不拥有 reader 连接，外层 executeSemanticQuery 用 try/finally 管理；结构审查必须能从这些签名串起真实调用，而不是只看到目录与转发函数。

### 9. 状态、资源与失败的唯一所有者

| 规则或资源 | 所有者及作用域 | 结束/失败处理 |
|---|---|---|
| 方法 ID/默认值 | Engine catalog，无状态 | CLI/API 复用并按边界映射非法值 |
| 文档/query 投影、channel 和公式 | 各方法；方法对象无请求状态 | typed semantic failure，不返回零分掩盖不支持的表示 |
| scorer | 每次 query 一份；每次 score 局部累加器 | 不持有 IO 或跨请求可变状态 |
| 模型与编码约束 | 共享 encoding/Backend adapters | 方法不加载或卸载模型 |
| target/operation/journal/queue | 一个 Backend runtime；operation 捕获 execution | CLI 退出和等待超时不取消任务，不读取可变全局方法 |
| reader 与 SQLite 连接 | 查询 attempt/index adapter | 成功、typed failure、retry 都 finally close |
| artifact lease | 既有 withContentArtifactLease | 覆盖实际读写，异常也释放 |
| staging/writer lock/fence/发布 | 共用 index/progress | 失败不发布，沿用清理与恢复，释放锁与连接 |
| canonical/coverage/K | 共享查询用例 | 同一成功 attempt；快照变化按现有有界 retry，耗尽转 busy |
| 输出与错误转换 | 既有 controller/CLI | 不泄露内部细节、不吞成空结果或换方法 |

没有 eligible Practice 的有效查询返回空结果且不编码；非空目标尚无满足 coverage 的完整 Practice 则 pending，不能混同。content-addressed target 的 Profile 进入 slot/operation 身份，不同方法不互相 supersede，同方法同 source 的语料变化保留既有 supersession。

### 10. 替代、迁移与删除清单

以下旧名只用于指明待删除代码，不是目标 API 或兼容别名：

| 现有位置或符号 | 拟议去向与切换条件 |
|---|---|
| `semantic/projection.ts:SemanticDocument/SemanticProjectionView/projectSemanticPractice` | 中立类型改为 representation.ts 的 PracticeVectorProjection/EmbeddingInput；算法到 multi-view/projection.ts 的 projectMultiViewDocument，删旧全局投影文件/入口 |
| `semantic/query-views.ts:projectSemanticQuery` | 移到 multi-view/query-views.ts，入口 projectMultiViewQuery；QueryEmbeddingInput 不再携带 view 名称，删顶层旧文件 |
| `index/reader.ts:scoreSemanticPractice`、body mix、kind 筛选与专属排序 | 迁入 multi-view/scoring.ts；公共点积归向量模块，reader 只读 DocumentVector 和稳定排序 |
| `index/database.ts:SemanticIndexVector` 与 `index/reader.ts:SemanticQueryVector` | 持久化行映射为中立 DocumentVector 加行摘要，query 类型迁为 QueryVector；算法不依赖数据库类型，旧规划的 SemanticVectorView 等中间类型不作为新入口保留 |
| 全局投影版本、固定 Profile 组装 | 各方法 recipe + createVectorExecution；迁移全部 callers，不保留隐式多视角默认 |
| `cache.ts` 全局 semantic projection 依赖 | 方法无关 corpus digest；resolver/keyword 不依赖向量表示 |
| runtime 固定 profile 参数/字段 | encoding contract + target.execution.profile；无 currentMethod、无每方法 runtime |
| services/artifacts/progress 独立 profile 参数 | 接收 VectorExecution，生产、benchmark、测试和 barrels 一起切换 |
| 持久化 `view_id/view_kind/view_ordinal/projection_digest` 行字段 | 迁为 input_key/channel/ordinal/input_digest，TS 字段为 inputKey/channel/ordinal/inputDigest；vector BLOB 列可保留物理名称 vector，由 adapter 解码为 embedding |
| 算法专项测试与旧导出 | 随方法迁移，保留行为覆盖；共享测试显式覆盖两方法，删转发别名和只验证源码/偶然 wording 的断言 |

导出变更前 LSP references 查全部调用者。方法限定接口与输入/输出分层不是可静默改变的私有细节；方法目录、recipe 归属、无兼容 shim 的切换要求必须完成。数据库字段改名只针对派生 schema，按版本迁移与重建，不改 Pack schema 或 canonical 数据。旧规划的 simple/multi-view 不接受为方法 ID，算法内部 multi-view 目录名不受影响。

### 11. 两次维护演练

**调整 multi-view 正文分块：** 改 multi-view/projection.ts 和行为测试，提升 multiViewRecipe.documentVersion；inputDigest、projectionDigest 与 Profile 自动分离，由已有构建器生成新表示。无需改 reader、query-service、single-vector 或队列。只改评分则改 scoring 和 scoringVersion；当前保守 Profile 策略仍导致重建，不暗中引入跨 Profile 缓存。

**构建中切回 single-vector，随后 CLI 退出：** 新请求创建自己的 target，旧多视角任务继续持有原 execution，共享一个调度器。旧构建失败由 index/progress 保持原 active，journal 记录原目标失败，单向量索引不受影响；只有同方法同 source 的内容变化使用既有 supersession，不增加方法专属取消规则。

演练检查算法变化是否泄漏到 IO、共享生命周期是否错误地共享可变方法选择，不以“只改一个文件”为目标。

### 12. Index 是 query 的前置合同

不开放独立 indexMethod。选择方法同时选择文档表示、Profile 和能解释 DocumentVector 的 query/scorer。公共 adapter 管理 schema/BLOB/metadata，方法管理 channel 及预期编码集合；不能用 single-vector 索引执行 multi-view-vector 查询。

**持久化合同：** 主键为 `(practice_id, input_key)`，行持有 channel、ordinal、content_digest、input_digest 和 vector BLOB。Profile 绑定文件 metadata，不逐行重复 method ID；方法/query/scoring 版本已进入 Profile hash，无需复制为每项 metadata 列。document 的 projectionDigest 与行的 inputDigest 职责不同，不能对全体 projection_digest 字段不分归属地批量改名。

schema/index 版本与方法版本分开：字段迁移和解除封闭 channel 枚举按 Drizzle/versioned migration；改分块只提升 recipe。公共 codec 不硬编码 full/task-card/body；方法校验自身类别与组合，公共层验证 key/ordinal/编码及内容身份。旧 schema/Profile 不做兼容读取，走安全重建。

派生 schema 的本次版本为 4。迁移以 `main` 已有的单向量 schema 为基线：保留三类 semantic index 的 `0000` SQL、snapshot 和 journal 身份，本 PR 新增迁移直接到达最终中立结构，不保留 #272 分支内部的 `view_*` 过渡格式或其向量搬运兼容。旧索引按 schema/Profile 不兼容处理，后续从 canonical 内容重建；canonical 数据不迁移或删除。共享向量缓存从 `main` 已有的 `projection_digest` 到 `input_digest` 的迁移是独立的真实变更，保留该必要迁移。迁移由既有 `bun run db:generate` 生成，重建表的 CHECK 在 schema 中使用不带表限定的列引用；生成器不扫描、改写历史 SQL，不持有本次字段改名映射，也不增加运行时兼容读取。

**三个派生层：** complete active artifact 证明精确 corpus/Profile 的完整覆盖；progress 记录该精确 target 已完成的 Practice，支持安全 partial；向量缓存只复用 Profile + inputDigest 对应的编码结果，不证明覆盖，也不让 status 直接变 ready。paths/锁/lease 使用已有实现，各方法 target 隔离，缓存管理实现共享。

现有构建入口为 `index/service.ts:fullBuild/incrementalBuild/publish` 和 `artifacts/semantic-progress.ts:documents/vectorsForBatch/build/queryPartial`。Store-local 保留 revision delta/snapshot fence，内容寻址路径保留不可变 corpus/predecessor/progress/target 当前性检查，不用空接口掩盖来源差异。

multi-view-vector 构建流程：

1. runtime 固定当前 winners、corpus 与 execution；query 自动构建、显式 build/rebuild、安装 sync 同规则，status 只观察。
2. 普通 build 对精确 ready artifact 不编码，否则提交或加入 operation，用既有 writer lock/lease；rebuild 按既有强制替换规则，不因普通 ready 直接结束。
3. 调 method.projectDocument 得到完整 PracticeVectorProjection。预期 inputs 来自当前配方，不从数据库现存行数猜测。
4. 从同 Profile predecessor/cache 按 inputDigest 复用，缺失/变化输入才编码；contentDigest 改变不意味着全部文本向量重算。
5. 一条 Practice 的必要 inputs 全部获得向量后，在同一事务中对齐完整行集、内容身份与完成计数；新增/删除输入同时处理，不暴露半套正文。缓存已写而目标事务失败不算完成。
6. 批次提交后更新 completed Practice 数，非向量行数；partial query 只使用当前 target 已提交完整 Practice，不能借另一方法向量补齐。
7. 全部完成后校验目标/Profile/结构/完整性，关闭连接，按已有 fence/current-target 规则原子发布；替换失败保留旧 active。
8. 各出口释放连接、锁和 lease；operation/journal 固定原目标，CLI 等待耗尽不取消任务。

零 Practice 的已确认目标可以形成完整空 index；非空目标没有完成 Practice 时 indexing。正文编辑后重新投影，按实际输入摘要复用，不能保证只重编码一块，因为分块与编号可能传播；删段落/Practice 清除旧输入；不影响投影的 metadata 更新只刷新内容身份，不重编码相同输入。切方法创建新 Profile/target，不原地补改另一方法索引；切回时仅复用尚保留且匹配当前语料的 artifact。

query 打开 reader 要证明 schema/Profile/语料身份，partial 还需证明完整输入集合；用同 execution 生成 QueryVector 并打分，最后由 canonical snapshot 组装摘要。index 与 query 依赖同一中立向量合同而不反向 import 用例。既有输入摘要里包含地址/配方的保守复用条件保持，不把 inputKey 当全局缓存键。

## Risks / Trade-offs

- 默认与方法 ID 变化、缓存重建：明确使用新 ID；旧派生不兼容时自动构建，不要求删文件或重装 Pack，不声称排名改善。
- 单向量长文本仍受旧模型输入限制：保持原算法，不悄悄加入分块。
- runtime 固定 Profile 引用多：全部迁到 target；同 daemon 交替请求与排队任务覆盖，不复制调度器。
- corpus digest 迁移影响现有 content artifacts：版本化一次切换，keyword 排序/winner 不变，不保留旧缓存别名。
- channel 为不透明值：SQL 减少算法语义约束，但方法拒绝非法类别/不完整组合，公共层保留结构与编码检查。
- inputKey 非永久地址：重分块可能扩大重新编码范围，不承诺移动不失效；Profile 包含评分版本也带来保守重建成本。
- 接口只覆盖当前向量家族：非向量实现独立表示，不预建万能模型或动态插件。

## Migration Plan

1. 建立 representation 与 VectorRetrievalMethod 合同、两方法和 execution；迁移生产、tests、benchmark 的算法依赖，保持公式与原单向量配方。
2. 接入新方法 ID、配置/协议和 target Profile，统一 query/index/安装 sync；删旧全局算法、参数与默认入口。
3. 版本化派生字段/schema、corpus/Profile/input digest，原子重建，保留 canonical 数据和旧文件直到既有缓存管理回收。回退二进制不回写新派生格式，按旧版规则重建。
4. 将既有多视角 active change 的默认规则限定为 multi-view-vector，保留历史实验与 #236 未满足验收；不借此恢复主 specs 的旧生命周期。
5. 行为与结构验收后更新中英 query/config/index 指南及维护者边界；规划阶段不将未实现能力写入公共站点。

## Verification

以下是实施验收，不是已通过记录。行为与结构两条分别记录：

- 行为：旧单向量完整 query/文档排序、标点不分句、多视角分句与聚合、同分顺序和全量后取 K；不以固定 Profile hash、源码或字段复制断言证明正确。
- 配置：新 ID 的默认/显式/非法类型与旧值拒绝、keyword 忽略；同 daemon 修改后下次 CLI 生效，直接 API 缺省 single-vector。
- 输入身份：同 key 文本改变必须失效；不同 Practice 同名 key 不碰撞；表示类别与正文块顺序不混淆；相同投影的 metadata 更新不重编码。
- 索引：真实 SQLite migration、完整/partial build 后查询、旧不兼容失效、缺输入不计完成、跨方法隔离、同方法复用、局部输入更新/删除、失败保留 active、旧 operation ID 稳定。
- 真实路径：完整 release CLI + test-owned Store/配置/缓存，用同 canonical 语料分别实际建立两方法索引再 query，切回默认、编辑增量、status/build/rebuild 与离线 keyword；记录真实模型/Profile/语料和未覆盖范围，不把预填人工向量当端到端验收。
- 检查：focused tests 后聚合一次受影响包测试/typecheck/lint；已有效验证不重复，不重跑用户已报无关失败确认其存在。

结构审查由集成负责人沿 §7–12 的真实源码/类型/调用关系完成，不用类名、文件数、源码字符串或转发次数测试替代：

- Practice 无索引向量属性；投影、编码输入、向量记录分离，无万能可选字段 Document；向量合同未泄漏到 keyword/非向量家族。
- 两方法无相互依赖或 IO/Backend/CLI 依赖，channel/公式只在方法，reader 只读取/排序。
- 默认与方法允许值单一来源，入口显式组装 execution，无隐藏默认；scorer 每 query 一份，Profile 与方法不可错配。
- build/query/progress 用同一 execution；连接/lease/锁异常释放，operation 固定 target，不因 CLI 退出新增取消。
- §10 旧入口/字段/参数/别名及固定 Profile 状态全部切换；公开 barrel 不重新导出旧名。历史 source 路径和算法内部 multi-view 名称不当作遗留方法 ID。

实施交接以本设计为代码决定、delta specs 为行为边界、tasks 为迁移与验证顺序。改变身份、组装、规则归属或表示合同前先同步设计和验收；不需要为私有 helper 命名回写。不得只通过文档校验就宣称运行时或架构实现完成。
