## Why

PR #272 把多视角文档投影、query 分句与聚合评分直接放进原有 semantic 入口，并替换其默认行为；用户无法保留简易自然语言检索，也无法显式选择实验算法。需要把检索方法作为独立、可组合的算法边界，让算法演进不再修改索引生命周期与协议编排。

## What Changes

本变更新增产品行为，不是单纯目录搬迁。

- semantic 下提供 `single-vector` 与 `multi-view-vector` 两种向量检索方法；未配置时使用 `single-vector`，多视角方法必须显式启用。保留 `--mode semantic`、`--mode keyword`，新增 `--mode multi-view-vector` 仅为本次 query 选择实验语义方法；Backend 与结果仍使用 `mode: semantic`。旧规划名称 `simple` / `multi-view` 不作为别名接受。
- 用户级 `query.retrievalMethod` 选择持久默认；默认 query、index status/build/rebuild 与 Pack 安装后的索引同步读取该选择。显式 `--mode multi-view-vector` 优先于方法配置且不校验被覆盖的方法项，不写回配置，也不改变后续命令。方法随请求传给 Backend，不依赖重启 daemon 才生效。
- 隔离两种方法的文档投影、query 投影、评分和配方版本；canonical Practice 不包含向量属性，向量派生数据明确区分 `PracticeVectorProjection`、`EmbeddingInput` 与 `DocumentVector`。保留一套模型接入、向量持久化、增量构建、进度、canonical 校验、snapshot fence 与原子发布。
- 方法身份参与 Profile、完整 artifact、progress 与向量缓存身份；切换方法不得串用索引或取消另一方法已经接受的构建。
- **BREAKING（相对 PR #272 分支）**：未配置的 semantic 查询恢复简易单向量算法；方法身份切换后不兼容的派生索引需要重建，不能把已有多视角索引冒充默认索引。canonical Pack 内容不变。
- 对现有查询与索引协议增加可选方法选择字段，缺省为 `single-vector`；公开结果摘要、mode、top-k、部分覆盖和 preparing/indexing 语义保持不变。
- 在 active change 内提供用户流程说明，实施时同步中英文用户文档及受影响的现有 active change，明确多视角是实验方法，不承诺解决 #236。

## Capabilities

### New Capabilities

无；复用既有检索与语义索引能力，不建立平行规格。

### Modified Capabilities

- `retrieval-query`：定义 semantic 方法配置、默认简易方法、实验多视角的显式选择及请求级一致性；限定多视角算法规则的适用范围。
- `semantic-index`：定义方法隔离的 Profile/派生数据身份，以及查询、构建、状态与安装同步对方法选择的一致性。

## Impact

- Engine：`query/semantic/` 中边界明确的向量方法合同 `VectorRetrievalMethod`、算法模块、Profile 与 reader；`query/artifacts/` 的组装、progress 与共享向量缓存；派生索引采用 input key/channel/input digest 命名及版本化迁移。该合同不要求 keyword 或未来非向量检索生成 embedding，不引入万能 Document 模型。
- CLI：query settings、query/index 请求组装、Pack 安装后的索引同步及错误提示。
- Backend：query/index 请求 schema 与 client、内容寻址 runtime 的 target、operation 与依赖组装；模型和调度生命周期继续共享。
- 测试：简易算法基线、多视角行为、配置默认与非法值、两种方法的 complete/partial 查询、索引与 operation 隔离。
- 文档：中英文 query/config/index 指南、维护者模块边界；不引入依赖、动态插件、继承框架、远端服务、MCP 或新的排序实验。
