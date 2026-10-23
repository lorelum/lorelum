# 成功空结果

用户正常运行 `lore query`，成功但没有 Practice 时，仍 exit `0`，看到一小段说明和一条首选下一步：

```text
Query completed successfully but returned no Practices (mode: keyword). No more specific cause is confirmed. Next: continue the task without Lorelum guidance. Only if important context was missing, try at most one substantive rewrite for this lookup with the decision, constraints, and technology context. If the query was already specific or the rewrite is still empty, stop querying.
results: []
```

默认无需 Lorelum guidance 继续任务，不要求把空结果改到有命中。只有原 query 缺少重要上下文时，才可把“auth”实质补充为“React 登录页使用现有 cookie-session 服务，需要防止重复提交，不能改服务端 API”，保留原 mode；本次检索最多改写一次，不是每个空响应各一次。query 已具体或改写后仍空就停止检索，不保证语料中存在相关内容。

## 已知边界与 JSON

仅 ready 空结果增加以下对象；真实 envelope 及原 data 字段保留：

```json
{"empty":{"reason":"empty","nextAction":"continue-task","message":"Query completed successfully but returned no Practices (mode: keyword). No more specific cause is confirmed. Next: continue the task without Lorelum guidance. Only if important context was missing, try at most one substantive rewrite for this lookup with the decision, constraints, and technology context. If the query was already specific or the rewrite is still empty, stop querying."}}
```

| 情况 | 说明 |
| --- | --- |
| 同一完整 snapshot 证明可检索 Practice 为零 | `reason: corpus-empty`，明确“当前 context 没有可检索 Practice”；不等于没安装 Pack，改写不会增加 Practice |
| 没有更具体证据，包括 keyword miss | `reason: empty`，不猜模型失败、语义无匹配或知识缺失 |
| Semantic | text 明示原 coverage；partial 保留原计数，不能说成 complete no-match |
| Degraded 或 warnings | 段落说明有来源未参与，保留同一份 `context.warnings` |

`reason` 和 `nextAction` 是稳定枚举，Harness 不解析 message。`--verbose` 保留完整 data 和说明，`--json` 不受 text 视图影响。

## Agent 的下一步与不变行为

先分清 ready、pending、error；只有成功空结果才消费 `empty`。`nextAction: continue-task` 表示默认不再查询，继续主任务。泛化空结果可提示一次有实质补充的改写，但 query 已具体或该次改写仍空就停止；已证明零 corpus 时直接继续，不建议改写。用户明确怀疑来源缺失时才建议检查 Pack。

空结果不触发 status 命令、安装、更改配置或模式 fallback。只有用户意图或 Host policy 明确允许且符合既有 mode contract，才考虑显式换模式；出现候选后仍用 `get` 读全文。非空 ready 不加说明，pending/error 沿用原恢复和 exit `1/2`，已有安装和数据保持不变。
