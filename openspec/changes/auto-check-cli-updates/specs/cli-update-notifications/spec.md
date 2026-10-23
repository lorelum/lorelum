## Purpose

定义 Lorelum CLI 在已有 Agent 会话渠道中异步发现新版、由后续调用投递结果的合同；通过当前版本分区限频与版本对去重避免等待和重复催促，同时保留显式检查、安装同意、机器 JSON 与故障恢复边界。

## ADDED Requirements

### Requirement: Eligible calls poll local state without awaiting release network
自动发现 SHALL 由合格原生会话 Hook、omp main catalog bridge 或已有有效 host/session 绑定的成功 semantic query/get/list/pack.list 响应触发。调用方 SHALL 只读取本地状态、按需启动独立短生命检查并立即沿原结果返回，MUST NOT 等待发行网络或轮询 worker 完成。没有 ready 结果时 MUST 不输出等待或检查中状态。显式 query --mode keyword MUST 保持离线，即使有绑定也 MUST 不 poll、不启动、不投递或领取提示。没有绑定的终端、CI 和 portable Skill，及 help/describe/--version/update/backend 等管理命令 MUST NOT 参与。工具 Hook、SubagentStart、compact 和普通模型请求 MUST NOT 自行 poll 更新；被工具执行的合格 Lorelum 命令独立按自身绑定参与。

#### Scenario: The first eligible query encounters slow release network
- **WHEN** 有有效既有会话绑定的 query 成功，自动状态到期且发行网络很慢
- **THEN** CLI SHALL 启动短生命检查后返回原 query 结果，MUST 不等待网络或 worker 完成

#### Scenario: No later call occurs
- **WHEN** worker 保存结果后没有后续可投递调用
- **THEN** 系统 MUST 不主动发起模型 turn、定时轮询、通知或补送；原任务 SHALL 保持不变

#### Scenario: Management and unbound commands run
- **WHEN** 用户执行管理命令，或检索调用没有有效既有 host/session 绑定
- **THEN** 自动功能 MUST 不启动检查、不投递或领取提醒，不得用 cwd/PID/invocation ID 猜会话

#### Scenario: Keyword remains offline even with session binding
- **WHEN** 用户或 Agent 带有效会话绑定执行 query --mode keyword
- **THEN** 命令 MUST 不访问自动更新状态、不启动 worker、不投递或领取提示，保持既有离线行为

### Requirement: Checks use current-version partitions and bounded asynchronous attempts
检查状态 SHALL 按本机用户、默认频道、平台与规范化当前执行 CLI 版本共享。成功结果有效且检查间隔 SHALL 为成功后 1 小时，失败间隔 SHALL 为失败后 15 分钟；worker 启动失败、领取后退出或未完成 MUST 至少保留领取时的 15 分钟冷却。到期由下一次合格调用原子领取检查额度，MUST 不由定时服务唤醒。worker SHALL 在全部发行分页和响应读取合计 30 秒内完成或取消，只保存完整合格结果，不投递或领取提醒。未到期的并发调用 MUST 不再启动同分区检查，也不得等待持有者。CLI MUST 不向发行服务发送 session ID、项目、Pack 或任务数据。

#### Scenario: Concurrent calls share a check
- **WHEN** 同一用户、频道、平台和当前版本的多个进程同时发现检查到期
- **THEN** 最多一个 SHALL 领取额度并启动 worker，其他调用 MUST 返回而不等待其网络结果

#### Scenario: A newer CLI starts while an older worker exists
- **WHEN** 0.1.0 的 worker 尚在运行，用户已使用 0.1.1 执行合格命令
- **THEN** 0.1.1 SHALL 立即具有自己的首次检查资格，MUST 不沿用 0.1.0 的冷却或待投递结果；旧 worker MUST 只更新其原分区

#### Scenario: A page or response body fails
- **WHEN** worker 离线、限流、读取失败或整次查询超过 30 秒
- **THEN** worker MUST 不发布部分列表或最新结论，父调用 MUST 不受影响，下一次尝试 SHALL 受 15 分钟失败间隔约束

#### Scenario: Success is reused within its interval
- **WHEN** 同分区完整结果取得不足 1 小时
- **THEN** 合格调用 SHALL 只读取有效缓存，不为自动发现重新联网；间隔到期后没有调用时 MUST 不自行启动检查

### Requirement: Notification deduplication is scoped to the current and target version pair
自动提醒 SHALL 按本机用户下规范化的 currentVersion/targetVersion 版本对最多发出一次，不按宿主、session、频道、平台、项目或 Store 重新领取。版本身份 MUST 去除可选 tag 前缀和 build metadata，不同 prerelease 序号仍为不同版本。新 target SHALL 可在原对话提示；CLI 升级后的新 currentVersion SHALL 具有独立提醒起点，即使目标相同且仍更新也可提示。CLI MUST 只以执行进程自身版本判断当前版本，不读 PATH 或维护可被新旧进程互相覆盖的全局当前版本。重启、同版本重装或切换宿主 MUST 不重置；降级回曾用版本 SHALL 使用该分区历史。不得定期清空通知记录。

#### Scenario: An ignored target does not repeat
- **WHEN** 当前执行版本 0.1.0 已提示目标 0.1.1，用户未更新且换了宿主或对话
- **THEN** 同一版本对 MUST 不再提示或追问

#### Scenario: A later target is shown in the same conversation
- **WHEN** 当前仍是 0.1.0，原对话曾提示 0.1.1，后续有效结果发现 0.1.2
- **THEN** 同一对话 SHALL 可领取一次 0.1.0/0.1.2 提醒，MUST 不要求新建对话或补播中间版本

#### Scenario: Upgrading partway permits another notice
- **WHEN** 0.1.0 已提示 0.1.2，用户安装 0.1.1 后 fresh check 仍发现 0.1.2
- **THEN** 后续可投递调用 SHALL 可提示一次 0.1.1/0.1.2，不清空 0.1.0 的历史

#### Scenario: Two consumers race
- **WHEN** 两个进程同时投递同一 currentVersion/targetVersion
- **THEN** 最多一个 SHALL 原子领取通知记录并输出，其他保持安静

### Requirement: Ready notices are delivered only through an Agent-readable channel
调用方 SHALL 只在后续调用读取到有效 ready 结果、重新比较目标高于本进程当前版本、完整 prompt 不超过 400 字符且存在 Agent-readable 渠道时领取并输出。合格成功文本与受支持 Hook SHALL 可投递；普通机器 JSON SHALL 只可启动检查，MUST 不增加 envelope/data/diagnostics 字段、不夹带文本、不通过 stderr 提示，也 MUST 不领取提醒版本对。自动功能 MUST 不改变原业务状态、错误、成功内容或退出语义。Agent 文本渠道 SHALL 沿用既有有效 host/session 绑定，MUST 不新设主／子 Agent 鉴权或要求额外环境绑定。

#### Scenario: JSON initiates discovery but preserves the notice
- **WHEN** 带会话绑定的 query --json 遇到到期检查，或已经有新版本 ready
- **THEN** 它 SHALL 可启动检查但 MUST 保持原完整 JSON、不领取通知；后续合格文本或 Hook 仍可投递该版本对

#### Scenario: Ready output uses the executing version
- **WHEN** 有缓存或旧 worker 结果，新的 CLI 进程准备输出
- **THEN** CLI MUST 仅消费自身版本分区，并重新比较和生成版本文本，不输出旧 currentVersion 的过期提示

#### Scenario: A bound child uses ordinary text
- **WHEN** 子 Agent 通过既有有效会话绑定执行合格文本命令
- **THEN** 该文本 SHALL 可按相同版本对规则投递，MUST 不将环境绑定解释成 Main 身份证明

### Requirement: Prompts defer update discussion until the current task is complete
提醒 SHALL 只包含固定本地 prompt、当前及目标版本、安装未改变事实和 lore update 入口，最多 400 字符，不含远端 release body、动态指令或脚本。运行时 prompt SHALL 自包含地明确先完成当前用户任务，任务总结可顺带告知一次；MUST NOT 自动执行检查或安装、立即追问升级、阻断检索或为提示另起模型 turn。更新指导 MUST 不写入 Skill 或其他常驻 Agent guidance；没有结果、没有更新或自动失败时 MUST 不向用户输出更新警告。

#### Scenario: An agent receives a notice during work
- **WHEN** 后续 Lorelum 文本或 Hook 提供更新 prompt
- **THEN** Agent SHALL 继续当前任务，只可在任务总结中顺带提及新版与 lore update，不自行开始升级工作流

#### Scenario: Automatic discovery never exercises install capability
- **WHEN** 自动发现任意来源 CLI 的新版
- **THEN** 自动路径 MUST 不下载 archive、扫描或改写 executable、调用安装器、停止 Backend、修改 Pack 或执行 --apply

### Requirement: Local failures and disabled settings preserve existing workflows
用户级 updates.autoCheck SHALL 为布尔项，缺省 true；false SHALL 停止后续自动启动和投递、保留历史，不影响显式检查。设置无效或不可读取，状态只读、损坏、不兼容或繁忙时，自动功能 MUST 静默跳过，MUST 不删除历史重建、不无状态重复提示、不要求修复才能检索。状态 SHALL 属于本机用户，不属于项目、Pack、Store 或 Backend；已经启动的请求不保证可撤回，但 worker MUST 不自行发出提示。

#### Scenario: The user disables and re-enables discovery
- **WHEN** 用户关闭自动功能后重新开启
- **THEN** 关闭期间合格调用 MUST 不启动或投递；开启后已领取的同版本对 MUST 不重播，显式更新 SHALL 始终可用

#### Scenario: State is busy or damaged
- **WHEN** 自动状态不能立即安全读取或写入
- **THEN** 原命令和 Catalog MUST 正常沿原语义返回，自动功能 MUST 不等锁、不删库、不改成每次联网

### Requirement: At-most-once attempts do not imply acknowledgement
通知记录 SHALL 在输出前持久化。系统 MUST 将保证表述为最多一次发出尝试，不是确认宿主、模型或人类阅读。领取后崩溃、会话取消、响应丢弃、截断或 Cursor 首轮不可见 MUST 不释放记录、自动补送、弹窗或改用机器 JSON/stderr 投递。不同用户、机器及用户主动删除状态不共享此保证。

#### Scenario: The consumer exits after reservation
- **WHEN** 通知记录已经提交，但进程在宿主收到响应前退出
- **THEN** 后续调用 MUST 不重复同一版本对；它可能未被人类看到，用户仍可主动检查

### Requirement: Explicit updates preserve fresh results and installation consent
显式 lore update 与 lore update --apply SHALL 保持每次重新查询、原输出 envelope、状态、错误、安装来源校验和恢复合同，MUST 不受自动设置／间隔限制、不使用自动缓存、不消耗或重置通知。自动发现 SHALL 复用既有频道、平台、资产完整性和 SemVer 规则，不建议降级；手动 --channel 只影响那次调用。

#### Scenario: Explicit checking fails while automatic cache exists
- **WHEN** 自动检查曾成功，用户离线执行 lore update --json
- **THEN** 显式命令 MUST 返回既有 update.unavailable，不用自动缓存回答成功；自动历史保持不变

#### Scenario: Default channels differ
- **WHEN** 当前 CLI 分别是稳定版或预发布版
- **THEN** 自动发现 SHALL 分别沿用 stable 或 prerelease 默认选择，且候选具有匹配 archive 与同 release 的 SHA256SUMS
