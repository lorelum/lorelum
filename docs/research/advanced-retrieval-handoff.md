# 高级检索交接：服务端/调用方判断、接口需求与离线证据

> 日期：2026-10-13。读者：下一阶段在新仓库或新会话中设计高级检索服务与接口的维护者。状态：交接说明，不是产品合同。本文不授权修改本仓库的生产检索、公共 schema 或 CLI；接口正式化需要单独的 OpenSpec 提案。

## 1. 边界

- 本仓库（开源客户端）保留本地向量检索（`lore query` 默认 `--mode semantic`，入口 `packages/cli/src/query/query-command.ts`）作为回退。不内置 reranker，不内置判断模型。
- 高级检索放在闭源服务端或调用方 agent 中。客户端只负责：提供候选、调用接口或交给调用方 agent、把结果交给用户。
- 私有 Pack 默认不离开本机：走调用方判断（判断包在用户自己的 agent 中处理），不上传给服务端。是否支持服务端判断私有 Pack 的显式开启，待决定。
- AGENTS.md 禁止本地 MCP 化；远程检索接口属于新的公共合同，需单独批准设计。

## 2. 已有证据

| 实验 | 条件 | 结果（前 5 命中，开发集） | 状态 |
| --- | --- | --- | --- |
| 角色 Q / Q+I（§26） | 人工 query 角色加权，单标注者 | 41/50 vs 对照 45/50，未通过 | 停止 |
| subagent 判断（§27） | LLM 判断单独排序，池 24 | 54/69 vs 对照 33/69，逐例 +25 / -4 | 开发集强信号，未预登记 |
| subagent 判断（§27） | 向量与判断名次平均，池 24 | 40/69，+7 / -0 | 预登记融合，被判定劣于判断单独排序 |
| 本地 reranker 0.6B（会话实验） | 融合，`/completion`，池 24 | 43/69，单请求中位 5.5 s | 不进产品规划（用户决定） |

约束：所有数字来自开发集（反复使用）；金标为 LLM 评审生成，与判断者同源，有循环偏高风险；用户已决定不做独立验证，因此这些数字只能作为设计依据，不能写成已验证的收益。

## 3. 判断标准与提示词（subagent 实际使用的原文）

判断者只看 query 原文与候选的 `title`、`applies_when`、`exceptions`。每个分片由一个 subagent 独立完成。

```text
# Goal
For each request (query) and each of its 24 candidate Practices (engineering guidance documents), label each candidate with exactly one class judged ONLY from the provided text: does this guidance apply to the situation the request describes?

# Classes (use these exact strings)
- "fit": the candidate's applies_when condition matches what the request is doing or about to do, in its current state and action, and its exceptions do not exclude it.
- "same-topic": the candidate is about the same general subject/technology as the request, but its applies_when condition does NOT match the request's specific action, state, or situation.
- "not-applicable": unrelated to the request, or clearly does not apply.

# Rules
- Read ONLY the input file named in your task. Do not open any other file in the repository or home directory, do not search for labels, rankings, or any other judgments.
- Do not infer where a candidate came from or how it was ranked.
- Judge each candidate independently of the others; do not force a fixed number of "fit" items.
- Judge the request's own wording, not what you think the user "should" ask.

# Output
Write one JSON line per input query to the output file, same order:
{"id":"<query id>","labels":{"<candidate id>":"fit|same-topic|not-applicable", ...}}
Every candidate id of that query must appear exactly once.
```

## 4. 判断包格式

每行一条请求：

```json
{"id":"<query id>","request":"<原文>","candidates":[{"id":"k00","title":"...","applies_when":"...","exceptions":"..."}]}
```

- 候选 ID 必须匿名并每条请求内打乱；Practice ID 与映射只留在调用方侧。
- 不得包含：正文、向量分数、名次、来源、任何标签或其他判断。
- `exceptions` 取 "Exceptions and boundaries" 段，截断 600 字符。截断长度属于判断包版本的一部分，改动需升版。

## 5. 接口需求（草案，待 OpenSpec）

1. **候选宽度与结果数分离**：请求带 `candidateWidth`（N）与 `resultLimit`（K）。已测：N=24 时金标覆盖 58/69；N=48 时 67/69。池外候选无法被判断救回。
2. **范围声明**：指明查询的 Pack 范围（官方 / 私有 / 两者）。官方内容按 Pack ID 与版本哈希引用，服务端自取文本。私有内容默认不上传。
3. **判断包**：响应或请求中包含判断包（第 4 节格式）。
4. **两种判断方式，同一接口**：
   - 服务端判断：服务端 LLM 对全部候选 listwise 判断。
   - 调用方判断：调用方 agent（如 subagent）返回每个候选的类别，服务端只做融合与排序。
5. **融合规则版本化**：当前唯一预登记的融合（平均名次）已被否定，不得作为默认。判断单独排序是否作为新版本默认，需要新的预登记规则与新请求验证。
6. **降级语义**：服务不可用、超时或配额耗尽时，返回本地向量结果，并明确标注"未经高级检索"。不得伪装为成功结果。
7. **可复现标识**：响应包含判断标准版本、判断包版本、融合规则版本、候选宽度。
8. **隐私声明**：列出离开本机的字段，以及是否包含 query 原文。
9. **可选上下文字段**（未验证假设）：调用方提供的当前阶段，例如"刚改完、准备说完成"。是否有帮助未测。

## 6. 未决项

- 私有 Pack：走调用方判断，还是允许显式开启的服务端判断。
- 判断单独排序是否作为默认：需要新请求与预登记规则。
- 真实延迟与成本：subagent 测试未记录 token，服务端 LLM 的单次延迟与费用未测。
- 判断一致性：没有重复采样或双判数据。
- 金标循环：需要人工复核子集，或由用户提供真实请求。用户已决定本阶段不做独立验证，此项作为后续风险保留。
- 非官方 Pack 的表现未测。

## 7. 本地检索 PR 的边界（后续提交时）

- 本地检索（#236）的 PR 与本文档分开提交；本文档不依赖其代码。
- benchmark 内部的方案 C 实验工具（`packages/backend/src/benchmark/role-aligned/`）不进入主仓库，仅保留文档记录。
- 原始请求、标签、判断包、映射与模型文件均在仓库外的私有运行目录（路径不入库），不得提交。
