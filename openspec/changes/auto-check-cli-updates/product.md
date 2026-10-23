# 异步发现 Lorelum 新版，任务完成后再顺带告知

自动检查只负责提供更新信息，不把升级变成当前任务。用户仍通过 lore update 查看新鲜结果，通过明确的 lore update --apply 或原安装方式更新。

## 正常路径：第一次调用启动，后续调用带回结果

用户安装 Lorelum Plugin 后，新建／恢复会话，或在有宿主会话绑定的 Agent 工具中执行 semantic lore query、get、list、pack list。该调用只做本地判断：检查到期就启动独立短生命 worker，不等待发行服务；原 Catalog 或检索结果照常返回。

worker 完成后只保存候选，不通知宿主、不启动模型请求。下一次有投递渠道的 Lorelum 调用读到 ready 结果，才把提示放在成功文本或 Hook 上下文中。没有下一次调用就没有提示；worker 仍在运行时不会为了“等结果”拖住 query。普通模型请求本身不持续轮询 CLI。

| 事情 | 默认行为 |
| --- | --- |
| 何时访问发行服务 | 合格调用发现本机用户、频道、平台、当前 CLI 版本的检查已到期 |
| 检查成功后 | 保存完整结果，1 小时后才可再次启动 |
| 检查失败后 | 保持安静，15 分钟后才可再次启动 |
| worker 网络预算 | 全部分页与响应读取合计最多 30 秒，不占用父命令的网络等待 |
| 新 CLI 版本第一次运行 | 使用新版本分区，立即具备 fresh-check 资格，不沿用旧版本冷却或待投递结果 |
| 何时提示 | 后续可投递调用看到有效结果，且本机用户未提示过这对 currentVersion/targetVersion |
| 何时安装 | 只有用户明确要求，沿原有手动更新路径执行 |

1 小时和 15 分钟是低打扰与发现速度之间的起步默认，不是测量结论或通知时限。持续有调用时，发现大约需要“检查间隔到期＋worker 完成＋下一次可投递调用”；停止使用时不后台定时检查。启动失败或 worker 异常退出也会保留失败冷却，避免每次 query 都重新拉起进程。

## Agent 收到什么，人类看到什么

例如当前执行 CLI 为 0.1.0，worker 查到 0.1.2，下一次成功 Agent 文本响应在原结果之后附一段本地产生、最多 400 字符的 prompt：

~~~text
Lorelum update available: 0.1.0 → 0.1.2. Nothing was changed.
Finish the user's current task first. In the final summary, you may mention this update and lore update once. Do not run it automatically or ask to upgrade now.
~~~

这不是新的用户任务或必须处理的错误。Agent 先完成用户任务，结尾可顺带说明：

~~~text
另外，Lorelum 有新版 0.1.2；需要时运行 lore update 查看。本次没有改动安装。
~~~

Agent 不立即问“要不要现在升级”、不执行检查或安装、不停止检索，也不为更新单独发起一轮模型请求。用户主动询问后，才沿手动路径处理。没有更新、结果未就绪或自动失败时，不输出“已是最新”、等待状态、网络警告或 stderr 兜底提醒。

prompt 只包含固定本地文字及经过版本规则约束的版本号，不带远端 release body、安装脚本、动态指令或假定可原地更新的命令。

## 忽略、后续发版与升级后的具体结果

去重单位是“当前执行版本 → 目标版本”，不是永远屏蔽目标，也不再限制每段对话一生只能提醒一次。

| 事件 | 可见结果 |
| --- | --- |
| current 0.1.0 首次发现 target 0.1.1 | 后续可投递调用提示一次，用户不回应也不追问 |
| current 仍是 0.1.0，换项目／宿主／对话仍发现 0.1.1 | 不再提示这一版本对 |
| current 仍是 0.1.0，之后发现 0.1.2 | 可以在原对话提示一次新的 0.1.0 → 0.1.2，不必另开对话 |
| 0.1.0 已提示目标 0.1.2，用户安装 0.1.1 | 新执行的 0.1.1 立即可启动新检查；结果 ready 后可再次提示 0.1.1 → 0.1.2 |
| 同版本重装、重启或 build metadata 改变 | 不形成新提醒额度 |
| 降级回曾使用的版本 | 使用该版本原有历史，不清空其他版本分区 |
| 一次检查跨过多个发行版 | 只提示最新合格候选，不补播中间版本 |

版本号按 SemVer precedence 处理，去除可选 v 前缀及 build metadata。状态不记录一个会被并发新旧进程反复覆盖的“全局当前版本”；每个进程只认自己的 toolVersion，不读取 PATH 来猜自己已升级。不同系统用户、不同机器及用户主动删除状态不共享去重保证。

## 哪些调用参与

- 原生 Hook：Codex、Claude Code、WorkBuddy、ZCode 的 SessionStart 带有效 session_id，且 source 精确为 startup/resume；Cursor 的原生 sessionStart 带有效 session_id 或 conversation_id。它们只本地 poll，不能等网络。compact／clear／fork 继续原 Catalog 路径。
- Agent 工具：使用既有有效 LORELUM_HOST_KEY 与 LORELUM_HOST_SESSION_ID 绑定的成功 semantic query、get、list、pack list 可 poll。文本是 Agent-readable 渠道，可附提示；JSON 只可启动检查，不附字段、不投递、不领取版本对。
- 本阶段不为上述工具文本建立主／子 Agent 鉴权；现有绑定说明这是 Agent 会话渠道，不保证是 Main。子 Agent 通过正常带绑定文本调用也可能取得一次提示，全用户版本对去重仍生效。
- omp：仅明确 Main 且具有实际 session ID 的合格 catalog bridge 请求可 poll。返回独立 updateNotice，仅在当前自然模型请求临时提供一次，不写 Catalog 快照。子 Catalog、shell/read-hints 不检查更新。
- query --mode keyword 保留既有离线合同，即使有会话绑定也不 poll、不启动 worker、不投递或领取提示。
- PreToolUse、PostToolUse、SubagentStart、compact 和普通模型请求不触发更新 poll；工具 Hook 仍只做原本身份传递等工作。
- 没有绑定的终端、CI 与 portable Skill 不推测宿主或对话。--version、help、describe、update、backend 等管理命令不参与自动发现。

原生 Hook 的 ID/source 以真实 payload 验收为准，但不要求增加证明 Main 的新身份机制。缺失或无效身份保持原结果。Cursor fire-and-forget 不保证首轮可见；不为此逐请求重播。

## JSON、频道与安装来源

本次不扩展普通机器 JSON。现有 envelope、diagnostics 及各命令 data 保持不变；JSON 调用不会抢走应交给后续文本或 Hook 的提示。自动检查也不改变成功／错误、preparing 等原有业务状态。

自动频道沿用当前 CLI：稳定版只看 stable；预发布版看 prerelease，包含合格稳定版。候选必须有匹配平台 archive 和同 release 的 SHA256SUMS，完整分页成功后才保存，不推荐降级。手动 --channel 仅影响那次命令。

默认 installer、自定义安装、源码或包管理器都只获得只读信息。自动路径不扫描安装身份、不下载 archive、不停 Backend；是否可 --apply 仍由显式命令验证。lore update 和 --apply 始终现查，不使用自动缓存、不受自动间隔和开关限制，也不消耗提醒版本对。

## 关闭与失败

用户在既有用户配置中关闭：

~~~yaml
# ~/.lorelum/config.yaml
updates:
  autoCheck: false
~~~

缺省 true。false 停止后续自动 worker 启动及提示，保留历史；已经发出的网络请求无法撤回，worker 写结果前后都不产生提示。重新开启不重播已领取的版本对。不自动改配置，不新增配置命令。

| 情况 | 原任务与实际下一步 |
| --- | --- |
| 离线、限流、超时、分页失败 | 原调用不等网络，worker 不发布部分候选；15 分钟后有新合格调用才再试，需要马上确认可主动 lore update |
| 状态只读、损坏、未知版本或繁忙 | 跳过自动工作，不删库、不要求修复才能检索；手动更新入口可用 |
| worker 启动失败／退出 | 保留失败冷却，不把 query 变成重试循环 |
| 两个进程并发 | 共享同一版本分区的检查占位；同一版本对只有一个提示领取者 |
| 提醒提交后宿主退出／丢弃上下文 | 可能没有人看到，不释放额度或补送 |
| 没有后续可投递调用 | 不主动打扰，ready 结果等待有效期内的后续调用；不通过 JSON 或系统通知补送 |

保证的是 Lorelum 对同一版本对最多发出一次提示尝试，不是宿主、模型或人类确认阅读。任务内通知、送达确认、自动安装、自动回滚、跨机器同步和常驻更新服务不属于本功能。
