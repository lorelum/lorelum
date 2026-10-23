# Issue #246 设计证据与验证记录

核查日期：2026-10-23。这里只记录本次观察和验证限制，不把进度句混入长期合同。

## 仓库观察

- generic 安装入口为 `skills/lorelum/SKILL.md`，六个 Plugin 为 `plugins/{claude,codex,cursor,omp,workbuddy,zcode}/lorelum/skills/lorelum/SKILL.md`；每份均有同目录 `references/semantic-query-recovery.md`。实际是七份，不是 Issue 创建时的五份。
- `packages/cli/src/feedback/agent-guidance.test.ts` 的 `skills` 数组枚举 generic 和五个传统宿主，遗漏 omp；`plugins/scripts/plugin-layout.test.ts` 的传统宿主清单也不覆盖 omp。原测试通过不能证明全部分发目标一致。
- 五个传统宿主的 Skill 正文除 description、Catalog 段落中的宿主名外基本一致；generic 没有 host 正文的 lease 章节；omp 还有 child Catalog 与 Main read-hint 特有段落。
- recovery 的差异包括标题、Catalog 复用提醒、`state`/`data.state` 文字和 lease 描述。omp 另有真正的过期行为：读取 `error.recovery` 并后台 backoff。
- 当前 `openspec/specs/backend-runtime/spec.md` 的 `Actionable cross-command Backend errors` 和 `Guarded stop preserves safe refusal` 要求完整 message 指导、不传播 compatibility policy、deferred 不后台重试；`packages/cli/src/output/protocol.test.ts` 的 `rejects the removed recovery field with the exported schema` 覆盖字段移除。按当前合同纠正 omp reference，不将其解释为合法 host overlay。
- Codex manifest、`hooks/hooks.json` 与 `packages/cli/src/hook/{command.ts,hosts/codex.ts,services/catalog.ts,pack-catalog.ts}` 显示：原生 Skill 路径与 metadata Hook 分别装配；Hook 不产生 cache Skill locator。Cursor 的首轮注入限制与 omp child 默认规则见当前 agent-integration spec。
- `.github/workflows/ci.yml` 已执行 `bun test`；因此新增维护端只读检查测试即可覆盖 CI，不需要为此修改 release/publish workflow。

## 官方宿主资料

- [OpenAI Build skills](https://developers.openai.com/codex/skills)：访问时跳转到 ChatGPT Learn；说明先加载 name/description，选中后再读完整 SKILL.md，显式和隐式调用是原生 Skill 行为。普通 Hook 中出现路径不等于已注册 Skill。
- [OpenAI Package your plugin](https://developers.openai.com/plugins/build/plugins)：说明 Plugin 包装 skills 目录，原 `.codex-plugin/plugin.json` 仍作为兼容格式支持。本方案保持仓库现有 manifest，不顺带迁移新分发格式。
- [OpenAI Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills)：区分显式触发、隐式匹配和 negative control；生成字节一致不能证明实际触发成功。

其他宿主在本轮依据仓库当前合同和 artifact 比较，没有重新宣称通过宿主官方新版本兼容认证。

## 差异归因复核

- **真实政策差异**：omp Main/child Catalog 与源头 Main read hints 有 agent-integration 合同、CLI bridge 和 extension 测试依据；保留为适配。
- **真实宿主入口**：现有 description 中的 `/lore` 与 Claude 原生命名空间由各宿主入口决定；保留 metadata，不因此复制共享检索规则。
- **共同规则的不同文案**：generic 与五个传统宿主的 Catalog 段落都表达“复用可见 Catalog，任务确需发现且缺失时 list 一次”。Cursor 的首轮时序需要验证，但这一事实不要求另一套正文。宿主名、reference 标题、同义句与 `state`/`data.state` 叙述不成为适配项。
- **generic lease 是历史漏同步**：`6d4da47` 将长任务 lease 指导加到旧 `plugins/lorelum/skills/lorelum/SKILL.md`，未加 generic 正文；`4f9634a` 已在 generic recovery reference 补 lease 维护。现行 CLI lease 命令只有 TTL/opaque ID，没有 host 参数；因此统一按任务条件使用，不保留 host-only 开关。
- **omp recovery 是旧规则带回**：`4f9634a` 移除 `error.recovery` 并更新共享/传统宿主 reference；后续 `fc04528` 新增 omp 时仍带入旧字段和后台 backoff。当前 Backend 合同与协议测试排除了该规则，必须纠正，不能称作 omp 特色。

## 上游问题单独记录

`gh issue view 35648 --repo openai/codex --json number,title,state,closedAt,comments` 返回 OPEN、closedAt 为 null。可见评论含自动重复候选提示及用户对 selected-Skill-relative reference 丢失目录的额外复现；没有已修复证据。[上游 Issue](https://github.com/openai/codex/issues/35648) 仍独立跟踪。

本方案不改 cache 路径，也没有测量失败读取次数，因此不声称缓解该症状。若要报告改进，应在相同 Codex 版本、模型、Plugin 版本和安装方式下记录对照任务、首次读取目标及失败次数，不能用“目录减少”或一次成功推断效果。

## 设计阶段基线（实施前）

已完成：Issue 正文与上游状态只读核查、七份 Skill/reference 差异核对、当前 specs/Hook/配置测试源检查、Sol high 独立方案复核；复核未发现阻断问题。

本轮执行结果：

- `bun test packages/cli/src/feedback/agent-guidance.test.ts packages/cli/src/output/protocol.test.ts plugins/scripts/plugin-layout.test.ts`：11 pass、0 fail、196 assertions。它是现状基线，不是新生成器或完整宿主覆盖通过的证据。
- `openspec validate generate-host-native-skill-guidance --strict`：通过。
- 逐条解析本 change 的 Markdown 本地链接并检查目标存在：11 条通过。
- `git diff --check`：通过；新文件另做空白检查。工作树新增仅为本 change 的规划文件，未编辑实现。

未执行：生成器实现、产物迁移、任何真实宿主 clean install/update、locator 原型、跨平台安装或 Codex 路径失败率对照。本轮没有修改用户的 Plugin 安装配置、发布或评论 Issue。

## 实施验证记录

日期：2026-10-23；平台：macOS arm64；工作分支：`swift-moth`。以下结果属于本次未提交工作树，不替代各宿主安装和升级矩阵。

### 实现与静态检查

- 增加 `scripts/skill-guidance/` 的共享正文、单一 recovery、有限 profiles、纯渲染、产物读写与 CLI 入口；没有新增依赖、runtime locator、Hook 变更或用户安装目录。
- `bun run skills:generate` 生成 generic 与六个宿主的十四个原路径文件。生成前 `--check` 对旧产物列出十四条漂移并返回 1；生成后 `bun run skills:check` 返回 0。
- 渲染测试覆盖共享源修改传播、普通 Catalog/lease 共用、omp 特有 child/read-hint、恢复内容一致、插槽错误与确定性。产物测试独立扫描实际 Plugin artifact，故意缺 omp profile、新 host 无适配、缺 Skill/reference 与人工改产物均失败；check 不写文件，write 不清理其他资源。
- 将旧 `packages/cli/src/feedback/agent-guidance.test.ts` 的共享检查迁移到维护端；补足 omp 原生 registration、package identity、version 和文件覆盖。协议拒绝旧 recovery 字段的回归测试未删除。
- `bun test --parallel=4 --max-concurrency=3`：1856 pass、19 skip、0 fail，19617 assertions，248 files。跳过项保留原测试条件，不记作实际平台验证。
- `bun test scripts/skill-guidance plugins/scripts scripts/ci/typecheck.test.ts`：21 pass、0 fail，356 assertions。
- `bun run typecheck`、`bun run lint`：通过；lint 仅报告既有无关文件的 warnings。新增工具已接入 typecheck，现有 CI 的 Test 会执行只读漂移检查，未修改 CI/release workflow。
- `claude plugin validate plugins/claude/lorelum --strict` 和 `zcode plugins validate plugins/zcode/lorelum`：通过，属于原生配置校验，不算真实模型执行成功。
- Luna max 独立实现审查：No findings；复核 focused tests、typecheck 和生成检查，不替代宿主矩阵。
- 变更文件的 49 条本地 Markdown 链接目标存在；`openspec validate generate-host-native-skill-guidance --strict`、工具格式检查与 `git diff --check` 通过。

### 实际会话加载

使用现有本机认证/provider，临时复制完整 artifact 到仓库外目录。临时产物与工作树的 Skill/reference 按字节比对；没有把正文直接注入 prompt，也没有编辑用户已安装 cache。只在宿主原生会话选项中指定本地产物，未永久登记 marketplace 或更改安装 selector。

| 入口 | 实际步骤与结果 | 不能据此宣称的范围 |
| --- | --- | --- |
| generic / Codex CLI 0.162.0 | 将 `skills/lorelum/` 单独放入项目 `.agents/skills/lorelum/`，脱离源码。`codex exec --ephemeral --disable plugins --sandbox danger-full-access` 启动新会话，模型 gpt-6-luna/max；按任务发现并读取完整 Skill 与其相对 recovery，Catalog 不可见时执行一次 `lore pack list --details`，一次默认 semantic query 后完整 get。命令均 exit 0，正确说明 deferred 不后台重试。另一个显式 Skill 会话也完成 query/get/reference | 验证了 generic 独立加载和无 Plugin 的路径；不是 Codex Plugin 原生重新安装/更新测试，也不证明任意 prompt 都自动匹配 |
| WorkBuddy 5.5.6 | 使用其自带 CLI 的 `--plugin-dir`、`--add-dir` 和原生 Read/Skill/`Bash(lore:*)` allowlist，在临时空任务目录调用 `/lore`。Skill 原生加载、新版 reference、semantic query/get 均成功，最终 `is_error=false`，正确说明 deferred 规则 | 未覆盖 marketplace clean install/update、CLI 缺失和全部 Hook 故障。首轮非交互调用缺少 allowlist 时宿主要求审批，按原生权限选项重试，没有 bypassPermissions |
| omp 18.11.1 | `--plugin-dir <本地产物> --skills lorelum --model openai/gpt-6-luna --thinking max --no-session`，使用 `skill://lorelum` 及其相对 reference。两个 read 的 resolvedPath 均为临时 artifact，均含新生成标记；semantic query/get 成功，正确说明 deferred 不后台重试 | 会话级原生加载通过；未覆盖 marketplace 更新与 Main/child 矩阵。模型 TLS 失败不通过关闭验证绕过；改用现有配置中可用的会话模型 |
| Claude Code 2.1.284 | `--plugin-dir` 会话初始化列出 `lorelum:lorelum`；现有默认模型返回 503，换会话级 gpt-6-luna 后仍为模型 channel 503 | 只确认原生注册发现，未完成模型工具执行；不归因于 Lorelum，不绕过 provider 或 trust |
| ZCode CLI 0.16.9 | 原生 Plugin validator 通过 | 未修改用户 registry 安装源，未完成真实新会话安装/更新 smoke |
| Cursor | 本机无可运行宿主 | 未完成真实宿主验证，不能用静态 schema 代替 |

成功 query 均返回 `retrievalMethod: multi-view-vector`，随后执行 `lore get agentic-coding.implementation.make-recovery-behavior-explicit`。这些用例没有执行 Backend/model/index control 或 feedback，没有直接读取 LocalStore。reference 的 deferred 规则来自读取的 artifact；没有为制造故障而停止用户 Backend。

omp 的选择边界另做核对：首次同时加载本地产物与已安装旧版，read 结果显示 `skill://lorelum` 指向本地，碰撞命名空间 `skill://lorelum/lorelum` 指向旧安装；混用后读到了旧 reference。仅运行 query/get 成功不足以算新版通过。随后用原生 `--skills lorelum` 在会话中只保留本地入口，并检查每个 read 的 resolvedPath 和新内容后才记通过。没有改 product 名称、永久禁用已安装 Plugin 或手改 cache；也不把该碰撞当成生成器要新增 runtime 路由的需求。

### 未重新验证的既有支持边界

- 六个宿主的完整 clean install、首轮匹配、显式入口、原生 update 新会话和 Hook/context 缺席矩阵；omp Main/child 默认与 Catalog opt-in 的完整真实行为。局部会话成功只记对应单项。
- Linux/Windows、带空格路径、CLI 缺失/旧版、CLI 与 Plugin 独立升级、同宿主多版本选择及卸载所有权。没有新增 locator 或安装生命周期；这些不是生成器新增的拒绝条件，也没有被标为已验。
- Codex 上游 #35648 网页在本次收尾核查时仍标记 Open；未做失败读取次数对照，不声称该生成方案缓解或修复路径问题。
- 未 commit、push、发布、归档 change 或修改远端 Issue。原始宿主日志留在仓库外临时目录，不纳入版本控制；公开记录不包含账号、私有网关、请求 ID、会话 ID 或真实用户 cache 绝对路径。

### 新增检查的必要性审查

按 `agentic-coding.implementation.justify-added-checks` 由 Sol high 审查：生成器实现和既有测试迁移未发现实质问题；发现一项 P2 计划问题——把未改变的安装生命周期全矩阵设为本次交付前置条件。现有检查的职责和增量保护为：

- 固定 slots/frontmatter：拥有模板到原生文件的转换，防止漏替换、重复替换或破坏 metadata；只检查小段维护输入，不在产品运行时重复验证。
- 实际 Plugin 目录与 profiles 双向比对：发现已观察到的 omp 清单遗漏及新增宿主未适配，不能由 profiles 自己证明覆盖完整。
- 完整内容与缺文件检查：发现改源未生成、漏产物或手改产物；只读运行，不隐藏工作树漂移。
- 显式 write/check 参数：避免缺参数时意外写入；没有新配置、服务依赖或运行时扫描。
- 原有语义断言迁移：保证单一来源本身仍包含 query/get、恢复和授权规则；精确产物一致性不证明内容语义正确，两者并非重复。

原任务 3.3/3.4 的全矩阵没有指出本次变更可新增的生命周期失败，却会使维护端交付依赖 Cursor 是否安装、模型服务是否可用等无关条件。已同步收窄 proposal、design、product 和 tasks：保留全部产物覆盖、原生 metadata/relative-reference 审阅及已有真实加载证据；其他矩阵保留为上述未重验边界，不报告通过。原 Issue 关于“移除原生 Skill 前逐宿主验证”与“新增 runtime locator 时验证其生命周期”的条件没有触发；未删除任何原生 Skill、locator 或公共兼容要求。

修订后由同一 Sol high 审查复核：No findings，P2 已解决。Issue #246 还独立要求真实 clean-install/update 与 CLI/Hook 不可用时的宿主 smoke，这些未全部完成，不因条件项未触发而消失。此实现以 `Refs #246` 作为维护端生成方案提交，不自动关闭 Issue，也不宣称完成其全部验收。审查复跑 focused tests：21 pass、356 assertions；只读生成检查、工具独立 typecheck 与 diff 检查通过。规划修订未改变实现代码，未为此重复全量测试。
