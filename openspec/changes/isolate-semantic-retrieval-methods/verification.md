# 实施与验收记录

> 下文保留方法隔离、临时 mode 和验收脚本整理各阶段的实际结果，阶段之间的计数不合并冒充一次整包通过。迁移基线及最终迁移验证以页末“以 main 为基线清理过渡迁移”为准；早期对 #272 中间 schema 的搬运覆盖不属于发布版本兼容承诺。

## 验证边界

- 日期：2026-10-17；平台：macOS arm64；Bun 1.4.2。本记录对应当前 worktree 的未提交实现，不代表发布版本或外部 benchmark 结果。
- 真正编码使用仓库固定的 `granite-q4_0.gguf`，SHA-256 为 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`，384 维；模型从已有本地文件只读加载。未改动用户模型、canonical Store 或配置。
- 方法公开值为 `single-vector`、`multi-view-vector`；前者默认，后者实验性。未引入旧值别名、额外方法 flag、环境变量、第二套 runtime 或模型队列。

## 行为验证

| 范围 | 执行与结果 |
|---|---|
| 方法、编码及 Profile | `bun test packages/engine/src/query/semantic/methods packages/engine/src/query/semantic/profile.test.ts packages/engine/src/query/semantic/encoding.test.ts`：30 pass。覆盖原单向量完整配方、不分句、数值排序、多视角公式/预算、输入摘要与方法版本隔离。 |
| Backend、benchmark、共享 query service | `bun test packages/backend/src/modules/query packages/backend/src/modules/index/controller.test.ts packages/backend/src/client packages/backend/src/benchmark packages/engine/src/query/semantic/query-service.test.ts`：86 pass。覆盖缺省/显式方法、非法值、keyword 绕过、共享队列与 operation 身份、全量评分后报告 N/K、canonical 快照重试及关闭连接。 |
| 早期 reader/迁移验证（迁移覆盖已替换） | `ReaderMigrationCoverage` 负责人当轮运行 reader/migrator 两文件：29 pass、73 assertions。该轮使用包含 #272 中间 schema 的前缀，验证旧行搬运与 pre-0003 旧列拒绝；这部分覆盖由页末基于 main 单向量格式的回归替换，不作为最终兼容范围。 |
| index、complete/progress/cache | `ArtifactCoverage` 负责人运行指定片区 43 用例：首次 41 pass、2 fail；修正新增 fixture/预期后仅重跑失败两例，2 pass。覆盖两方法隔离、相同 key 的文本变化/跨 Practice 内容不串用、缺必要输入不计完成、删除和 metadata-only 不编码、失败保留 active、清空共享缓存后仍复用已验证 predecessor。没有为制造全绿而重复整片检查。 |
| 最终方法校验边界 | 将方法 type guard 改为直接遍历 catalog 的唯一允许值列表后，运行 catalog、query/index controller、client 四文件：41 pass；方法值和默认行为未改变。 |

首次聚合命令为：

```sh
bun test packages/engine packages/backend packages/cli --test-name-pattern '^(?!.*(?:concurrent stale reclaimers elect one remover and preserve the next holder|unsafe existing targets are rejected during preflight)).*$'
```

该次结果为 962 pass、63 fail（共发现 1032 用例）。按要求排除了已报告的两个无关失败，没有重跑确认它们。新增失败主要来自历史 SQLite CHECK 迁移回放、未迁移的 reader 测试与方法错误映射；这些范围分别由上表的最终有效验证覆盖。没有再次运行整包并宣称一个未观察到的“最终整包全绿”计数。CLI 配置、安装同步及路由测试在该聚合执行中通过；之后 CLI 代码未再改动，只修正了原生验收脚本的 operation 命令参数。

## 真实运行路径

### 原生 ProjectContext

```sh
bun packages/cli/integration/project-context-native-smoke.integration.ts <model.gguf>
```

最终结果 `status: passed`：

- 普通目录中的 48 条 Practice，另有一个无效 Practice；测试模型缓存最初为空，通过测试拥有的本地下载服务完成下载及中断续传。
- 实际 HTTP Backend 使用临时 loopback 端口；实际 native 模型编码，观察 pending、partial、complete，不用预填向量代替验收。
- 首次编码 48 条 Practice；编辑后增量仅编码变更的 1 条。
- 同一 runtime 内默认单向量、显式多视角、切回单向量；各自 build/rebuild/query/status 正确。切换后查询已接受的多视角 operation，仍返回其原 Profile。
- 非法方法使 semantic 请求失败，keyword 仍可用。无效项目内容、等价目录、局部覆盖、partial、缓存和增量原覆盖保留。
- 初次运行发现验收脚本误给 `index operation` 带上 `--project-root`，按既有 CLI 合同修正后通过；没有放宽命令校验。

### 完整 release CLI

```sh
bun run build:cli
```

完整产物位于 `dist/release/darwin-arm64/`，CLI 与匹配 native runtime 同目录树。临时验收驱动使用该编译 CLI、真实 GGUF、隔离 HOME/Store/cache 和 3 条 test-owned Practice，最终 `status: passed`：

- 正常本地 Pack 安装及安装后索引同步；默认单向量 query 返回 complete canonical summaries。
- 显式多视角使用不同 Profile；同一 daemon 的 instance 在方法切换前后相同；切回单向量复用匹配 artifact，返回相同摘要与顺序。
- Pack update 后两方法均返回更新后的 canonical 标题；build/no-op、status、rebuild 后查询可用。
- `multi-view` 旧规划名称返回 `query.config-invalid`。停止测试 Backend 后，keyword 仍离线可用。
- 额外编译 CLI 检查在 `single-vector`、`multi-view-vector`、非法方法配置间仅运行 keyword：结果相同，keyword artifact 路径及 SQLite mtime 均不变，确认没有重建。

测试需要固定 CLI 端口，先用已安装 CLI 核验开发 daemon，再通过 `backend stop --if-idle` 安全停止。验收后通过同一已安装 CLI 恢复，返回 ready、原 build identity；模型处于正常惰性加载的 unloaded 状态。未强停活动任务。临时 Store、HOME、缓存、脚本已清理。

## 迁移修正及实现决策

- 初次实现保留了 #272 新增的 `0001/0002` 及其后续搬运迁移，曾为这些 SQL 增加临时表 CHECK 和源列名修补，并成功运行 `bun run db:generate`。这些是相对工作分支的前序迁移，不是 main 已有的迁移历史；对应生成器修补和中间迁移已在页末基线整理中删除。
- 旧版本 metadata 在读取版本特定向量列前被识别；reader 返回 incompatible，重建仍由既有路径处理。
- 客户端协议只需纯 catalog，因此 `@lorelum/engine/vector-methods` 直接指向现有 catalog，而不是导入 Engine root 的 SQL/Store 图或新增转发 shim。依赖边界构建测试通过。
- 方法是业务输入：wire shape 校验后统一解析方法并返回既有 `usage.invalid`，不为此改变其它 schema 错误的 `backend.invalid-request`；keyword 不进入方法解析。

## 结构审查与维护演练

集成负责人沿实际调用与类型检查完成以下审查；并非用源码字符串测试代替：

1. `representation.ts` 将 `PracticeVectorProjection`、`EmbeddingInput`、`DocumentVector`、query 输入与向量分开；canonical `EffectivePractice` 未加入索引字段。`projection-identity.ts` 分开计算完整 projectionDigest 与单输入 inputDigest。
2. 两算法只依赖 canonical 类型、表示/摘要及向量数学；单向量与多视角不相互 import，不持有 Store、SQL、Backend、CLI 或 IO。类别校验及公式留在方法，reader 只解码、分组、调用 scorer、校验有限数和稳定排序。
3. `createVectorExecution` 用私有品牌及冻结对象绑定方法与 Profile。`searchSemanticArtifact` 每个 query 只生成一个 scorer；`executeSemanticQuery` 保留 canonical/snapshot 一致性和最终 K，finally 关闭 reader。
4. index service、complete artifact factory、progress constructor 均接收同一 execution。Store-local delta/fence 与内容寻址 predecessor 保持各自来源语义；progress 对照当前方法完整 inputs 核算 Practice coverage，发布和锁/lease 释放仍由共享层拥有。
5. Backend 的 `targetSlotId` 包含 Profile，target 固定 execution；只有一个 `queue` 和模型生命周期。不同方法不互相 supersede；同方法同 source 仍采用既有 joining/supersession。operation/journal 不随 CLI 后续选择改绑。
6. `indexCorpusDigest` 仅依赖稳定排序后的 canonical ID/contentDigest；keyword 没有向量方法接口。旧顶层 projection/query-views、旧 Profile 工厂和 reader 算法入口已删除；barrel 没有旧名转发别名。LSP references 已尝试但环境无 language server，以调用搜索、类型检查及实际调用补足迁移检查。

维护演练：

- **改变多视角正文分块**：改 `methods/multi-view/projection.ts` 及其行为测试，提升 `multiViewRecipe.documentVersion`；输入摘要、整体摘要及 Profile 随配方变化，现有构建器负责重建。reader、query service、single-vector 和队列不需要知道新分块规则。仅改评分则提升 scoringVersion；保守 Profile 隔离继续适用。
- **多视角构建中切回单向量并退出 CLI**：新请求取得独立 target，已接受任务保留原 execution，仍通过一个队列调度。Backend 并发行为覆盖和真实 native operation 查询证明原身份保留；失败保留 active 的两方法回归证明不会破坏另一方法。CLI 的等待结束不向 daemon 增加方法专属取消。

## 工程检查与限制

- `bun run typecheck`：最终通过。
- `bun run lint`：退出 0；25 条 `no-await-in-loop` warning，包含串行状态/重试/fixture 场景及未改动文件，未把 warning 隐瞒成无诊断。
- 本次 82 个 TypeScript/JSON 变更文件 `oxfmt --check` 通过；未重跑已报告会扫描全部既有文件失败的全仓格式命令。
- 中英用户指南 4 组、维护合同与 benchmark 输入说明已同步；`bun run --filter @lorelum/site build` 通过并完成中英文文档 prerender。
- 对 29 份相关文档检查 113 处相对链接，站点的无扩展名链接按 MDX 路由解析；本次新增链接可解析。旧多视角 change 的历史记录仍有 7 处链接指向本 worktree 不含的既有研究文件，按保留历史证据边界未重写，也没有将这些材料作为本次验收证据。
- 两个相关 OpenSpec change 的 strict validation 通过。
- 没有运行外部冻结质量 benchmark，没有性能收益结论，不声称实验多视角解决 #236 的召回、排序或 scope error。
- 未 commit、push、发布、修改依赖或用户 canonical 数据；保留 OpenSpec change 为未归档状态。

## 临时实验 mode 追加验收

`lore query "<text>" --mode multi-view-vector` 仅为本次调用选择实验方法；CLI 组装为 `mode: semantic`、`retrievalMethod: multi-view-vector`，不扩展 Backend 或结果 mode。普通 semantic 调用继续读取配置默认，keyword 保留离线路径。未添加 `--retrieval-method` 或其他独立方法 flag。

本轮验证：

- 新增错误优先级回归在实现前失败：实验 mode 返回 `usage.invalid`，而不是进入 Backend 的模型错误；实现后与设置测试一起 **42 pass**。覆盖非法方法配置被单次选择覆盖、下一次普通调用仍报告配置错误，以及输入校验优先于设置/Backend。
- 包检查暴露的旧 mode 错误文案断言已删除，不把新枚举文案重新固定；保留非法选项拒绝、exit 2、错误码、协议结构及不回显输入的行为覆盖。
- `bun test packages/cli` 最终 **496 pass / 3 skip / 0 fail**（63 文件）；`bun run typecheck` 通过。一次先前后台命令报告了不一致的超时状态，仅作为中断结果，未当成有效通过证据。
- 四个本轮 TypeScript 文件的 focused oxlint 和 oxfmt check 通过。
- 更新后的 `project-context-native-smoke.integration.ts` 使用 48 条 test-owned Practice、实际 HTTP Backend 和固定真实 GGUF，通过 `temporaryModeOverride: true`、`configurationUnchanged: true`。在没有配置文件时临时查询自动建好多视角 artifact，响应 `mode: semantic`；随后普通查询返回原 single-vector Profile。配置中方法非法时，临时查询仍使用多视角 Profile，配置内容逐字不变，普通 query 仍返回配置错误。既有 pending/partial/complete、operation 身份、keyword 和增量路径继续通过。
- `bun run build:cli` 生成完整 `dist/release/darwin-arm64/`；在隔离 HOME 下实际调用该二进制的 `describe query`，确认 `--mode` 公开值为 `semantic`、`keyword`、`multi-view-vector`，默认仍为 semantic。本轮编译 binary 仅做了入口合同验证，真实模型路径由上述 source CLI/HTTP/native 集成覆盖；没有复用旧二进制查询结果冒充本轮验证。
- 中英 query/config 页面、CLI 维护合同及 Backend API 组装说明同步；站点 production build/prerender 通过。

本轮未改用户 Store/config、未停止或重启用户 daemon，临时发现命令 HOME 已清理。没有重跑质量 benchmark，未替换 PATH 中的已安装 CLI；新入口属于当前 worktree 的源码及上述编译产物。

## 原生验收脚本结构整理（2026-10-17）

- `project-context-native-smoke.integration.ts` 从 663 行缩为 49 行，只保留场景选择、结果汇总和 finally 清理。原生环境、语料生成、ProjectContext 和方法选择分别归入既有 `support/`、`fixtures/`、`scenarios/` 结构；组织和运行方法见 [维护说明](../../../docs/development/backend-integration.md#cli-原生-smoke-的场景边界)。
- 两个场景共用一个真实模型/runtime 和 HTTP Backend，但有独立的 Store、derived cache、配置和语料。ProjectContext 保留 48 条语料；方法场景从自己的 5 条语料开始，并断言多视角编码跨过 native 文档批次边界。切回默认及已有方法的查询保留零等待，未用等待重建放宽复用验收。
- 最终 `bun run test:native-smoke -- <model.gguf>` 通过两个场景：初始编码 48 条、增量仅 1 条；方法场景编码 20 个文档输入，临时 mode、配置不写回、两方法隔离、配置往返和原 operation 身份均通过。另以 `retrieval-methods` 参数从全新环境独立运行通过，不依赖前一个场景的模型准备或索引状态。
- 第一次重构后的完整运行发现同步点误按尝试次数计数，导致模型准备阶段提前阻塞，partial 查询仍返回 preparing。恢复按成功编码批次设置同步点后通过；保留 partial/strict 原断言，没有延迟重试或放宽结果掩盖问题。
- CLI `tsconfig.json` 将 integration 纳入类型检查；修正因此暴露的既有 stdin 收窄问题，保留按是否提供输入选择 pipe/ignore 的行为。最终 CLI typecheck、相关 oxlint、7 个变更代码/配置文件的 oxfmt check 通过；进程完成、stdin 和超时的现有测试 **3 pass / 0 fail**。
- 本轮只调整验收结构与维护说明，未改生产检索合同、用户 Store/config 或已安装 CLI；真实路径是源码 command registry、HTTP Backend 和 native 模型，没有重新构建或验证编译发布包，也没有质量或性能收益结论。

## 以 main 为基线清理过渡迁移（2026-10-17）

- 基线为 `963963e6cdc334258842f8924f03a21e8d8c92d5`：其单向量索引格式版本为 2，三类 semantic index 只有初始 `0000` 迁移。保留这些 SQL、snapshot 和初始 journal 身份；删除 #272 及本分支叠加的 9 份过渡 SQL、9 份 snapshot，重新生成 3 份直接到最终结构的 `0001` 及其 snapshot，净减少 12 份迁移产物。不承诺兼容 PR 内部的过渡格式。
- `scripts/db/generate.ts` 从 120 行减至 61 行，删除历史遍历、旧 snapshot 推断、字段映射及事后 CHECK 修补。CHECK 由 schema 的不带表限定列引用直接生成。共享向量缓存相对 main 的 digest 列迁移确有必要，保留其已有 `0001` 和行保留验证；canonical LocalStore 与 keyword 迁移不改。
- 对直接生成的 SQL 做真实旧库回放，3 个回归首先失败：SQLite 把不存在的 `"input_key"`、`"channel"` 等源列解释为字符串，复制出了无效向量行。新迁移删除该不需要的数据复制，旧 metadata 保持版本 2、不误判为当前 ready；从 canonical 内容重建，不再为中间 schema 搬运向量。
- 再次执行 `bun run db:generate`，8 个配置均无 schema 变化；3 份新 SQL 的前后 SHA-256 相同。迁移与 reader 两文件最终 **25 pass / 0 fail、62 assertions**，覆盖真实 main 初始迁移、旧行失效、当前行不被重复迁移清空、通用 channel/复合键以及共享缓存的必要升级。删除了迁移条数、表名和字段清单的实现断言，不把旧计数改成新计数。
- Engine 聚合执行采用既有无关失败名排除规则，结果 **332 pass / 2 fail**。两项失败都是向量复用测试中固定迁移数为 4 的断言；删除该断言，保留不重复编码和更新后 content digest 的行为验证后，仅复跑这两例，**2 pass / 0 fail**。没有再次执行整包，也不把分次结果写成一次未观察到的全绿聚合。
- 新迁移下的 `bun run test:native-smoke -- <model.gguf>` 通过 ProjectContext 和检索方法两个场景：初始实际编码 48 条、增量仅 1 条，独立 5 条方法语料编码 20 个输入，单向量/多视角/切回、临时 mode、配置不写回及 operation 身份通过。
- 全仓 typecheck、5 个相关 TypeScript 文件的 oxlint、11 个 TypeScript/JSON 文件的格式检查以及 OpenSpec strict validation 通过。维护规则与设计已同步，不保留生成器的历史修补例外。
- 未操作用户 Store/config、模型文件或已安装 CLI；本轮没有重新构建编译发布包、commit 或 push。上述原生证据属于源码 command registry、实际 HTTP Backend 与 native 模型路径，不代表发布包或 CI 验证。
