## Context

CLI `query-command.ts:toQueryResult` 将 Engine/Backend result 转为公开 data，`text.ts` 控制决策视图。产品输出见 [product](./product.md)。只增加事实标记和说明，不改变路由、排名或资源生命周期。

## Decisions

### 原因由持有完整事实的查询边界给出

Engine `QueryResult`、`SemanticQueryResult` 增加可选 `emptyReason?: "corpus-empty"`。只在已有完整 corpus 为零时给标记：

- Store keyword：`query/query-service.ts` 首建持有的完整 `prepared.practices`；warm index 的候选子集不能证明 corpus 为空，保持不标记。
- Project keyword：`keyword/content-addressed-query.ts` 已有 `corpus.practices.length`。
- Store/Project semantic：Backend `ContentAddressedSemanticRuntime.queryTarget:complete` 已有 `target.corpus.practices.length`；沿用 `queryCurrent` 的 freshness 检查。

Backend ready schema/controller 转发标记，pending 不加。不得为精细分类增加 count、全库读取或状态调用。旧 Engine retained-delta partial-empty 保持原样；生产路径零 eligible progress 仍 pending，不新增 `partial-coverage-empty`。

### CLI 唯一拥有 explanation 策略

新增纯函数 `createEmptyQueryExplanation`（`query/empty-result.ts`），接收原 mode、coverage/counts、context 和可选标记，返回：

```ts
interface EmptyQueryExplanation {
  readonly reason: "empty" | "corpus-empty";
  readonly nextAction: "refine-query";
  readonly message: string;
}
```

`toQueryResult` 仅在 ready `results.length === 0` 调用它：有标记则 `corpus-empty`，否则 `empty`；内部标记不单独泄漏到 CLI JSON。公开 schema 同步该对象。沿用原 context 类型，不复制 warning 状态。

message 一次生成成功事实、mode/coverage、来源限制和建议；空 corpus 文案明确改写不会增加 Practice。default text 先显示 message，再保留结果及 warnings；verbose 空结果先显示同一 message，再用原完整 renderer。非空和 pending 渲染不变，JSON 原样输出 data。

## Verification

补 colocated tests 覆盖两种原因、冷/热 keyword、partial 空结果的输出边界、degraded context 和非空/pending/error 回归；测试事实传递及调用次数。沿现有 CLI process fixture 验证真实 text/verbose/JSON，并走一次支持的 semantic 空 corpus 路径。无需重验未修改的模型下载、并发和全部生命周期；既有相关 regression 继续跑。无持久化迁移或旧入口替换。
