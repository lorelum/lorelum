## Context

用户路径见 [product.md](./product.md)，行为合同见 [通知规格](./specs/cli-update-notifications/spec.md) 与 [集成增量](./specs/agent-integration/spec.md)。本设计采用“本地 poll、短生命 worker、后续投递”，不将发行网络放进正常调用等待链。

实施基线的已核对责任：

- update/update-command.ts:createCliUpdateCommand 每次经 listReleases 和 selectUpdate 现查；只有显式 --apply 才检查安装来源并运行安装器。自动路径不需要 findManagedInstall。
- update/release-client.ts:listReleases 拥有完整分页、元数据、官方 notes URL、SemVer、频道和平台 archive/SHA256SUMS 检查；version-catalog.ts 拥有 normalizeVersion、defaultChannel、releaseTarget、selectUpdate。
- main.ts:run 负责普通响应与 Hook 分流，create-program.ts:executeCommand 在 handler 成功后经 renderResult 输出；这是成功命令接入本地 sidecar 的位置，不应给每个 handler 复制更新逻辑。
- output/protocol.ts 的 envelope 与 diagnostics 均 additionalProperties:false，diagnostics 仅含 traceId。因此本次不往普通 JSON 随意追加 prompt，不把 notice 塞入命令 data。
- hook/command.ts:createHookEndpoint 组装服务；各 host endpoint 解析自己的事件并返回原生 envelope；runHook 对 endpoint 故障整体降级。更新错误须在 sidecar 内消化，不能令成功 Catalog 进入 fallback。
- practice-hints/backend.ts 已通过 SessionRef schema 使用 LORELUM_HOST_KEY/LORELUM_HOST_SESSION_ID。此为既有 Agent 渠道绑定，不是 Main 身份鉴权；不新增绑定类型或猜父会话。
- omp 的 catalog extension 在 lifecycle 后刷新 Catalog、逐请求复用 metadata；其 CLI bridge 对旧 catalog 请求严格白名单。更新字段必须独立消费，不能混进快照。
- CLI backend/control-commands.ts:createProcessBackendSupervisor 根据 isCompiledEntrypoint 选择 source/compiled argv。更新 worker 复用这一启动判断，不启动 Backend。
- @lorelum/config 拥有 loadConfig/resolveLorelumPaths；项目已用 bun:sqlite。自动状态不进入 LocalStore、项目配置或 Engine。

本轮修改该 active change 的旧方案：不再同步等待 2 秒，不采用统一 24 小时冷却，不做永久 target 去重或每会话所有版本合计一次。只保留满足新合同的结构，不叠加旧状态与新状态两条路径。

## Goals / Non-Goals

**Goals:** 正常检索不等待发行网络；新旧 CLI 并发互不重置；新目标与升级后的新起点可提示；同版本对跨宿主不重复；机器 JSON 完整不变；所有自动错误不改变检索和 Catalog。

**Non-Goals:** 无 daemon、定时唤醒、安装 epoch、送达确认、持久消息队列、全局当前版本、主／子身份鉴权或新环境变量；无自动安装、Backend 更新接口、release workflow 修改及跨机器同步。

## Decisions

### 1. 完整调用链：本地判断、异步执行、后续消费

普通命令现状：main.run 选择 registry/format，createProgram 经 executeCommand 调用 handler，handler 完成 query/get/list/pack.list 用例，再由公共 renderer 输出完整 text 或 JSON；失败走原错误映射。

目标只在成功响应的公共边界增加本地 sidecar：

1. main 的 composition 提供 updateNotice 回调。它只允许 semantic query/get/list/pack.list，使用既有 SessionRef schema 验证环境绑定；显式keyword、其他命令或无效绑定直接结束。query模式来自已解析的调用参数，不靠命令文本猜测。
2. executeCommand 在 handler 成功且 exitCode=0 时调用回调。回调调用 service.poll(format === "text")，只等待本地 config/SQLite 与进程启动步骤，不等待网络。
3. poll 读取当前版本分区的 snapshot 一次；若检查到期则原子领取 reservation，启动 worker 后继续返回，不读取 worker 的完成状态或反复 poll。
4. 若读取时已有仍有效的 ready 候选且 deliver=true，重算是否高于本进程版本，先渲染并检查 400 字符预算，再原子领取版本对；成功后返回 prompt。deliver=false 不领取。
5. 文本在原成功内容后加两个换行及 prompt；JSON 沿原 renderer 输出，回调不得向 stdout/stderr另写内容。错误、help/version/describe 的提前返回不进入该回调。

worker 经独立进程的内部 dispatch 运行，查询完整发行列表，按原规则选最高候选，然后在自己的 reservation 仍匹配时更新状态，关闭连接并退出。它不携带 session、不领取通知、不接触父输出，也不主动发起模型 turn。

后续合格命令或 Hook 才有机会看到 ready 结果。没有下一次可投递调用就不提示；本设计不承诺单靠首次 SessionStart 即完成更新告知。

原生路径仍为 parseHookInvocation → createHookEndpoint → runHook → host endpoint → readCatalog → 原生 envelope。endpoint 先成功读取 Catalog，再在合格事件调用本地 poll(true)，可选 notice 独立拼接；sidecar 失败只略过 notice。

OMP 仍由 lifecycle 后下一次 context 刷新 bridge。带自动字段的 main catalog 请求调用同一 poll(true)，只读到现成结果才返回 updateNotice。extension 在当前自然模型请求一次消费，不因为 worker ready 增加每模型请求 bridge 调用；同会话正常工具文本也可消费。

### 2. 模块与接口

新增或调整的真实责任如下，不预建 Provider/Repository 框架：

| 文件 | 责任 | 不负责 |
| --- | --- | --- |
| update/auto-check.ts | createAutoUpdateService：本地poll、有效性、版本比较与prompt；runAutoUpdateWorker及私有启动函数：短生命进程、argv、deadline与最终写入 | 会话鉴权、SQL、父调用等待网络 |
| update/update-state.ts | openUpdateState：两表schema、检查reservation、版本对claim及连接关闭 | 宿主协议、发行查询 |
| update/update-settings.ts | loadAutoUpdateSetting：读取用户 updates.autoCheck | 写配置、项目覆盖 |

worker启动、运行与poll同处auto-check.ts，共享自动检查的私有参数与编排，不单独创建仅拆分文件的worker层；后台分支不领取提醒。release-client/version-catalog保持发行与版本规则唯一所有者，update-state单处定义持久化时间间隔，宿主不复制这些值。

最小内部接口复用既有UpdateChannel；缓存只需合格候选版本，不存无需消费的notes或Release对象，不另建Session类型：

~~~ts
type UpdateCheckKey = {
  channel: UpdateChannel;
  target: string; // 平台发行目标
  currentVersion: string; // normalize 后且无 build metadata
};
type UpdateWorkerPayload = UpdateCheckKey & { token: string };
interface AutoUpdateService {
  poll(deliver: boolean): Promise<string | undefined>;
}
interface AutoUpdateState {
  readReady(key: UpdateCheckKey, now: number): string | null | undefined;
  reserveCheck(key: UpdateCheckKey, now: number, token: string): boolean;
  reservationMatches(key: UpdateCheckKey, token: string): boolean;
  finishCheck(key: UpdateCheckKey, token: string,
    candidateVersion: string | null, checkedAt: number): boolean;
  failCheck(key: UpdateCheckKey, token: string, failedAt: number): boolean;
  claimNotice(currentVersion: string, targetVersion: string, now: number): boolean;
  close(): void;
}
~~~

service选项提供currentVersion、target、now、readConfig、openState、startWorker与测试用rootDirectory。生产默认路径在该模块明确组装，普通CLI传入runtime.readConfig复用单次调用的配置快照；worker独立读取自己的设置。startWorker(job)返回void或仅表示本地spawn完成的Promise，不提供等待后台结果的Promise。state不暴露SQL句柄，readReady返回undefined表示没有有效成功结果，null表示有效检查无更新。

一致的生产组装示例，省略既有日志和测试注入：

~~~ts
const updates = createAutoUpdateService({
  currentVersion: toolVersion,
  target: releaseTarget,
  readConfig: runtime.readConfig,
});
const updateNotice = (command: string, format: OutputFormat,
  options: Readonly<Record<string, unknown>>) =>
  agentUpdateCommands.has(command) &&
  !(command === "query" && options.mode === "keyword") &&
  hasValidExistingSessionEnvironment()
    ? updates.poll(format === "text")
    : Promise.resolve(undefined);
// createProgram使用此回调；Hook通过services.autoUpdate注入同一poll能力。
~~~

hasValidExistingSessionEnvironment 复用已有 SessionRef schema与同名环境字段；不导入 practice-hints 的 Backend client来判断身份。service 不知道 host/session，也不保存 session。每次 poll 惰性打开 state，在 finally 关闭；worker 自己独立打开并关闭，网络期间不持写事务。

### 3. 两表状态与版本分区

路径是用户 ~/.lorelum/updates.sqlite，不受 --store-root 影响。新库在短事务中创建两表并设置 user_version=1；未知非零版本或损坏只跳过，不自动删除重建。没有发布过的本功能状态需要从旧规划三表迁移，实施不创建旧 notified_sessions/notified_versions。

~~~sql
CREATE TABLE checks (
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  current_version TEXT NOT NULL,
  next_check_at INTEGER NOT NULL,
  reservation_token TEXT,
  checked_at INTEGER,
  candidate_version TEXT,
  PRIMARY KEY (channel, target, current_version)
) STRICT;
CREATE TABLE notified_pairs (
  current_version TEXT NOT NULL,
  target_version TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (current_version, target_version)
) STRICT;
~~~

current_version与通知target_version统一经normalizeVersion并去掉+build；prerelease段保留。检查target是平台，通知target_version是目标版本，二者不得混淆。缓存保存相对当前版本可用的最高合格candidate_version或null；null表示成功检查没有可提示更新，checked_at=null才是无成功结果。完整分页与notes URL检查仍在release-client完成，不因不持久化notes而弱化验证。

reserveCheck用BEGIN IMMEDIATE：若now<next_check_at则不领取；否则写随机reservation_token与next_check_at=now+15min，提交后才启动worker。并发只有一个启动；busy_timeout=0，锁繁忙立即跳过，不等、不重试。启动失败可调用failCheck记录本次失败完成时间；进程被终止或没有最终写入时，保留领取时的失败冷却，不需要PID状态或后台回收。

worker先用reservationMatches确认任务仍有归属；finishCheck/failCheck仍以完整UpdateCheckKey和token条件更新，防止查询期间被替换。私有argv只做JSON与字段类型解码，不复验父进程已确定的版本、频道、平台或token格式；持久reservation是归属依据。成功写候选、checked_at=完成时间、next_check_at=完成时间+1h；失败保留原成功数据但不延长其有效期，next_check_at=失败时间+15min。token不匹配即丢弃完成结果。单条条件UPDATE本身原子；连接finally close，不跨网络持事务。

poll只使用checked_at距当前不足1h的候选，过期不投递；失败不能把旧结果当新检查。当前进程只访问自身版本分区，缓存版本仍重新与本进程版本比较。旧worker可完成旧分区，但不会生成“你当前仍是旧版”的提示，也不更新全局current。

通知领取使用单条 INSERT ... ON CONFLICT DO NOTHING，由 notified_pairs 的唯一主键保证原子性，不外包显式事务，已有则 false；无 host/session 全局额度，也不清空全表。候选和完整prompt准备好、deliver=true时才 claim，提交后才允许输出。JSON或状态失败不消耗版本对。领取后崩溃允许漏发，不撤销记录。

新建目录／文件使用用户状态的私有权限；不审计既有用户目录的symlink、hardlink、uid或权限。兼容schema按user_version识别，不逐次枚举表名；字段类型由SQLite STRICT表负责，不重复执行行schema校验。SQLite错误静默跳过，不自动修复数据库或定期清理历史。同版本重装不重置，降级回旧版使用原有分区；不同机器或用户主动删库不共享保证。

### 4. worker 启动、取消与发行完整性

launch 根据既有 isCompiledEntrypoint(Bun.main) 模式组装 argv：compiled 使用当前 process.execPath 加内部 worker 参数；source 使用 process.execPath、当前 source entrypoint 和内部参数。不能从 PATH 找另一个 lore，也不通过 shell 拼接。工作参数只包含 CheckKey 与 reservation，用户根由现有路径规则解析；不传项目、Pack、session或凭据。

main.ts 的 import.meta.main 分流在普通 run 前识别 runAutoUpdateWorker(args)；私有 worker 参数不是 public registry 命令，不改变 help/describe。source/compiled 识别复用现有模式，不为更新计算整个源码 build hash或启动 Backend。

进程使用Bun.spawn的detached:true，stdin/stdout/stderr均ignore并unref；同步启动异常由poll捕获。父调用不等待close/exit，不保留会拖住退出的pipe或timer。启动失败不输出告警，沿reservation/failCheck冷却。正常代理环境继承，不新增代理框架或token配置。

worker 自行读取自动设置；禁用／坏配置时静默退出，绝不投递。整次发行操作使用同一个30秒 AbortSignal，包括全部分页和响应body；取消或任何页失败都不发布部分候选。完成写入也只能匹配原reservation；数据库繁忙就退出，不开启状态重试循环。deadline是终止本次工作，不是定时唤醒。

release-client 保持原四参数 seam，在末尾增加可选设置：

~~~ts
listReleases(channel, target, request = fetch, firstPage = apiUrl,
  options: { signal?: AbortSignal } = {}): Promise<readonly Release[]>
~~~

未传signal时显式路径仍使用原每页10秒语义；worker传共享30秒signal，页/body后和最终返回前检查取消。保留完整分页、循环检测、官方URL、metadata、asset及SemVer规则，不改用/latest、不引入第二套解析器。最高候选与高于当前版本的判断复用version-catalog；自动不调用managed-install。

成功1h、失败15min与worker30秒是起步政策选择，不是性能结论。验证记录父命令完整冷/热延迟及worker完成情况，不把预算或fixture当真实发行服务的性能改善。

### 5. 原生入口、普通文本与 OMP

普通成功命令 gate 仅允许 semantic query/get/list/pack.list，使用已有环境 SessionRef。已接受的retrieval-query与docs/cli/query.md要求keyword离线，因此query --mode keyword即使有绑定也完全不poll、不启动worker或领取提示；公共回调需接收已解析mode。此处有意不判 Main/Sub：用户已有绑定就是Agent-readable渠道。PreToolUse只继续既有身份注入，本身不poll；SubagentStart、PostToolUse与管理命令不检查。JSON调用poll(false)，不修改严格envelope或diagnostics；不以stderr绕过渠道限制。

原生Codex/Claude/WorkBuddy/ZCode仅有效session_id且source精确startup/resume时poll；Cursor原生sessionStart用既有优先级：字符串session_id优先，否则conversation_id，再经SessionRef schema。compact、clear、fork、未知source保持Catalog-only。这里不再要求猜测Main或额外证明主身份；实际字段映射由宿主验收确认，缺失ID静默略过。

成功Catalog最多4000字符，notice最多400，两换行分隔总4402；不挤占Catalog额度，不加宿主未知字段。固定prompt先检查长度后claim，无法完整表达就不消费，绝不截断版本。普通文本沿相同本地prompt规则附加，不改变handler业务结果。

OMP bridge 保留旧请求，扩展形状为：

~~~ts
{ event: "catalog", agentKind?: "main" | "sub",
  sessionId?: string, checkUpdates?: true }
// 新响应只在poll获得ready并claim后附带：
{ additionalContext?: string, updateNotice?: string }
~~~

仅agentKind==="main"、有效sessionId、checkUpdates===true时poll(true)；自动字段错误或sub仅略过sidecar，不使有效Catalog失败。旧请求不新增notice；shell/read-hints维持原协议。extension实际Main ID用ctx.sessionManager.getSessionId()，不是child handoff中的源头Main ID。

extension新建／恢复／实际会话切换为下一次Catalog刷新设置一次资格；同ID的compact/tree/branch只刷新Catalog，普通模型请求不为结果再跑CLI。资格随该次请求消耗，不await网络；首次请求可能只启动worker，后续合格工具文本或生命周期刷新才消费ready。

扩展catalog请求仅在退出0、单行合法且精确{}时去掉新增字段回退一次legacy请求。该空对象不证明CLI一定旧，也可能是真实Catalog故障；保留有限回退是混合版本兼容取舍。非零、超时、取消、畸形响应、普通旧请求均不回退，也不逐请求retry。

updateNotice校验字符串及400字符上限，不重复解析发行schema。当前generation单独pendingNotice，在context返回前同步取走并清空，多个并发callback也只一人消费；加入ownMessages身份集合便于后续移除，但不进metadata快照／持久transcript。取消、切换、退出清空，晚到generation不匹配丢弃；原用户同文消息不删。合法Catalog不因坏notice而丢弃。

运行时prompt自包含地明确“先完成用户任务，结尾可告知一次；不自动执行或立即追问”。不向Skill增加重复的常驻指导，不新增系统通知、用户批准门或为提示另起模型turn。

## Risks / Trade-offs

- [worker ready后没有可投递调用] → 不保证用户马上获知；不定时轮询，显式lore update始终可用。
- [新旧CLI同时活跃会各自检查] → 接受分区带来的额外有限请求，避免全局lastSeen互相重置，并满足升级后fresh check与新提醒起点。
- [新target可在同一长对话出现] → 这是取消每会话总额度的有意行为；同版本对仍只一次，Agent必须等任务总结而非即时打断。
- [领取后响应丢失或Cursor首轮不可见] → 只保证发出尝试，不承诺人类已读，不释放额度补送。
- [状态损坏／繁忙或worker被杀] → 原路径不受影响；不删历史、不等待锁，下一次合格调用按冷却决定是否再试。
- [后台继承环境不等于传递任务数据] → 网络仍只访问发行元数据，固定请求不含会话／项目；worker输出完全隔离。

## Migration Plan

1. 用本change的更新方案、规格和任务替换旧同步／三表／会话额度设计；实现只创建两表，不并存旧路径。接受规格时协调显式版本管理的Hook禁令范围，不修改旧active change来制造接受状态。
2. 先交付state/settings/service与worker，再接公共成功响应、原生Hook与OMP；显式update及安装代码不迁移、不读自动缓存。
3. 聚焦测试覆盖两种间隔、分区／build规范化、并发claim、reservation迟到、JSON不消费、keyword完全不参与、worker父子进程分离、共享deadline及混合版本回退。
4. 隔离用户根和Store跑真实CLI进程，慢网络下观察父命令返回，等worker完成后由下一文本消费；验证同target不重播、新target同会话可提示、升级到中间版后同target可再提。
5. 在本机实际可用宿主走正常已安装路径，记录原生ID/source、后续工具响应、compact与OMP一次性行为；不可用宿主／Windows明确未验，不要求全部宿主可用才完成实施。
6. 更新对应中英站点与内部Hook/config合同，运行比例适当的回归与strict validate；Skill源与生成副本不含更新指导。不上线Release、不改release workflow或执行真实安装。

结构验收核对：service不知道session，state是唯一持久化所有者，worker不claim，宿主不复制版本规则，网络不持事务，JSON不扩展，旧同步等待和会话额度被删除。维护演练：调整间隔只涉及自动政策与相关测试/合同；旧worker晚到只影响自己reservation，不影响新binary分区或已投递历史。
