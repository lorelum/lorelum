# #236 核查、有限诊断与当前决定

本文件保存方案依据，不是正式 benchmark 结果。当前实现按 [design 第 8 节](./design.md) 执行；召回补充和适用性判断仍需继续设计，不把未解决案例作为可接受遗留结束。

## 版本与证据

Git 已确认连续关系：baseline `caecc53694d3162bd145e30f3bc5628ee6902b0c` → 排序代码 `63ec6640fd5c52e3130b51fd30cc5db9175e4b98` → benchmark build `09e64be914dc93124230f06483c8dfc4c164a61a` → 交接 `8e97b0094892cc98bacffd718217b0f348bf2259`。后两次提交只改文档。核查和实现使用独立 checkout，原主 checkout、目标分支原 worktree 和既有未跟踪研究稿未被覆盖；没有合并 main 或 rebase。

Benchmark 分支核查到 `bd97b5e922c6fc3286871812e0af44733d9489cb`，比交接报告的 `0ff6d2d` 多了完整结果附件。直接读取 Git 对象，未修改 benchmark checkout、runner、冻结输入或 records。`results/evidence/retrieval-ranking-v2/` 四份附件与对应 `results/records/` 的 SHA-256 全部匹配：

| Run ID（也是附件文件名，不含 .json） | SHA-256 |
| --- | --- |
| retrieval-ranking-v2-baseline-caecc53 | b0406f2951558664ad0c468ee08c254dd8e22ff264f5d213579fd677c590dc25 |
| retrieval-ranking-v2-baseline-caecc53-replay | 0320e00d5b24fdea957663ee00b6ba1c21cedc2367868037ae2f1a88c49c09da |
| retrieval-ranking-v2-candidate-09e64be | 3420b8048233d15184db1e5a06bf641f4ec356d2385de8d48a619ed60523343e |
| retrieval-ranking-v2-candidate-09e64be-replay | 09b29632b76358700886f35d6417a223b010a5a101a6cacea276878b7459c252 |

每份 50 例成功、无 failures；每版与自身 replay 的逐例名单和 score 完全一致。两版每条 query 的候选集合全部相同。core candidate recall 49/50→49/50，final top-5 42/50→48/50，candidate miss 1→1，ranking miss 7→1，scope error 2→2；原 42 条前五命中保留。

六个改善例是 goal-paraphrase、proportionate-validation、reuse-before-build、review-finding、supported-claim 和 issue-pr-readback-pack-context。四条仍命中但 final 下降为 evidence-plan 2→5、tests-from-acceptance 2→5、declare-gap 3→4、issue-pr-upstream-gate-scope-conflict 2→3。

Records 记录的 v2 queries/labels/scorer、4 Pack/97 Practice、Profile、模型、Windows native、N20/K5 与 protocol v1 身份一致。semantic artifact identity 一致原先来自 benchmark verification 自述，本轮在本机又找到该 artifact，并核实全部 97 行 canonical digest 与 projection digest；不把 artifact ID 冒充 SQLite 字节 hash。

## 代码核查

- `query-service.ts` 显式使用 orderedCandidates 采集 candidateIds；`task-relevance.ts` 对新建数组排序，未污染原 reader 数组。旧 6→11 比较了两种名单顺序，不能称原始召回下降。
- snapshot read 在排序前，但 digest 检查原先在排序后的 summary assembly。坏 digest 不会成功返回，但“校验后才排序”的描述不实。本轮先复用现有 assembly 校验，再保存 raw candidateIds、排序、复用摘要截 K。
- SemanticQueryDependencies 已通过 barrel 导出，其 taskSignal 属性确实扩大过公开类型。本轮收回到非 barrel 的内部 trace 测试依赖。
- 第一轮 FTS5 不可用会静默恢复纯语义顺序。旧 Decision 7 有记载，但未满足可复现排序的失败边界。本轮用现有 typed query failure，不添加协议字段。
- 旧 candidate/final 同序断言固定了实现偏差。新回归保护 reader 顺序与 final 顺序可以不同、digest 失败不进入信号计算、失败 attempt 不返回名单。

## 有限诊断得到的原因

维护者先批准 13 条 query 的内部诊断及独立合成对照，随后确认继续局部修复。97 份 Markdown 按 benchmark inventory 原始字节 hash 校验，再通过 canonical/projection digest 与现成索引匹配。只读复制索引，源文件前后 hash 不变；复用已校验的本地模型和 native，不下载、不重建索引、不启动或停止用户 Backend。诊断用独立临时模型进程，结束时关闭。

本机 darwin-arm64、Bun 1.4.2、同模型/Profile 的向量顺序没有完全复现 Windows：13 例中候选集合有 8 例相同，final IDs 有 6 例逐项相同，完整 reader 顺序均有差异。下面本机数值不是历史 Windows 分数，也不是正式新 benchmark。

词面诊断另外固定到历史的同一组 20 候选。逐词 BM25 之和与完整 OR 分数在 1e-9 内相同；复算强度与原生产 signal 在 1e-12 内相同。

| 观察 | 证据与含义 |
| --- | --- |
| `I` 与 `I/O` 碰撞 | limit-investigation 中，两条非目标 Practice 因文档中的 I/O 匹配英文代词，`i` 单词贡献约 3.4155、3.4568，得到约 0.042639、0.05 bonus；正确项 bonus 仅 0.006310。 |
| `decision` 并非主要推力 | 正确项该词分数仅约 0.00000207；“decision 给 Pack 类加很多分”没有得到支持。 |
| 去掉碰撞还不足 | 固定历史池、使用本机 similarity 的反事实去掉 i 后，正确项仅 #11→#10；其他词面命中接走高额加分。 |
| min–max 放大微差 | 独立合成 BM25 0.00000177542667 与 0.00000177296213 被拉成强度 1 与 0，翻转了 0.005 的语义领先。 |
| 全文稀有词不等于任务重要性 | evidence-plan 的正确项 bonus 几乎为零，其他项凭 storage/risky/make/should 得到 0.034–0.05；tests-from-acceptance 的邻居凭 happened 获得约 2.797 的单词贡献。 |
| 单字段修正不够 | 移除 ID/stack 权重未解决剩余错排；只用 applies_when 会损失正文中有用的任务证据。 |
| 现有 keyword 不能直接补回遗漏 | acceptance-direct 的正确项本机 semantic #30、keyword #71。没有依据说简单加词面来源就能补回。 |
| scope 不是只有加分问题 | 两条 forbidden 原始向量位置本机即 #1、#4；关闭词面 bonus 仍在前五。 |

独立合成对照同时验证了普通代词不会代表 I/O 意图、真正要求 I/O 的任务仍应命中，以及中文与英文无词面重合时只能依赖原语义能力。这些是机制验证，不是泛化证明。

## 本轮实现的选择与被否决的中间方案

本轮仅改请求期 semantic 词面信号、校验/观察边界及内部测试接线。保留七个 canonical 字段、原 BM25 字段权重、0.05 上限与同一候选池，不写 query/ID 特例。普通 keyword tokenizer、索引、Profile、CLI envelope 和 harness v1 不改。

曾试用 `BM25/max × 匹配词数/query词数`。对同一批缓存数值的一次局部检查发现 proportionate-validation 从本机 #3 到 #9；更根本的问题是只追加未命中的背景说明，也会稀释原有证据。独立合成测试复现该问题，因此这个中间实现不交付。

最终机制采用 `BM25/max × m/(m+1)`，m 是不同有效匹配词数：一个词至多半额，多个独立词增加证据但边际收益递减；不把极小分差拉满，也不因 query 追加全池未命中的词而降低已有分数。此选择以合成不变量为依据，不扫描参数、不改 0.05，不据那 13 题宣称新 build 已提升。它仍不能理解词的任务角色，质量结论等待独立 benchmark。

## 任务视角试验与下一步

另外比较一个事先固定的候选表示：`title + applies_when`。为避免文档向量的平台差异混入原因，97 条全文向量和 97 条任务视角向量都在同一 darwin runtime 重新编码到临时文件，使用原先缓存的 13 个 query 向量；没有写入 active index，没有给临时视角冒用 ready Profile，也没有融合/权重扫描。

结果不支持直接采用：acceptance-direct 的 raw rank #30→#47，goal-paraphrase #8→#27，proportionate-validation #17→#32；limit-investigation #5→#2。React forbidden 仍 #1，readback 的 forbidden #4→#10，但该例 core 也从 #9 到 #14。以上是同平台两个表示的局部原始排序，不是产品最终排序。

因此本轮不增加该视角或新 Profile。接下来的设计重点应是区分 query 当前动作与背景对象，并判断 Practice 的适用性；不能继续假定缩短文档即可解决。是否需要额外模型/runtime 或持久化变化，须在新方案中明确后再确认实施。召回缺失、剩余排序失败和 scope error 都没有被标记完成。

## 历史记录与交付限制

- 成功 baseline 的合法引用是 v2；旧 v1 路径引用已更正。
- 独立 CLI 观察、旧工件清理和旧“先 strict 后实现”顺序没有足够原始日志；未补写完成。tasks 对无法核实的旧勾选已限定或撤回。
- 旧全量 Engine 有 1 fail、整仓格式检查未通过的历史不能写成全绿；新实现的检查单列在 verification §10。
- 四份结果附件已齐全，不再索取；旧内部打分/参数扫描日志没有已知 path/hash，不编造。临时诊断脚本、向量、query/labels、机器路径和 native build 标识不提交，运行证据在任务拥有的临时目录按 hash 保留。
- 这 50 题已参与方法选择，独立运行仍只是固定回归评测。未见样本由 benchmark 另行维护，本轮不改冻结输入、历史结果或题库 revision。
