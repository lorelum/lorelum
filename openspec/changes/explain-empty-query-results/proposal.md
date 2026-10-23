## Why

成功的空 query 只有 `results: []`，人和 Harness 不知道本次确认了什么、下一步做什么。本变更新增空结果说明及 JSON 字段，解决 Issue #228，不改变检索或 readiness。

## What Changes

- 仅 ready 空结果增加 `empty`；text 先说明查询成功，再给已知边界和一次改写建议。
- 原因只按本次事实判断，保留 mode、coverage 和 context warnings；不额外探测、扫库或切换模式。
- 同步官方 Skills 和英中文档。产品流程见 [product](./product.md)，实现位置见 [design](./design.md)。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `retrieval-query`：成功空结果的说明、字段与回归边界。
- `agent-integration`：消费说明，不盲目诊断或 fallback。

## Impact

Engine/Backend 传递已证明的空语料事实，CLI 组装说明；无依赖或数据迁移。非空、pending、error 和退出码不变。
