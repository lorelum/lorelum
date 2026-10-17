# 检索方法选择与用户流程

## 默认使用简易语义检索

用户已经安装 Pack，直接执行：

```bash
lore query "提交前帮我检查有没有不必要的实现" --top-k 5
```

未设置 `query.retrievalMethod` 时，使用 `single-vector`：完整问题编码一次，每条 Practice 使用一条完整文本向量，以余弦相似度排序。它不是关键词检索，仍需要现有的本地 embedding runtime。

命令继续返回 Practice 摘要，而不是生成式回答；用 `lore get <practice-id>` 读取完整内容。模型、Pack 安装位置、项目发现、top-k、等待预算和 coverage 设置不因选择方法而改变。

## 显式体验多视角实验

只想临时体验时，直接运行：

```sh
lore query "提交前帮我检查有没有不必要的实现" --mode multi-view-vector
```

它只为本次查询选择实验方法，优先于 `query.retrievalMethod`，也不校验被覆盖的方法值；不会写入配置。下一次不带该 mode 的查询仍按用户配置执行，未配置时恢复 `single-vector`。返回结果仍标为 `mode: semantic`，索引与 Profile 按所选方法隔离。无需重启 Backend，也不需要先手动 build。

若希望将实验方法作为后续命令的默认选择，再修改配置：


在已有用户配置 `~/.lorelum/config.yaml` 的 `query` 节加入设置，保留其他配置：

```yaml
query:
  retrievalMethod: multi-view-vector
```

之后执行同样的 `lore query`。此时使用 PR #272 的 query 分句、task-card/body 多类表示和向量聚合评分。它是实验方法，可能改善某些排名，也可能回归；不是“当前是否适用”的判断服务，不承诺解决 #236。名称中的多视角描述该算法，不意味着每块正文都是一种独立视角。

选择由每次 CLI 调用解析并传给 Backend。配置修改后的下一次普通 semantic 调用即生效，不需要停止 Backend；已经接受的 operation 保持原方法，不会执行到一半换算法。临时选择复用 `--mode`，不增加独立方法 flag，也不需要手填 query 角色。

## 首次使用与索引进度

方法有各自的派生索引。首次使用某方法时，即使另一方法已经 ready，这一方法也可能尚未 ready。

- 普通 query 沿用已有流程：提交或加入该方法的索引构建，在等待预算内观察；完整可用则返回 complete 结果，满足 coverage 设置则返回 partial 结果。
- 尚无满足 coverage 的结果时，沿用 `preparing` 或 `indexing` 输出和恢复提示。用户稍后重试，不需要清理 Store 或重复安装 Pack。
- `lore index status` 查看所选方法的状态；`lore index build` 与 `lore index rebuild` 对所选方法工作，operation ID 始终指向创建时的方法。
- Pack 安装后的索引同步使用同一配置。canonical 安装成功后，派生索引的失败不能撤销安装，仍通过既有 `indexSync` 报告。

例如 ready 查询的 `data` 形状仍是：

```json
{
  "mode": "semantic",
  "profileId": "<所选方法及编码配方的身份>",
  "coverage": "complete",
  "results": []
}
```

这里只展示结构，不是一次检索记录；`results` 中仍为既有 Practice summary 字段，不增加分数、query 片段或正文。partial 和 pending 的原有字段与退出码不变。

## 退出实验

将配置改回：

```yaml
query:
  retrievalMethod: single-vector
```

也可以只删除 `retrievalMethod` 这一项。下一次 query 和 index 操作使用简易方法；已存在且匹配当前语料的简易索引可直接使用，否则正常构建。实验索引不会被当成简易索引，也不会因为切换配置就删除另一方法的产物。缓存继续由既有清理机制管理，不引入永久保留承诺。

从 PR #272 的已有缓存迁移时，不兼容的 Profile/缓存需要重新构建；Pack 内容和项目局部 Practice 不迁移，不需要用户手工删除索引目录。方法隔离不是排名改善的承诺。

## 错误与明确的 keyword 路径

| 用户情况 | 可见结果 | 处理 |
|---|---|---|
| 未配置方法 | 简易语义检索 | 无额外操作 |
| `retrievalMethod: multi-view-vector` | 实验多视角向量检索及该方法的索引状态 | 首次构建时按既有提示重试 |
| `--mode multi-view-vector` | 仅本次使用实验方法，忽略被覆盖的方法配置；返回 `mode: semantic` | 不需要编辑配置，下一次普通 query 恢复配置默认 |
| 方法值拼错、类型不对或为 null，且未用实验 mode 覆盖 | 普通 semantic query/index 返回指出配置项的配置错误，不连接 Backend，不暗中换算法 | 改成 `single-vector`、`multi-view-vector` 或删除该项；单次体验可用 `--mode multi-view-vector` |
| 模型或构建失败 | 既有 typed failure；不会拿另一方法结果顶替 | 按既有模型/索引错误提示恢复 |
| Pack 已安装而索引同步失败，包括配置错误 | 安装保持成功，`indexSync` 报告失败 | 修复原因后执行所选方法的 index build |
| 显式 `--mode keyword` | 原有离线 keyword 检索 | 不读取或校验 semantic 方法项，不因其拼错而启动 Backend 或阻止 keyword 查询 |
| mode 值拼错或缺值 | 返回 `usage.invalid`，不连接 Backend | 使用 `semantic`、`keyword` 或 `multi-view-vector` |

`single-vector` 与 `multi-view-vector` 都属于 `semantic`。`--mode keyword` 不受该方法配置影响，仍不加载模型、不连接 Backend、不联网。方法失败时不自动切到 keyword，也不自动切到另一语义方法。旧规划名称 `simple` 和 `multi-view` 不作为合法配置值或兼容别名。

## 直接使用 Backend client

query 请求的 `query.retrievalMethod` 和 index target 请求的 `retrievalMethod` 可以显式指定方法。省略字段一律为 `single-vector`；Backend 不替 API 调用者读取 CLI 用户配置。CLI 已负责把本次解析结果显式传入，因此修改配置无需重启 daemon。既有合法 API 请求可继续使用；直接 API 调用者若要实验多视角，需要显式传入 `multi-view-vector`。
