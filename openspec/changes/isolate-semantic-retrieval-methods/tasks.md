## 1. 独立算法合同与稳定基线

- [x] 1.1 按 design.md §10 的明确迁移表，用 LSP references（不可用时以调用搜索和 typecheck 补足）核对 semantic Profile、projection、reader、services 和 artifact 构造器的生产/测试/benchmark 调用面并完成切换；以不存在未处理调用者和转发别名作为完成证据，不把关键旧符号的去向留给实施时重新设计。
- [x] 1.2 按 design.md §1–3、§8 建立 representation.ts 的 PracticeVectorProjection、EmbeddingInput、DocumentVector 及独立 query 输入/向量类型，方法合同限定为 VectorRetrievalMethod，并用 createVectorExecution 绑定 Profile；canonical Practice 不增加向量属性。恢复 single-vector 的完整文档/完整 query 配方，以数值排序与不分句行为验证，不用固定 hash 或源码断言。
- [x] 1.3 将多视角算法迁入 methods/multi-view，公开方法 ID 为 multi-view-vector；单向量目录为 methods/single-vector，两者不相互依赖。把表示类别命名为 channel、具体编码单元命名为 EmbeddingInput；用既有局部证据、body max/mean、跨 clause 平均和全量后取 K 覆盖证明公式不变，诊断保持内部能力。
- [x] 1.4 按 design.md §7–9 的调用链和签名，reader 接收本次 scorer 并返回全部候选，query helper 负责编码，query service 保留 canonical/snapshot/top-k 和 finally 释放。以两方法真实排名、无 eligible 时不编码 query，以及异常/retry 后资源释放的行为覆盖验证。

## 2. 方法绑定的派生索引与语料身份

- [x] 2.1 将通用 corpus digest 改为 canonical 内容身份并版本化，解除 ProjectContext/keyword 对向量投影的依赖；验证同内容下切换方法不改变 keyword 排名、winner 选择或重新构建 keyword index。
- [x] 2.2 按 design.md §5、§12 将方法配方纳入 Profile，区分 corpus、index schema、完整 projectionDigest 与单输入 inputDigest；迁移 Store-local、complete/progress/cache 到 VectorExecution。验证同方法复用、跨方法不误用、缓存命中不冒充 ready，以及同 inputKey 文本改变或不同 Practice 同名 key 时不会返回陈旧/串用向量。
- [x] 2.3 按 design.md §10、§12 通过 Drizzle/versioned migration 将派生行改为 input_key/channel/ordinal/input_digest、主键为 Practice ID + inputKey，vector BLOB 解码为 DocumentVector.embedding；只对输入行的旧 projection_digest 改名，不误改整体 projectionDigest。验证真实迁移、非法 channel/不完整输入拒绝、单/多编码单元读写与旧索引失效，不改 canonical Pack schema。
- [x] 2.4 保留 Store-local delta/fence 与内容寻址 predecessor/progress 的既有来源语义，原子更新每条 Practice 的完整 inputs 对应向量集合；验证正文编辑按实际 inputDigest 复用、删除清除旧输入、metadata-only 更新不重编码、partial 不计半套输入，以及失败保留 active，不复制发布流程。

## 3. Backend 按请求绑定方法，共享生命周期

- [x] 3.1 query 与 index 协议/client 增加可选 retrievalMethod，默认 single-vector，仅允许 single-vector/multi-view-vector，不接受旧规划名称为别名；以 API 缺省、显式两方法及非法值返回既有错误的行为测试验证，不新增结果诊断字段。
- [x] 3.2 runtime 从固定 Profile 改为 encoding contract，source target 捕获不可变 execution；所有 complete、progress、predecessor、journal 与 status/build/rebuild 使用 target Profile。以同 daemon 交替查询两方法且各自取得正确 artifact 验证，不复制 runtime/模型队列。
- [x] 3.3 保留现有 operation joining、supersession 与调度；以同方法同目标去重、不同方法不互相 supersede、配置切换后旧 operation ID 仍关联原目标的并发行为测试验证。
- [x] 3.4 benchmark 显式选择 single-vector 或 multi-view-vector，不恢复隐式多视角默认；验证内部 N/K trace 属于同一成功 attempt，协议/公开 exports 不泄露诊断。删除只验证源码/导出文本的脆弱断言，保留有效行为覆盖。

## 4. CLI 配置与全部索引入口一致

- [x] 4.1 沿用 config loader 校验 query.retrievalMethod，允许值/默认值复用 VectorRetrievalMethodId 的单一来源；验证缺省 single-vector、显式 multi-view-vector、旧规划值/未知值/null/非字符串拒绝及 keyword 忽略该项，不增加独立方法 flag/环境变量或别名。
- [x] 4.2 semantic query 与 index status/build/rebuild 每次读取配置并显式传方法；以改配置后无需重启 daemon 的真实请求验证，并保留 wait/coverage 与输入验证的既有优先级。
- [x] 4.3 Pack 安装后的 index sync 采用同一方法选择与请求组装；验证成功安装按所选方法建索引、非法方法或派生失败只报告 indexSync failure、不回滚 canonical commit。
- [x] 4.4 按 design.md §10 迁移生产调用者、测试、benchmark 与 package barrels，删除 SemanticDocument/view 家族旧入口及算法专属顶层文件、固定 runtime Profile 和隐式默认组装；通过 typecheck 与两方法真实调用确认切换完整，不保留旧类型/字段转发别名或兼容 shim。

## 5. 端到端验收与文档

- [x] 5.1 按 design.md §12 构建完整 release CLI，在同一批 test-owned canonical Practice 和隔离配置/缓存中走默认 single-vector、显式 multi-view-vector、切回 single-vector 及各自 status/build/rebuild；实际建索引再 query，观察 complete/progress partial/pending、编辑增量与方法隔离，记录模型/语料和未覆盖范围，不把预填向量当真实验收。
- [x] 5.2 由集成负责人验证同一真实 daemon 下切换配置和操作身份稳定，以及显式 keyword 在 semantic 方法配置非法时仍离线可用；只补跨模块证据，不重复已有模块负责人验证。
- [x] 5.3 聚合执行 focused 检索/配置/迁移测试、受影响 Engine/Backend/CLI 包测试与一次 typecheck/lint，记录未通过或未运行项；不重复执行用户已报告的无关失败确认其存在，不缩小验收使其通过。
- [x] 5.4 按实际实现更新中英 query/config/index 指南和维护者说明，方法值统一为 single-vector/multi-view-vector；限定既有多视角 active change 的默认规则适用范围，保留 #236 未满足事实。走读 product.md，执行 openspec strict validation，所有证据满足才勾选完成。
- [x] 5.5 独立完成 design.md 的结构验收与 §11 维护演练：沿 §7–12 走读调用，确认 canonical/投影/编码输入/向量结果分离、向量合同不强加给 keyword 或未来非向量家族、execution/资源/规则归属清晰，以及 §10 旧路径清理；记录源码/类型证据，不以文件数、字符串断言或行为测试通过替代结构审查。

## 6. 用 mode 临时选择实验方法

- [x] 6.1 query 增加 `--mode multi-view-vector`，仅为本次选择实验方法，跳过被覆盖的方法配置；保留 semantic/keyword 行为、等待/输入校验优先级及 Backend/结果 semantic mode，不增加独立方法参数。
- [x] 6.2 补充模式及错误优先级回归，用真实 CLI/模型验证默认与临时实验往返、非法配置覆盖、配置不写回、方法隔离和未知 mode 拒绝。
- [x] 6.3 同步中英 query/config 指南、维护合同与本记录，运行类型/CLI 测试、相关格式检查和 OpenSpec strict validation，记录实际验证及边界。

## 7. 清除 PR 中间格式的迁移兼容

- [x] 7.1 以 main 的单向量 schema 为基线，保留已有迁移身份，三类 semantic index 直接生成到最终结构；删除 #272 中间格式及其向量搬运迁移，不改 canonical 数据。
- [x] 7.2 删除生成器中的历史 SQL 扫描、字段改名映射和事后 CHECK 修补；在 schema 中表达重建时也有效的相同约束，保留共享向量缓存相对 main 的必要迁移。
- [x] 7.3 将真实迁移与旧 reader 夹具改为 main 的旧格式，验证失效/重建、新库、两方法真实查询及生成幂等性，同步维护规则和验收记录。

## 8. 评审后的单次方法对称性与 spec 归档一致性

- [x] 8.1 query 的 `--mode` 取值由 Engine catalog 派生，增加 `--mode single-vector`，与 `--mode multi-view-vector` 同为单次方法选择；配置了实验默认的用户可以单次回到默认方法对照。
- [x] 8.2 CLI semantic 结果（complete/partial/preparing/indexing）以 `retrievalMethod` 回报本次发送的方法，keyword 不含；默认文本只在非 `single-vector` 时显示。Backend HTTP 结果形状不变。
- [x] 8.3 retrieval-query delta 以 `add-project-context-packs` 版本为基础 MODIFIED `Query mode and input validation`，归档须排在其后；修正 `full` channel 只编码不评分的描述；`advance-task-aware-semantic-retrieval` 的多视角限定写入各 requirement 正文，其 `Build and rebuild preserve consistency` 以 `add-project-context-packs` 版本为基础。
- [x] 8.4 同步中英 query/config 指南、维护文档、产品文档与原生 smoke 场景，补充首次使用某方法会单独后台构建的说明；清除继承验收记录中的本机评测目录名。
- [x] 8.5 multi-view 不再编码从不评分的整篇 `full` 表示：文档配方版本升到 6，scorer 把 task-card/body 以外的 channel 视为 typed failure；同步两份 change 的 spec/design/proposal 与编码次数断言。`single-vector` 的 `full:0000` 不变。
