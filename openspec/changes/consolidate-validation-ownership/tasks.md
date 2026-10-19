## 1. 契约与工程规则

- [x] 1.1 基于最新 main b9f172f 保存 AGENTS 验证所有权规则和 proposal/product/design、两项 delta；核对真实调用链与待决范围。
- [x] 1.2 严格校验本 change，确认任务与设计完整、不把待用户决定的行为混入实施。

## 2. 日志与配置

- [x] 2.1 收窄 LogSink/serializer 为规范 LogRecord，删除重复 normalize/sanitize，迁移生产及测试 caller；验证日志 context、脱敏、错误、等级、私有位置和失败隔离行为。
- [x] 2.2 trace 文件扫描一次、保留独立 direct/global 窗口；用较早 direct、拥挤 global、跨 trace 及损坏/截断测试验证。
- [x] 2.3 CLI 只保留一份普通生命周期阶段记录，stderr 过滤先于编码；用真实 CLI 与 main/diagnostic 行为覆盖验证 stdout、失败 stack 与阶段证据。
- [x] 2.4 单次 invocation 按需共享 config reader，logging/query/index 所需设置继续各自验证；验证跨 invocation 更新、同次快照、keyword 无关字段隔离、debug 及无效输入错误优先级。
- [x] 2.5 config project/catalog 仅在输入/构造时复制冻结一次，删除等价分支；验证不可变快照、Registry 变更、既有错误与初始化行为。

## 3. 既有内部结果复用

- [x] 3.1 合并函数内 source 入口校验一次，内部组装不再重新 canonicalize；验证 install/upgrade/remove/rebuild 的冲突、损坏输入、revision 和 Store 恢复。
- [x] 3.2 删除 Embedding Service 对已审计生产输入的重复 schema，保留 HTTP 输入与生命周期边界；验证非法 HTTP 输入、合法内部批次、busy/unloaded、取消和恢复。
- [x] 3.3 runtime record 写入单次序列化、大小及结构保证不变；验证有效 round trip、超限/非法记录、私有文件和原子更新。
- [x] 3.4 release 从成功的 native producer 读取 manifest metadata，不重复 source 全文件 hash；验证完整 build、staging 最终 verify/match 与构建失败保护。
- [x] 3.5 博客从 collection 已验证数据投影字段，移除消费端完整 parse；验证 authored content 拒绝、helper 剔除、字段/默认值保真与实际站点构建。

## 4. 集成与交付证据

- [x] 4.1 集成后统一运行受影响测试、typecheck、lint、fmt，并按跨模块风险运行完整 suite；记录真实失败与结果，不重复代理已有有效验证。
- [x] 4.2 以完整 CLI/native 跑真实隔离 query、两种方法 index build/rebuild、get 与模型生命周期，观察正常、pending、错误及清理；不以 unit mock 代替。
- [x] 4.3 用固定公开 fixture、模型、threads、配置和匹配的 clean baseline/changed compiled bundle，比较 query/index 的端到端与完整构建耗时，校验结果一致，记录 workload、样本、方差及未覆盖范围。
- [x] 4.4 同步实际支持的 current specs 和受影响维护/中英文用户说明，完成 docs/链接及 OpenSpec 校验；逐项核对 design 待决 D1–D6 仍保留原行为。
- [ ] 4.5 审查完整暂存 diff、扫描秘密与本地产物，Conventional Commit、push、按模板创建 PR；读回 head/base/commit、性能正文与 CI 状态，并向用户汇报已做/待决的行为差异。

## 5. Verification Evidence

记录日期：2026-10-19；基线 `b9f172f`，本 change 工作树实现。记录只对应下面实际执行范围。

- `bun test --timeout 15000`：1841 pass、19 skip、2 fail，1862 tests / 246 files、73.81s。两项失败是新增 fixture 的 `[eval]` 无法从仓库根解析 workspace 包；未把它们当业务错误回退。将 child cwd 设为其 CLI source 目录，并修正 readonly/table case 类型后，`bun test packages/cli/src/main.test.ts packages/cli/src/log/runtime.test.ts --timeout 15000` 为 **42 pass / 0 fail**、524 assertions、2.42s。生产代码未因这次修正改变；其余套件沿用前次有效结果，没有声称修后重跑全套。
- `bun run typecheck` 通过；`bun run lint` 为 0 error、21 warning。初次格式检查列出 4 个改动文件，仅格式化这 4 个文件，定点 check 通过；其余文件沿用全库格式检查结果。
- `bun run build:cli` 完成当前平台完整 bundle，native producer 命中验证缓存，staging 完整校验通过；不是仅有二进制的 cli-only。`bun run build:site` 完成 client/SSR 与双语 prerender。
- 基于该 site production preview，真实 Chromium 查看英文列表与英/中文新文章，确认标题、作者、日期、封面与正文；两种语言分别检查亮/暗主题并留截图，页面 errors 为空。没有修改视觉样式或上线部署。
- 临时真实日志/runtime 探针：一条记录 2 次 record JSON 编码、原 context 1 次遍历；trace 每行解析 1 次；runtime record 写入 1 次完整 record 编码，读回相等。对比此前同链路观察的 4/2/2/2 次；凭据排除与普通 payload 保留均成立。计数不等于端到端收益，未加入永久调用次数断言。
- `openspec validate consolidate-validation-ownership --strict` 与 `openspec validate --specs` 通过，current specs 23 passed / 0 failed。两项 delta 已同步；本轮不归档，未来归档不得重复添加 ADDED requirements。
- 最后将仅用于 draft 判断的消费改为直接读取已验证 `draft`，只为实际 route payload 创建投影；随后 blog **133 pass / 0 fail**、783 assertions，site typecheck 与完整 build/prerender 通过。此前浏览器记录的内容/样式保证不因这一等价字段读取失效。
- 从真实完成的 native bundle 复制 staging，在副本 executable 原位改一个 byte，最终 `verifyNativeArtifact` 返回 `sha256-mismatch`；原 bundle 未改动。不是只验证 manifest metadata，也未向真实构建进程注入并发替换。
- 两个独立只读 AI CR 分别覆盖日志/trace 以及 CLI/config/Store/runtime record；均未发现当前生产链路可达的 P1/P2 问题。reviewer 未运行检查，不能把静态结论当运行证明。
- 完整编译版在隔离 Store/cache 完成两种方法的 build/query、rebuild、get、非法 input、keyword、模型 unload/reload 和 logs。恢复原用户配置后，Backend 停止时的 keyword 成功；模型 ready 后 `maxWaitMs: 0` 得到 indexing / exit 1，接受的 operation 继续到 ready，再 query 得到 complete，get 返回合成 Practice 正文。最终 Backend/model 均为 ready，实测 device=cpu、dimensions=384、threads=4。用户 Store 与配置未改动。
- 准备阶段修正临时驱动的本地 install 语法为 `--path`，并让 Mac 临时 HOME 使用 realpath；没有为测试放宽保留中的祖先 symlink 规则。用户路径 smoke 修正了驱动把 Backend ready 写成 running、为 operation 误带 cache-root 的断言/参数；已经成功的启动/提交未重复执行。同步修正中英文 index 说明：operation 按 ID 观察，不接受 `--cache-root`。这些失败不计入性能样本，不是产品容错修改。

## 6. Compiled Performance Evidence

结论：此次 ready query 均值下降约 2%–4%，中位数改善小于 1.5%；**没有测到足以支持“完整 index 构建提速”的收益**。不把一次样本里的尾部改善归因全部归于本变更，不承诺稳定百分比。

### Method

- A 为干净 `b9f172f`（包含 #286 batching），B 为本 change CLI/Backend/Engine/config/log 实现；两者均执行官方完整 `build:cli`，matching native runtime 相同。后续 site-only 可见性读取优化不进入 CLI bundle。
- macOS arm64、Bun 1.4.2、CPU、4 threads、384 dimensions；固定模型 SHA-256 `18e8ce8ce834790618e90d26bed465cca87362076f3042eb0d8eee0732596f59`。默认端口 26186，info 持久日志，startup/request/shutdown 分别 10000/5000/5000ms；准备好的固定模型显式指定，benchmark 禁止下载。
- 一个 Pack / 48 条合成 Practice，`--no-project`，独立 HOME/Store/cache。ABBA 为 A/B/B/A；每 block、每种方法先 3 次 query warmup，再每个 ready metric 20 次 fresh compiled CLI，合计每版本 40 次。计时从 spawn 至 stdout/stderr 收集与 exit 完成，包含整个 CLI 生命周期；没有生产代码计数插桩。
- 每 block、每种方法再做 2 次新空 `--cache-root` 的 build，合计每版本/方法 4 次。模型驻留，derived cache 与共享 vector cache 均为空；时间包括编译 CLI 提交及 authenticated client 观察 ready。观察间隔上限 20ms，本次所有 16 次 build 都在 CLI 返回后第一次观察已 ready，未把 accepted 当完成。
- query 正常使用配置里的 method，不用显式 vector mode 绕过 method loader；top-k=5。每种方法各自的完整 query data 与 baseline 相同；get 轮换前 20 个生成 ID，除 variant 路径外 canonical data/来源相同。30 组 distinct 结果键完成比较，不比较两种方法彼此的排名。
- 原始数组、完整 48 文件、Pack YAML、五个 query、各 block 与生命周期统计保留在本机 `/tmp/lore-ownership-benchmark-results.json`，不提交原始运行路径/trace。没有交付一个新的长期 benchmark framework；下面给出可重建语料与方法。

### Results

单位 ms；SD 为总体标准差，百分比是耗时变化，负数更快；p50/p95 线性插值。保留全部样本，没有删除离群值。

| Metric | n/version | A mean ± SD | B mean ± SD | Mean change | p50 A / B | p95 A / B |
| --- | --- | --- | --- | --- | --- | --- |
| query single-vector | 40 | 90.91 ± 10.27 | 88.97 ± 10.08 | -2.13% | 87.60 / 86.31 | 106.43 / 95.93 |
| query multi-view-vector | 40 | 90.81 ± 10.62 | 87.14 ± 1.31 | -4.05% | 87.55 / 86.82 | 109.11 / 89.83 |
| index status single-vector | 40 | 82.19 ± 6.94 | 80.24 ± 2.21 | -2.37% | 81.07 / 79.62 | 86.60 / 85.17 |
| index status multi-view-vector | 40 | 81.44 ± 1.14 | 80.81 ± 0.87 | -0.78% | 81.21 / 80.68 | 83.45 / 82.07 |
| full build single-vector | 4 | 820.73 ± 4.76 | 819.16 ± 1.30 | -0.19% | 821.02 / 819.65 | 826.21 / 820.27 |
| full build multi-view-vector | 4 | 719.19 ± 4.72 | 722.93 ± 2.43 | +0.52% | 717.39 / 723.25 | 725.77 / 725.62 |
| get | 40 | 85.67 ± 4.85 | 84.74 ± 1.59 | -1.08% | 84.46 / 84.65 | 90.78 / 87.43 |
| backend status | 40 | 77.64 ± 1.86 | 80.92 ± 16.26 | +4.23% | 77.18 / 77.21 | 81.08 / 89.44 |

A 的两个 query block 均值分别为 93.28/88.54（single）与 94.26/87.36（multi），B 为 88.63/89.31 与 87.08/87.19。A 首 block 的尾部较大；B backend status 也出现高方差。因此不把 mean/p95 点估计写成稳定加速保证，完整 build 样本尤其少。此次主要交付是减少重复工作与职责、减少日志噪声，而非另一次 30% 级 query 提速。

没有测量大语料、冷模型/下载、并发吞吐、ProjectContext、增量 index 或 Linux/Windows；48 条短 Practice 的默认 5s 成功不代表先前 97 条真实语料的冷启动 timeout 已解决。

### Workload

Pack：`name: ownership-bench`、`version: 0.1.0`、`description: Fixed public workload for redundant-work measurement.`。每个 topic 生成 i=0…7，文件 `practices/<topic>-<i>.md`，UTF-8/LF：

```md
---
id: ownership-bench.<topic>.case-<i>
title: <title> <i>
stage: implementation
tech_stack: [typescript, bun, sqlite]
applies_when: <title> during an engineering change, case <i>
severity: <i % 3 == 0 时为 warn，否则 info>
---
# <title>

<body>

Case <i>: inspect the real input, keep canonical user data, exercise a successful path and one relevant failure, and report the observed outcome. <title>应当在实际责任边界完成，而不是重复扫描受控结果。
```

| topic | title | body |
| --- | --- | --- |
| verification | 代码验证与回归 | Validate the changed behavior through the real command. Preserve useful regression coverage. Test boundaries and error recovery before claiming completion. |
| authentication | 认证与会话边界 | Authenticate external requests once at their real ingress. Preserve nonce proof, bearer credentials, identity isolation and session ownership. |
| transactions | SQLite 事务一致性 | Keep canonical changes within one transaction. Publish complete snapshots atomically. Preserve journal recovery and never mix old and new revisions. |
| configuration | 配置与默认值归属 | Load one configuration document for one invocation. Each consumer validates only its own settings. Keep explicit options and unrelated keyword behavior independent. |
| indexing | 索引构建与安全恢复 | Build a complete semantic index from a stable snapshot. Keep the previous ready artifact on failure. Corrupt cached vectors must become cache misses and be encoded again. |
| workflow | 工程任务与审查 | State the scope and acceptance before implementation. Reuse existing interfaces. Observe the actual output and report verification limitations without inventing results. |

五个 query 循环为：“如何验证代码修改并避免回归？”、“认证和会话边界应该在哪里校验？”、“SQLite 更新如何保持事务一致？”、“配置加载与默认值应该由谁负责？”、“索引失败后如何安全恢复？”。使用官方 `pack install --path` 安装后准备两种方法的 ready cache；按 Method 的 block 顺序切换 daemon，写 method 配置后再执行 `query ... --top-k 5`、`index status`、`get` 与 `backend status`。完整 build 每次使用全新 cache-root，通过 `index operation <id>` 或匹配实例的 client 观察 ready，不能把排队/准备状态记为完成。
