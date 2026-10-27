# 配置诊断统一需求评审

## 1. 需求摘要

让使用 CLI 和宿主 Hook 的用户在第一次遇到配置问题时，直接知道来源、修改目标和规则；消费方明确选择默认值继续工作时，如实说明实际采用值，并留下可检索的本机证据。统一的是“报告配置失败”与“明确降级并说明真实结果”两种行为，不是给所有输出追加结构化诊断。query、Backend、embedding 的终止错误与 logging 的非阻塞降级是本阶段适配案例。

## 2. 信息完整度评估

- 明确：用户、问题、query/Backend 终止与 logging 非阻塞边界、用户文件不得自动改写、正常配置不增加噪声。
- 原始需求与合同冲突：#229 要求 `error.details`；#230 要求默认机器 notice。维护者在 #259 明确选择已有 code 与 actionable message，CLI 合同采用不含 details 的 envelope v2。本方案据此替换这两项验收，不宣称照原清单实现。
- 交付明确：完成统一方案与实现、验证后形成一个集成 PR；CI 成功后按授权合并，不包含独立发布。没有需虚构的上线日期或性能目标。

## 3. 产品视角分析

优先解决“错在哪里”和“实际上用了什么”。query、Backend、embedding 只在实际消费设置时校验；logging 可独立回退，不把其他 section 的坏值误报为 logging.level 错误。已被显式参数覆盖而按现有规则不消费的设置，不借本次诊断变更重新校验。

## 4. 业务流程分析

终止配置错误沿原错误码和退出码返回；用户修改或移除指出的设置后重试同一命令。logging fallback 保留原业务结果，现场提示修改位置，后续 logs/feedback 只读取实际留存的记录。不得靠重试、重建目录、重置配置或启动无关服务“修复”配置。

### 正常用户路径与可用结果

用户配置 `query.maxWaitMs: nope`，执行 `lore query "release validation" --json`，在连接 Backend 前得到 exit 2。stdout 只有原形状的一个 envelope，例如：

```json
{"protocolVersion":2,"toolVersion":"…","command":"query","diagnostics":{"traceId":"…"},"ok":false,"error":{"code":"query.config-invalid","message":"Invalid query.maxWaitMs in ~/.lorelum/config.yaml: expected an integer from 0 through 120000; received a string. Correct or remove this setting, then retry."}}
```

默认 text 的 stderr error 区块显示同一消息和 trace。用户改成合法整数或移除设置，然后重试同一 query。`backend.requestTimeoutMs: 0` 对 `lore backend start` 同样指出完整 key、文件来源和 `1` 到 `120000` 的整数范围；若真正被拒绝的是环境变量，指向变量名而非误导用户只改 YAML。原文件不被覆盖，失败配置不用于启动新 daemon；既有 Backend 不被诊断流程停止。

用户配置 `logging.level: noisy`，执行 `lore pack list --json`，仍得到原成功 envelope、data 和 exit 0。stderr 一行，例如：

```text
lorelum: persistent logging level fell back to info; effective level is info. Invalid logging.level: must be one of "error", "warn", "info", "debug". Correct or remove logging.level in ~/.lorelum/config.yaml. Received string.
```

用户可继续使用本次结果；只需改成合法 level 或移除该项，无需初始化或重启 CLI。`--debug` 下提示 persistent fallback 为 info、effective 为 debug，该次实际收集 debug，下一次调用仍按用户文件解析。合法配置配合 `--debug` 不提示 fallback。

有可用日志时，用户复制 trace 后执行 `lore logs --trace-id <trace-id> --json` 或 `lore feedback draft --trace-id <trace-id> --kind bug --include-logs debug --json`，可读到真实 `logging.level-fallback` warning。未收集 debug 时仍可保留原 `debug-records-not-found`；不能把 fallback warning 当成 debug 已收集的证据。

| 支持情境 | 现场结果与下一步 |
| --- | --- |
| malformed YAML 被 query/Backend 实际消费 | 唯一终止消息给出文件、类别和可靠行列；不再重复同因 logging warning；修复 YAML 后重试 |
| malformed YAML 仅影响 logging，业务成功或无关失败 | 一条 fallback stderr；保留原成功或原失败，修复 YAML 恢复设置 |
| 显式参数错误，同时 YAML 损坏 | 原 usage 错误优先，另提示 logging fallback；不连接 Backend |
| `--debug` / `--log-level error` | 不隐藏 fallback；debug 明确实际等级，stderr 等级不改变收集与该设置提示 |
| sink 不可用 | 保留现场 fallback 与既有 sink-failure 提示，分别说明不同事实；不承诺已保存记录 |
| 自动 Hook | 原宿主 envelope 和 no-op/exit 0 策略保持；只在 stderr 提示、以 Hook 自身 trace 留存，不增加普通 CLI metadata |
| daemon startup | 持续等级回退 info，记录 source=backend 与 instanceId；父进程忽略子进程 stderr，不承诺现场提示或按 CLI trace 读到 startup 记录；按 Backend source 排查 |

缺失/空配置继续采用默认值而不提示。root shape、文件大小/类型及读取错误说明真实类别，不伪造 YAML 行列。daemon 原有日志安全预检与启动拒绝边界保持。

## 5. CLI / 交互分析

默认 text 与 JSON failure 的人类消息保持同文。JSON stdout 仍为一个完整 envelope；非阻塞提示写 stderr，包括 `--json` 和 `--log-level error`。这条提示不是新的机器协议，机器调用方仍只按已有稳定字段分支。Hook stdout 不增加任何字段或 prose。

## 6. 后端与架构分析

YAML loader 拥有文件类别与可靠位置，消费方拥有字段和约束；通用 fallback 函数只处理调用方明确接受的配置失败并返回实际采用值，终止消费者直接传播。logging adapter 只补 level 与 `--debug` 的关系。错误适配器保留事实，呈现层组织已知事实；内部类型不经 Backend HTTP 传输，不扩展公共 envelope。现有规则真源继续决定范围、枚举和 precedence，不为诊断新增 query 校验阶段或复制已成立的检查。

## 7. 测试与风险分析

最大风险不是 parser 能否报错，而是重复输出、把非阻塞降级改成失败、错误关联到另一 trace、或让输出看似精确但来源不可靠。验收必须同时覆盖 text/JSON、正常与失败业务、`--debug`、`--log-level error`、不可用 sink、Hook ABI 和 daemon startup；依赖 mocked sink 的单测不能代替真实日志写入与读回。

## 8. 冲突与待确认项

本提案明确建议接受以下替换：

| 原要求 | 本方案的验收 |
| --- | --- |
| #229 公共 subject/source/reason/expected/received 字段，依赖 error-details transport | 内部保留 typed facts；唯一公共 `error.message` 说明定位和修正，保留 code；不提供机器配置诊断字段 |
| #230 默认 `diagnostics.notices`，JSON 机器读取成功 notice | 单次 stderr 人类提示；原 JSON 不变；真实 fallback 事实通过既有本机日志读取 |
| 任意非秘密值默认全部回显 | 保留安全来源、已知 key 与实际规则；必要时展示 owning validator 明确允许的数值 scalar，不回显非法 logging 字符串，不搬运整段 YAML、URL credential、异常 snippet 或任意对象 |
| 所有后续 evidence 统一解释缺失原因 | 只新增真实 fallback 记录；不重定义 logs/feedback 缺失状态，也不在没有记录时推断原因 |

以上替换定义统一实施的产品边界，不把旧 Issue 的勾选状态当成行为证明；不能同时声称满足被替换的旧字段要求。

## 9. 可观察验收标准

1. `query.maxWaitMs: nope` 和非法 `query.minCoveragePercent` 定位到完整 key、配置文件和整数范围，返回 `query.config-invalid`、exit 2，text/JSON 消息一致。
2. 非法 `query.retrievalMethod` 显示现有 catalog 的允许值；keyword 和显式方法覆盖继续忽略原本不消费的 method 错误。
3. Backend timeout、embedding 的嵌套字段、unknown field、环境变量和内部 override 的终止错误能区分来源、已知字段及实际失败规则，仍为 `backend.config-invalid`、exit 2，不启动失败配置的 daemon。共享 method loader 的 index 调用保持原语义；Pack canonical commit 后的配置错误仍只形成 `indexSync.failed`，不回滚或提升为顶层失败。
4. YAML syntax、root shape、文件过大/类型不符/无法读取分别说明已知类别。只有 parser 确实给出时显示一基行列；不从 snippet、exception prose 或字符串搜索猜位置。
5. 无效 `logging.level` 的 CLI/Hook 持续等级回退 info，`--debug` 下 effective 为 debug；单行 stderr 提示包含 key、允许值、fallback 与实际等级、来源及修正方向，普通成功与无关失败均提示一次。
6. 同一文件级错误已作为 query/Backend 终止错误呈现时，不再输出相同 YAML cause 的 logging warning；独立的 logging field 错误不因另一个配置项或业务错误而被吞掉。
7. 可用 sink 中每次 fallback 只有一条 `logging.level-fallback` 本机 warning，CLI/Hook 使用自身 trace，后续 trace logs/feedback 能读回真实记录；daemon 只记录自己的 source/instance，按 `--source backend` 查看，不承诺 trace feedback 可找到、不借用启动 CLI 或其他请求的 trace。
8. sink 不可用时保留现场 fallback 提示与既有 sink-failure 提示，各说明不同事实；不新增“已保存”承诺，不改变业务结果或缺失证据词汇。daemon 的既有安全预检仍是其原边界。
9. 正常/缺失/空配置（含 `logging: {}`）不提示 fallback；非法 logging section 和 level 均有准确提示；成功与失败 envelope 均保持 v2 原 schema、resource 与 trace；Hook raw stdout、原有 no-op/fail-open、普通 stderr 日志等级和 request-scoped debug 的其他语义不变。
10. 已有用户配置保持逐字不变，缺失配置时保留原显式 Backend start 的初始化流程；不新增永久诊断状态、缓存、公共字段、flag 或重复约束表。安全消息有界且单行，凭据与原始 parser/Zod 异常不得进入公开输出。
11. 复用 fallback 行为不要求修改通用逻辑来识别 section 名或 Issue；用不属于生产配置的单测 fixture 验证同一配置失败可直接传播，或在消费者明确提供默认值后返回该值和原失败。未知代码异常原样传播；logging 既有可用性兜底只说明“无法采用设置”，不猜造 YAML/key/位置。

## 10. 事实 / 推测 / 建议

- 已确认事实来自 CLI/config 文档、diagnostic-logging 与 retrieval-query 当前 spec、#229/#230、#259 的维护者决定。#251 仅是整合背景，不是实施基线或已接受合同。
- 假设：本阶段没有需要默认机器化配置细节的真实 consumer；维护者意见与现有 CLI 主路径支持此判断。未来出现具体 consumer、所需字段和无法用既有 code/日志完成的动作时，再独立讨论最小按需接口。
- 建议：接受本文件的 message + stderr + 本机记录产品路径，以[设计](design.md)作为统一实施入口，不并行恢复旧 transport。

## 11. 建议后续链路

按[设计](design.md)与[tasks.md](tasks.md)实施并验证两种共享行为，再完成一个集成 PR 的审查与 CI；所有实施项仅在对应证据完成后勾选。
