## Context

See [proposal.md](./proposal.md) for product motivation and the delta specs for observable behavior.

| Observed fact | Current evidence | Consequence for this change |
| --- | --- | --- |
| 用户配置只从 `~/.lorelum/config.yaml` 读取，CLI 只有 `--store-root` | `packages/config/src/document/load.ts`、`packages/cli/src/registry.ts` | 项目 layer config、`lore init` 和 `--project-root` 需要明确入口，不能偷偷改写用户级 config。 |
| LocalStore 的 reconciliation 对不同内容的同 ID Practice 抛 `PracticeConflictError` | `packages/engine/src/local-store/model/effective-practices.ts` 与 tests | ProjectContext 必须有独立 resolver；它按 precedence 选择 winner，但不放宽已安装 Store Pack 的 canonical contract。 |
| canonical Practice 与 semantic projection 已分别有 SHA-256 digest | `packages/engine/src/local-store/model/canonical-practice.ts`、`packages/engine/src/query/semantic/projection.ts` | 内容、向量和完整 artifact 必须使用对应 digest，不能 hash 原始文件路径、Git 元数据或 mtime。 |
| keyword/semantic index 用 staging + atomic publication；semantic ranking 是同一 Profile 下的 exact cosine scan | `packages/engine/src/query/keyword/persistent-keyword-index.ts`、`packages/engine/src/query/semantic/index/service.ts`、`reader.ts` | progress 可以按批次安全参与同一个 semantic vector space，但 complete artifact 仍需原子发布。 |
| 当前 semantic spec 规定单 operation 与 `backend.busy` | `openspec/specs/semantic-index/spec.md` | 队列、current progress 和 reattach recovery 是 Store 与 ProjectContext 共用的能力，不应复制两套 scheduler。 |

## Goals / Non-Goals

**Goals:**

- 让任意目录通过 `.lorelum/` 形成 ProjectContext；父子 layer 默认继承，child 增量覆盖 config 与 Practice。
- 让 query/get/index 共享同一 active winner/provenance snapshot；单条 Practice 失败不隐藏同 Pack 邻居或有效 fallback。
- 让相同最终语料在任何目录间按内容复用 artifact/vector；同一目录高频编辑只追踪最新 target。
- 让 Store-only 与 ProjectContext semantic query 在相同整数毫秒预算下利用 current progress 返回可信 partial coverage。
- 保持 LocalStore、项目 Pack 文件和 provenance 为事实来源；所有 index/cache 都可删除重建。

**Non-Goals:**

- 不要求、探测或以 Git repository/worktree/submodule/branch/commit 参与 context discovery、precedence、cache identity 或复用。
- 不改变 Registry Pack install/update、已安装 Store 的冲突语义、Pack format、固定 embedding Profile 或模型/provider 配置。
- 不提供仓库级 endpoint、provider、model、远程 Pack 下载、glob/include、文件 watcher、local MCP 或 Codex Hook 注入。
- 不把 batch size、embedding 并发、自动 LRU 容量或 queue fairness weight 暴露为项目配置；先收集运行证据再单独设计。

## Decisions

### 1. `ProjectContext` 是目录 layer stack，不是 Git 对象

一个 layer 是直接包含 `.lorelum/` 的目录。自动发现从当前目录向上找到最近 layer 为 leaf，再收集允许继承的 ancestor layers；显式 `--project-root` 选择直接包含 `.lorelum/` 的 leaf directory。解析顺序永远是 parent 到 child。

概念快照为：

```ts
interface ProjectContextSnapshot {
  readonly projectRootId: string;
  readonly layers: readonly ProjectLayer[]; // parent -> leaf; paths only live in memory
  readonly effectiveConfig: EffectiveProjectConfig;
  readonly activePractices: readonly ContextPractice[];
  readonly sources: readonly ContextSourceStatus[];
  readonly contextDigest: string;
  readonly indexCorpusDigest: string;
  readonly state: "ready" | "degraded";
  readonly warnings: readonly ContextWarning[];
}
```

`config.yaml` 按父到子 fold：缺失字段继承；`base` 由最近显式值覆盖；`packs.<name>.enabled` 与 `packs.<name>.priority` 按字段 merge；`inherit: false` 截断 parent stack。叶子 config 缺失不等价于重置，它只表示继续继承。

所有有效 Pack source 共同参与 resolver。source rank 是 effective explicit priority、layer depth、稳定 Pack/source directory；Store 只在 effective `base: user` 时作为最低层。最终 winner 的单位是 Practice ID：child 同名 Pack 只覆盖同 ID Practice，父层/Store 未冲突 Practice 保留。这使项目目录能写小而安全的 overlay，而无需复制整包。

Pack metadata/root 无法验证时跳过整个 Pack；单条 Practice 无法验证时只跳过这条。被跳过的 source 不占 precedence，低优先级有效 Practice 可以成为 winner。普通命令返回 `degraded`，`lore validate` 是严格诊断入口。

**Alternatives considered:**

- 最近 `.lorelum` 整体遮蔽 parent：不能表达常见的子项目增量配置，拒绝。
- Git root/worktree 作为 layer 边界：普通目录无故失去功能，且 cache correctness 实际由内容决定，拒绝。
- 子同名 Pack 整体替代 parent Pack：强迫用户复制未变 Practice，且放大半写 Pack 的影响，拒绝。

### 2. 目录身份只用于 coalescing；artifact 完全按内容寻址

```text
projectRootId       = SHA-256(realpath(leaf directory))
contentDigest       = SHA-256(canonical Practice JSON)
projectionDigest    = SHA-256(deterministic semantic projection text)
contextDigest       = SHA-256(resolver version + layer config + source states + provenance)
indexCorpusDigest   = SHA-256(index format + ordered active (practiceId, contentDigest, projectionDigest))
keywordArtifactId   = SHA-256(keyword format + indexCorpusDigest)
semanticArtifactId  = SHA-256(semantic format + profileId + indexCorpusDigest)
projectSlotId       = SHA-256(projectRootId + profileId)
```

`projectRootId` 与 `projectSlotId` 只用于让同一目录连续 `C1 → C2 → C3` 编辑合并成最新 target。它们不得进入 artifact ID。任何目录——包括普通目录和多个 Git worktree——只要最终 active Practice 语料相同，就命中同一 artifact；Git、source path、Store root path、branch、commit、mtime、文件大小和 provenance 只用于解释/快速失效，不是 correctness key。

若 canonical 内容变化而 semantic projection 不变，例如未进入 projection 的 metadata 改动，新的 artifact 仍需发布以绑定 current canonical snapshot，但 vector 可以复用。不同 Practice ID 即使正文相同仍保留为两个可返回结果；artifact 行主键保持 Practice ID。

### 3. 用户级 cache 分离 shared vector、project artifact 与 progress

```text
<user cache root>/
  semantic/v1/
    vector-cache.sqlite
  project-context/v1/
    project-cache.sqlite
    artifacts/
      keyword/<keywordArtifactId>/active.sqlite
      semantic/<semanticArtifactId>/
        progress.sqlite
        active.sqlite
```

新增 database definitions：

| Database kind | Drizzle tables | 专属 SQLite 内容 |
| --- | --- | --- |
| `semantic-vector-cache` | `embedding_vectors` | 已校验 Float32 BLOB。 |
| `project-cache` | `project_context_artifacts`、`project_context_artifact_indexes` | artifact catalog，绝不存 source path 或正文。 |
| `project-keyword-index` | `project_keyword_index_metadata` | `keyword_documents` FTS5、`MATCH`、`bm25`。 |
| `project-semantic-index` | `project_semantic_index_metadata`、`semantic_vectors` | complete artifact 的 vector codec、integrity。 |
| `semantic-progress-index` | `semantic_progress_metadata`、`semantic_vectors` | 一个 target 的 manifest、expected/ready counts 与批次事务。 |

`embedding_vectors` 的 key 是 `(profileId, projectionDigest)`，包含 encoding/dimensions/normalization/vector/timestamps。`project_context_artifacts` 以 `artifactId` 为 key，记录 index kind、Profile（semantic）、corpus digest、document count、created/last-accessed；`project_context_artifact_indexes` 记录相对 artifact path、byte size、published/verified time。catalog、vector cache 与 progress 均不保存 canonical Practice body、absolute directory path 或 full provenance。

普通 metadata/CRUD/vector row 使用 Drizzle transaction；仅 FTS5 DDL/search、`MATCH`/`bm25` 与 PRAGMA/integrity 使用参数化 native SQL。

### 4. progress 是 current target 的可查询快照；ready 仍原子发布

keyword index 继续对完整 current ProjectContext snapshot 同步建立/查询。semantic target 缺少 exact complete artifact 时创建或恢复 `progress.sqlite`，其 metadata 包含 exact target digest、Profile、expected count、ready count 与状态。

先从 compatible complete artifact 与 shared vector cache 种入 `(profileId, projectionDigest)` 匹配的 rows；只为 miss 请求 embedding。每批返回后，先写入 shared vector cache，再在同一 progress SQLite transaction 中写 target vector rows 和 ready count。这样崩溃最多遗留可复用 vector，绝不出现 metadata 声称 ready 而 query 读不到 row 的状态。

semantic query 只读取与 current `semanticArtifactId` 完全匹配的 progress SQLite，并在一个 read transaction 中扫描当前验证通过的 rows。若 layer/source 在结果组装前改变，重新解析 current ProjectContext；不匹配的 progress row 立即排除。全部完成后再校验 manifest、row count、vector contract 和 integrity，原子提升为 `active.sqlite`；未完成 progress 永不标记 ready。

### 5. queue 以 project slot 合并，重启后等待 source reattach

Backend 的持久 queue 记录 opaque target/artifact/slot identity、Profile、expected/ready counts、state、attempt/retry 与安全错误码。相同 `semanticArtifactId` 加入同一 operation；不同 artifact 排队；相同 `projectSlotId` 的新 target 覆盖旧 desired corpus。CLI 中断不取消已接受 operation。

queue 不持久化 project absolute path 或 Practice body，因此 daemon 重启后无法也不得扫描任意目录来恢复 ProjectContext source。它保留 progress/vector/operation，将未完成 project target 标记为 `waiting-for-source`；下次从同一 `projectRootId` 执行 query/build/rebuild 时，由当前解析出的 source reattach 并继续。这保留已经完成的批次，同时不留下目录 locator。

`query.maxWaitMs` 和 `query.minCoveragePercent` 属于用户级 config。查询在总毫秒预算内观察 Backend、模型与 progress：complete 则返回 complete；达到 coverage policy 则返回带 indexed/total/operation 的 exit-0 partial；没有可接受 rows 时返回 exit-1 `indexing`；模型未就绪时返回 exit-1 `preparing`。超时不取消 queue。

## Risks / Trade-offs

- [父级 `.lorelum` 意外影响子项目] → child 默认可继承，但 `inherit: false` 可一键隔离；`context status` 显示完整 layer 顺序和 effective config 摘要。
- [一个局部 Practice 半写导致知识整体消失] → Pack/root 与单条 Practice 分级跳过，保留有效邻居和 lower-priority fallback，并以 degraded/validate 解释。
- [不同目录误复用 artifact] → artifact ID 包含有序 active Practice ID/content/projection、index format 与 Profile；query 最终重验 current snapshot。
- [partial result 被误作完整答案] → success partial 强制输出 coverage、indexed/total counts 与 operation；`--require-complete` 拒绝它。
- [daemon restart 后不能自动找到项目目录] → 不持久化路径；保留 progress 并 `waiting-for-source`，由下一次同项目 command 安全 reattach。
- [cache/catalog 与 filesystem 没有跨文件事务] → vector cache 先提交、progress batch transaction 后提交；complete artifact 原子提升；catalog 只作提示且可恢复。

## Migration Plan

1. 实现 ProjectContext directory discovery、parent-to-child config fold、Practice-granular precedence、`lore init`/`context status` 与 `--no-project`；普通无 Git 目录和无 marker 的 Store-only 行为都加入测试。
2. 新增 shared vector/project artifact/progress persistence、migration/config/generator/release asset；实现内容寻址、keyword artifact 与 prune/recovery。
3. 将 Backend operation 改为 Store/ProjectContext 共用 persistent target queue，接入 progress batch publication、partial query、project slot coalescing 与 `waiting-for-source` reattach。
4. 同步 CLI/configuration/API/site/development docs、`lore describe` 与 JSON schemas；运行 directory hierarchy、普通目录、相同语料复用、partial coverage、restart reattach 和 prune 的端到端验证。review 后才同步 delta/归档。

## Open Questions

- 自动 LRU 容量、artifact/vector 实测大小和 queue fairness 权重暂不固定；先记录 hit/miss、大小、queue wait、reattach 次数和完整命令延迟，再通过单独 change 决定默认预算。
