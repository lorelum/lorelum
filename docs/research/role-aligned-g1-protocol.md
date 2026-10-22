# 方案 C G1：人工 query 角色与细粒度交互实验协议

> 日期：2026-10-08。读者：Lorelum 维护者与检索实验实现者。状态：G1 协议登记与工具说明，不是产品合同。回答的问题只有一个：**在模型与文档表示不变时，人工保留 query 的动作、状态、对象、必要条件和背景，是否改善 Practice 的适用性排序；进一步在证据单元内部保留这些角色的交互，是否比单纯角色加权更有效。** 允许的结论包括无收益、退化与证据不足。基础约束沿用 [G0 协议](./role-aligned-g0-protocol.md) 与 [研究计划 §3、§5、§6](./role-aligned-retrieval-plan.md)，本文不重复。实测结果与建议见 change 的 [verification §26](../../openspec/changes/advance-task-aware-semantic-retrieval/verification.md)。

实现位于 `packages/backend/src/benchmark/role-aligned/`，仍是 benchmark 内部工具：不在包 `exports`、CLI 或 Backend API 中；生产 `scoreSemanticPractice`、golden pin、Profile、持久化 schema、迁移、公开 schema 均未改动。

## 1. 对 G0 pilot 协议的修订：协议版本 2

G0 的版本 1 把两件事混在一起：`required-core` 的定义是“缺它任务得不到服务”，而成功判定却是“前 K 含至少一个 `required-core` 或 `sufficient-alternative`”。当一个任务有多个缺一不可的 `required-core` 时，命中其中一个并不服务任务。

版本 2 在任何 G1 评分产生之前冻结，分开两个口径：

| 指标 | 定义 | 含义 |
| --- | --- | --- |
| `fullyServed` | 前 K 含至少一个 `sufficient-alternative`，**或**含该 query 的全部 `required-core`（且至少存在一个） | 任务被充分覆盖 |
| `anyHelp` | 前 K 含至少一个 `required-core` 或 `sufficient-alternative` | 至少一个有效帮助，不保证覆盖 |
| `success` | `fullyServed` 且前 K 无 `forbidden` | **G1 的主成功口径**，对应研究计划 §6.3 第 2 项的“充分可接受答案且无已判禁项” |

`anyHelp` 与 `success` 并列报告，不互相替代。`noRelevantTarget` 的 query 不进入成功分母，只报告前 K 的禁项。v2 gold 与 `coreIds` 不变；替代项不追加到要求全部命中的 `coreIds`。标签文件的 `protocolVersion` 为 2，版本 1 的文件被拒绝。

此修订会改变 G0 `summarizeTopK` 的返回字段（`hasAcceptable` 拆为 `anyHelp` 与 `fullyServed`）；G0 之后没有任何 pilot 标签或评分，所以没有已查看的结果受影响。

## 2. 条件与公式

所有条件对全部 eligible Practice 评分并保存**完整**排名，K 只在读取排名时应用。余弦来自生产 query/document 向量；权重非负；无词面、名次融合、候选截断、多轮、负权重，Practice ID 只用于归属与既有 tie-break。

记 $t$ 为一条 query 文本，$v$ 为 Practice 的 task-card 或 body view，$\cos(t,v)$ 为 L2 归一化向量点积，$R(c_{tc}, c_{body})$ 为生产组内归约：

$$R = \tfrac12 \max_{v\in tc} c_v + \tfrac12\big(\tfrac12 \max_{v\in body} c_v + \tfrac12\, \mathrm{mean}_{v\in body}\, c_v\big)$$

缺一个通道时只用另一个通道，`full` view 不计分（与生产一致；实现为 `reduceViewCosines`，同时被 control 的独立复算使用）。

- **control**：生产 clause 与公式，不变。
- **Q**：每条角色文本 $t$ 独立计算 $s_t = R(\cos(t,\cdot))$，角色内对该角色的不同文本取等权均值 $\bar s_r$，再按 `ROLE_WEIGHTS`（intent 3 / constraints 2 / artifact 2 / moment 1 / domain 1，对实际出现角色归一化为 $w_r$）加权：$\sum_r w_r \bar s_r$。
- **Q+I**：与 Q 使用**完全相同**的角色文本与向量。先对每个 task-card/body view 计算联合余弦 $j_v = \sum_r w_r\, \mathrm{mean}_{t\in r}\cos(t,v)$，再对联合余弦应用同一个 $R$。因为余弦对融合是线性的，二者只相差“取最大值的位置”：Q 在每条文本内部分别取最大，Q+I 要求同一证据单元共同支持角色。

构造向量证明（`role-conditions.test.ts`）：intent=[1,0]（权重 0.6）、artifact=[0,1]（0.4），Practice A 的两个 body view 分别为 [1,0]、[0,1]，Practice B 只有一个 [0.7071,0.7071]。Q 给 A 0.75、B 0.7071；Q+I 给 A 0.55、B 0.7071。Q 偏向分散证据，Q+I 偏向同一块共同支持。两种方向都可能正确也可能出错，实验同时检验两种情况。

具体规则（取自 `candidate-policy.ts`，未新增公式）：

| 情形 | 行为 |
| --- | --- |
| 重复文本 | 同一角色内相同文本只编码并计一次；同一文本出现在两个角色时每个角色各计一次；文档 view 不去重 |
| 多个动作组 | 同一角色的不同动作组文本在该角色内取等权均值（不按动作组分别归一化） |
| 缺失角色 | 省略并重新归一化其余权重，不补默认分 |
| 负余弦 | 保持有符号，不截断，不加扣分项 |
| `unknown` | 不编码、不计分 |
| 无可计分角色 | 该 query 在该条件下走生产 clause 路径并计入回退次数，不排除任何 Practice |
| 无 task-card 与 body 的 Practice | 运行失败，不是低分 |
| tie-break | 分数降序，Practice ID 按 UTF-16 码元升序 |

多动作限制：Q 与 Q+I 都把同一角色的多个动作组文本平均，不把 moment/artifact 绑定到各自 intent。该绑定（`actionGroup`）被样本格式记录，但**不影响本轮分数**；多意图 query 因此被粗糙处理，这是已知限制，不是设计优点。

### 2.1 归因与负对照（运行前登记）

| 条件 | 相对关系 | 回答的问题 |
| --- | --- | --- |
| `Q-flat` | Q 的文本，所有出现的角色等权 | 角色权重本身的贡献 |
| `Q+I-flat` | Q+I 的文本，等权 | 聚合次序与权重是否可分 |
| `N-background` | control 的 clause 路径，query 末尾追加一句固定的不含任务含义的背景（`negative-controls.ts`，中英各一句） | 额外文本是否单独改变排序 |
| `N-segments` | 与 Q 相同的角色槽位与权重，但文本是 query 原文按相近长度切成的同数量连续片段，按角色在 query 中首次出现的顺序填槽 | 同等处理预算、无角色信息的文本处理 |
| `Q-restated`、`Q+I-restated` | 另一套人工样本：同一角色、同一来源片段，等义改写且不增加事实 | 收益是否依赖具体措辞 |

这些条件都是确定性的，没有随机化，因此不需要 seed。没有任何权重搜索。`Q-flat`/`Q+I-flat` 是归因对照，不是候选。收益归因规则：Q 相对 control 的变化不整体归于某一因素；与 `N-background`、`N-segments`、`Q-flat`、`*-restated` 同时比较，只描述这些单变量对照下观察到的差异，不推断可加性。

## 3. 门槛（运行前登记）

沿用研究计划 §6.3，数字化如下，在任何 G1 结果出现前固定：

1. control 对生产评分的独立复算误差 ≤ 1e-6，且 v2 冻结指标复现（G0 同标准）。
2. 新 pilot：候选 `success` 数**严格大于** control；`forbidden` 出现的 query 数不增加；所有条件的标注覆盖可比——前 K 未标注槽位总数之差不超过全部槽位数的 10%，否则为“不确定”。
3. 旧 v2：hit@5 ≥ 45/50，MRR ≥ 同一运行中 control 的值，scope ≤ 2，forbidden-before-core ≤ 1。
4. 小组零收益或回归逐例复审，不因总分通过；逐例改善/回归与任务簇、语言、Pack/任务类型分组一并报告（附样本数）。
5. 成本按 G0 冻结预算报告，与质量分开，不折算。

判定：任一可判定标准未达 → **失败**；否则，只要存在任何不能认定的条件 → **不确定**；全部满足 → **通过**。下列条件使 pilot 判定至多为“不确定”，无论分数如何：运行未标记为 pilot；角色标注不独立于目标；相关性标注不独立；pilot query 少于 24 条（工作量下限，不是统计功效）。未提供 pilot 时，只能得到“不确定”。

## 4. 独立性与 pilot 采集

- 角色标注者只看 query 原文，不看目标 Practice、labels、control 或实验排名。相关性标注是独立工作，可看 canonical 内容，但不看系统身份与条件排名。
- 24–40 条真实任务覆盖：当前动作与技术背景易混淆、状态/必要条件决定适用性、薄弱或未覆盖任务、多意图、无相关目标。query 须来自真实来源，不得照目标 Practice 反向编写；合成扰动只能做负对照。同源改写按同一任务簇计，不当独立样本。
- 使用目的（开发探索 / pilot 验证）与样本在策略冻结前分配。旧 v2 的 50 例已被反复使用，只能作 `development`，不是独立验收集。
- 标注者无法独立或真实新任务不可得时：继续完成工具、测试与不计入结果的小批可用性试标，披露依赖风险，不宣称独立验收，不勾选 20.4。

## 5. 命令

```text
bun packages/backend/src/benchmark/role-aligned/role-cli.ts author --queries <queries.json> --spec <spec.json> --out <primary dir> --out-restated <restated dir>
bun packages/backend/src/benchmark/role-aligned/role-cli.ts replay --out <仓库外运行目录> --queries <queries.json> --usage development|pilot --store <冻结 Store> --model <model.gguf> --native-manifest <manifest.json> --roles <dir> [--roles-restated <dir>] --annotator <名称> --disclosure <披露> [--roles-independent] [--queries-sha256 --queries-revision --case-count]
bun packages/backend/src/benchmark/role-aligned/role-cli.ts score  --out <同一运行目录> --queries <queries.json> [--dev-labels <labels.json>] [--pilot-labels <目录>] [--labels-independent]
```

`replay` 没有 labels 参数。`score` 先验证 manifest 与各排名的 digest 和“完整、有序、无重复”，通过后才读取 labels；失败或被篡改的运行不会被评分，缺 query、多 query、未知 Practice、内容摘要不符的标签是协议错误，不是 miss。向量缓存仅在模型、编码合同、threads、native manifest 与全部被测代码 digest 完全相同时复用。原始 query、角色样本、labels、向量与运行产物保存在仓库之外。

## 6. 补采 pilot 的清单（已按此执行一次，结果见 verification §26.10）

取得真实任务来源后，按此顺序做；每一步都在看到任何条件排名之前完成。

1. **采集**：24–40 条真实任务，写成 `pilot-queries.ts` 的 intake 文件（`formatVersion: 1`，`usage: "pilot"`；每条含 `taskCluster`、`language`、覆盖类别 `categories`、来源说明与 `collectedBlindToTargets`）。来源只能是真实发生过的任务（自己或他人的真实请求、issue/PR 描述、真实提问）；不得打开目标 Practice 后改写，`perturbation` 类型只能作负对照，校验器会拒绝它作为 pilot 任务。
2. **校验与冻结**：`checkPilotIntake` 报告重复、非盲采集、独立任务簇数、五类覆盖与语言分布；它生成 replay 读取的 `queries.json` 及其 SHA-256（作为 `--queries-sha256`）。有 error 不得冻结；warning（簇数不足、缺某一类、没有中文）要写进结论的限制中。
3. **角色标注**：另一个只看 query 原文的人写 `author` 的 spec（可用 `--out-restated` 同时产出等义重述对照）。标注者看不到目标、labels 与任何排名；`--roles-independent` 仅在满足这点时才能设置。
4. **replay**：`--usage pilot`，跑完全部条件并保存完整排名。
5. **相关性标注**：第二个独立评审者读 canonical 内容，按协议 v2 写每个 query 一个标签文件（`pilot-labels`），不看系统身份与排名；需要补判时匿名合并各条件前 K、打乱顺序后评审，结果只作补充审计。
6. **score**：`--pilot-labels <目录> [--labels-independent]`。只有这一步之后才可能得到 `pass`；任何一项独立性、样本量或覆盖可比性不满足，结论至多是“不确定”。

`pilot-queries.ts` 只检查可检查的部分，不能证明一个任务确实是真实的；`source.description` 是采集者的陈述，由评审者判断。
