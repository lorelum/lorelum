## ADDED Requirements

### Requirement: Semantic retrieval method selection

semantic retrieval SHALL 支持 `single-vector` 与 `multi-view-vector` 两种向量方法。CLI 的 `--mode` SHALL 接受 `semantic`（默认）、`keyword` 与 `multi-view-vector`。普通 semantic query SHALL 从用户配置 `query.retrievalMethod` 读取方法，缺省 MUST 为 `single-vector`；显式 `--mode multi-view-vector` MUST 仅为本次 query 选择实验方法，优先于方法配置且 MUST 不读取或校验被覆盖的方法项、不写回配置、不改变后续命令的默认选择。实验调用发送到 Backend 的请求及结果 MUST 仍使用 `mode: semantic`，不得把单向量语义检索映射为 keyword。semantic CLI 请求 MUST 显式传递本次解析的方法；直接 Backend query 请求的可选 `query.retrievalMethod` 缺省 MUST 为 `single-vector`。Backend MUST 不通过启动时读取 CLI 用户设置覆盖请求方法。

#### Scenario: An unconfigured query uses single-vector semantics
- **WHEN** 用户未配置 `query.retrievalMethod` 并执行合法的默认 query
- **THEN** 查询 SHALL 使用简易语义检索，MUST 不启用 query 分句和多视角评分，也不得转为 keyword

#### Scenario: Experimental retrieval is explicitly selected
- **WHEN** 用户设置 `query.retrievalMethod: multi-view-vector` 后执行 semantic query
- **THEN** 查询 SHALL 使用多视角方法，且 MUST 只读取与该方法兼容的向量

#### Scenario: Experimental mode is temporary and overrides the configured method
- **WHEN** 用户配置 single-vector 或非法方法值，并执行 `lore query "<text>" --mode multi-view-vector`
- **THEN** 本次 query MUST 使用实验方法及其兼容索引，MUST 不因被覆盖的方法值而失败；配置文件 MUST 不变，请求和结果 MUST 仍标为 semantic

#### Scenario: The next query restores the configured default
- **WHEN** 临时实验 query 结束后，用户不带实验 mode 再次 query，且方法未配置
- **THEN** 查询 MUST 使用 single-vector，MUST 不保留上次命令的实验选择

#### Scenario: Invalid modes fail before connecting
- **WHEN** 用户指定未知 mode、旧规划值 multi-view 或不给 mode 提供值
- **THEN** CLI MUST 返回 usage.invalid，MUST 不连接 Backend


#### Scenario: Configuration changes without restarting the daemon
- **WHEN** 同一 Backend 存活期间，用户把设置从 `multi-view-vector` 改为 `single-vector` 并发起下一次 CLI semantic query
- **THEN** 新查询 MUST 使用 `single-vector`；此前已经接受的多视角 operation MUST 保留创建时的方法

#### Scenario: Direct Backend requests have a stable default
- **WHEN** 直接 Backend client 省略 query 方法字段，而 CLI 用户文件中配置了 `multi-view-vector`
- **THEN** 该 Backend 请求 MUST 使用 `single-vector`；显式携带 `multi-view-vector` 的请求 MUST 使用多视角方法

### Requirement: Invalid semantic method choices fail explicitly

CLI 实际消费的方法配置 MUST 只接受准确的 `single-vector` 或 `multi-view-vector` 字符串，不得将旧规划名称 `simple` 或 `multi-view` 作为别名接受。该配置中非法类型、null 或未知值 MUST 返回指出该项的 `query.config-invalid`，且 MUST 在 Backend 接入前失败；Backend 请求的非法方法 MUST 返回既有 `usage.invalid`。系统 MUST 不静默忽略实际消费的非法值，不得自动改用另一向量方法或 keyword。显式实验 mode 对被覆盖的方法配置不进行消费；其他配置及输入的既有错误 MUST 保留。

#### Scenario: A misspelled configured method is not a fallback
- **WHEN** semantic query 读取到 `query.retrievalMethod: multiview`
- **THEN** CLI MUST 返回配置错误和修复该项的提示，且 MUST 不发起查询或构建

#### Scenario: An invalid API method is rejected
- **WHEN** Backend query 请求指定未知方法或非字符串方法值
- **THEN** 请求 MUST 以 `usage.invalid` 失败，且 MUST 不接受索引 operation

#### Scenario: Explicit keyword retrieval ignores semantic method settings
- **WHEN** 用户执行 `--mode keyword`，且配置中的 `query.retrievalMethod` 非法
- **THEN** keyword query MUST 仍按原有离线路径执行；它 MUST 不校验或应用该方法项，也 MUST 不连接 Backend、加载模型或联网

### Requirement: Single-vector retrieval preserves the full-text vector baseline

`single-vector` SHALL 将完整 query 编码为一个向量，并将每条 Practice 的旧简易语义文档投影编码为一个向量；文档投影 SHALL 包含原有字段顺序和文本标签、Practice ID、标题、适用条件、技术栈、stage、anti-pattern 及可选正文。排序 MUST 由归一化向量的余弦相似度决定，不得使用 query 分句、正文分块聚合、BM25 或多视角公式。同分 MUST 以 Practice ID 的稳定代码单元顺序决定。公共 top-k MUST 仅限制最终返回条数。

#### Scenario: Punctuation does not split a single-vector query
- **WHEN** single-vector query 包含多个用中英文标点分隔的句子
- **THEN** 查询 MUST 使用完整原文的单个 query 向量，而不是对句子分别编码后平均

#### Scenario: Baseline similarity determines ordering
- **WHEN** 同一完整 query 与两个 Practice 的完整文档向量得到不同余弦相似度
- **THEN** 较高相似度的 Practice MUST 排在前面；当相似度相等时 MUST 使用稳定 ID 顺序

### Requirement: Multi-view retrieval remains an explicit experimental method

`multi-view-vector` SHALL 保留多类文档表示、query clause 投影与现有向量聚合语义。常规评分 SHALL 对每个 query clause 取 task-card channel 的最佳相似度，并将 body channel 中编码单元的最佳相似度与全部相似度均值按 `0.5 / 0.5` 混合，再对存在的 task-card 与 body 两部分等权平均；跨 query clause SHALL 按其权重求平均。`full` channel MUST 不参与存在 task-card/body 时的常规评分。所有 eligible Practice MUST 参与打分与排序，K MUST 只在最终排序后应用；内部候选报告宽度 MUST 不改变评分集合。此算法 MUST 不自动应用到 `single-vector` 或 keyword。

#### Scenario: The experimental formula is isolated
- **WHEN** 同一语料上分别执行 single-vector 与 multi-view-vector 查询
- **THEN** 只有 multi-view-vector MUST 采用 query 分句与多类文档表示的聚合；single-vector MUST 保持完整 query 与完整文档向量的比较

#### Scenario: Candidate reporting does not truncate experimental scoring
- **WHEN** benchmark 报告 N 个候选并返回 K 个最终结果
- **THEN** multi-view-vector MUST 仍对全部 eligible Practice 排序，N MUST 只限制内部报告宽度

### Requirement: Method selection preserves query consistency and lifecycle

两种语义方法 MUST 共用既有的 current-context 一致性、canonical digest 校验、coverage、operation 和 preparing/indexing 行为。缺少所选方法的 complete artifact 时，查询 MUST 按既有 current-target 流程提交或加入该方法的构建，不得用另一方法的 artifact 或旧语料冒充 ready。公开结果 MUST 继续仅包含既有摘要和状态信息，不增加内部评分、query 片段或正文。

#### Scenario: Another method is ready but the selected one is not
- **WHEN** single-vector artifact 已 ready，而当前请求显式选择尚未 ready 的 multi-view-vector
- **THEN** 查询 MUST 进入 multi-view-vector 的现有构建/进度流程，并按 wait 与 coverage policy 返回结果或 pending；MUST 不返回 single-vector 排名代替

#### Scenario: A changed canonical Practice invalidates either method candidate
- **WHEN** 任一方法的候选内容摘要与同次查询快照不一致
- **THEN** 系统 MUST 按既有 retry 或 typed failure 丢弃不一致结果，不得返回索引保存的旧摘要
