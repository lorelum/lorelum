## Why

将已有的多视图实现改为开箱即用的默认检索方式，统一 query、安装与索引命令的选择。它已有完整的多视图投影、query clauses、评分与隔离索引实现；本次只切换未显式选择方法时的默认值，不改变两种方法自身的算法，也不将真实 Pack 的内存测量解释为排名质量提升。

## What Changes

- 无显式方法的 semantic query、index status/build/rebuild、install 后 indexSync，以及 Backend HTTP 的省略方法请求，统一选择 `multi-view-vector`。
- 显式 `query.retrievalMethod: single-vector` 和单次 `--mode single-vector` 保留；空配置或删除该字段使用新的多视图默认。
- 继续使用方法专属 Profile、artifact、progress 和 embedding cache。只有旧 single 索引的用户在首次使用新默认时按既有规则准备多视图索引，不删除原数据或旧方法产物，不写回用户配置。
- 默认 text 隐藏新的默认方法名，非默认 single 方法可见；verbose/JSON 保留实际方法。更新真实 native 验收、中英文文档和维护者接口说明。

这是默认检索行为变化，可能改变结果排名与首次索引工作量；用户体验见 [product.md](product.md)。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `retrieval-query`：默认多视图与显式覆盖、旧方法索引共存、方法切换后的 preparing/indexing 行为。
- `semantic-index`：安装和索引命令在无配置时与默认 query 使用同一多视图 Profile，保留方法隔离和 canonical commit 语义。

## Impact

默认值唯一归属仍是 Engine method catalog，CLI 设置与 Backend 请求解析复用该常量；不新增配置、别名、协议字段、模型身份、索引格式或后台迁移器。不更改已显式配置的用户，不重置已有 multi-view Profile。更新当前 PR 的兼容性说明，明确它除了 idle 回收还包含本次获授权的默认检索切换。
