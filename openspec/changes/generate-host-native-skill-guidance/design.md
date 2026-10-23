## Context

方案：**单一人工内容源，在构建阶段生成并提交完整的 host-native Skill 和相对 references。保留安装路径与运行路径，不引入 runtime locator。** 动机见 [proposal](proposal.md)，正常路径和失败体验见 [product](product.md)。验证覆盖生成边界、产物迁移和真实原生加载；不重新认证未改变的宿主安装生命周期。

已核对的共享与差异：

| 范围 | 共同规则 | 真正差异及所有者 |
| --- | --- | --- |
| 全部七个 Skill | natural-language semantic query、采用前完整 get、text/JSON 用途、trace-first、无自动 keyword fallback、resource 相对 packRoot 解析 | 共享内容源拥有，不允许宿主覆盖 |
| generic 与五个传统宿主 | 复用实际可见 Catalog，缺失/截断影响发现时才 list | 仅保留原生 description；Cursor 首轮可见性是共同规则的验收场景，不另分叉正文 |
| omp | 共享 query/get/trace/resource | omp 适配拥有 Main/child Catalog 政策与成功 get 候选说明，不能套用“无 Catalog 就补齐” |
| 全部七个目标 | 按任务需要维护 lease acquire/renew/release，单次 query 不需要 lease | generic 正文缺节是历史漏同步；CLI 没有 host 限制，reference 也已说明 lease，不建立 host-only 开关 |
| recovery references | trace 边界、feedback 授权、模型/index/Backend 恢复及 Catalog 复用原则 | 完整共用同一份 reference；标题、同义句不构成适配，恢复动作由 CLI 合同拥有 |

事实源为 `skills/lorelum/`、`plugins/*/lorelum/skills/lorelum/`，以及 [agent-integration](../../specs/agent-integration/spec.md)、[plugin-distribution](../../specs/plugin-distribution/spec.md)。共享测试 `packages/cli/src/feedback/agent-guidance.test.ts` 列了六个目标但漏 omp。详细证据与核查日期放在 [evidence](evidence.md)。

omp reference 中 `error.recovery` 和后台 backoff 与 [backend-runtime](../../specs/backend-runtime/spec.md) 冲突，且 `packages/cli/src/output/protocol.test.ts` 明确拒绝该字段。它是内容漂移，不作为可配置变体保留。共享 recovery 采用现行 message、guarded stop、stopped 后 start、deferred 不后台重试的规则。

差异必须先按原因分类，不能仅凭现有文件不同就配置化：当前宿主合同/实现要求的差异保留；共同产品规则的漏同步统一纠正；标题、宿主名与同义文案归一。无法证明原因时继续核查，不把未知项包装成既定宿主特色。generic lease 的历史证据与 omp 旧规则来源记录在 evidence。

## Goals / Non-Goals

目标是让一次共享修改可确定地到达所有支持目标，宿主差异有所有者，安装包脱离仓库/生成器后仍完整可读。分发合同见 [delta spec](specs/plugin-distribution/spec.md)。

不删除任何原生 Skill；不让 CLI 安装器拥有 Skill；不新增 `lore skill ...`、Hook locator、用户级共享目录、下载、symlink、通用模板框架或自动版本协调。不把 upstream Codex 路径重构错误纳入 Lorelum 修复承诺。不改已有 Hook/extension 的身份、hint、权限或生命周期实现。

## Decisions

### 1. 将“如何维护”与“宿主如何加载”分开

| 路线 | 对目标的覆盖 | 额外责任 / 结论 |
| --- | --- | --- |
| Hook 直接提供 CLI-managed locator，移除原生 Skill | 运行时正文能集中更新 | 普通 context 不是原生 Skill 注册；Hook 不运行时缺发现入口，Cursor 首轮还有可见性差距。需要安装、多版本、卸载和跨平台路径合同；不选 |
| 薄原生 Skill 加 CLI-managed 正文 | 保留 metadata 与显式入口，共享正文可随 CLI 更新 | 首次使用多一道读取；CLI 缺失/旧版时入口只能指导如何找正文，完整恢复若随入口复制又形成第二来源。版本、路径与 fallback 需要新合同；不选作本阶段默认 |
| 构建生成完整原生产物 | 一个人工共享来源，保留现有原生入口及自包含 reference | 仍有安装副本，更新经各宿主机制；承担构建与检查成本。首选 |

选择的因果是：重复发生在维护端，而现有 host-native 加载是需要保留的能力。先在维护端解决，避免为了消除磁盘副本增加运行时状态。这里不声称其他路线已经经过宿主对照试验并失败；它们的新增责任及发现差距足以不进入本阶段实现。

如果以后明确需要“只升级 CLI 就让各宿主使用新指导”，并有真实宿主证据证明 locator 可完整保留发现、显式调用和故障恢复，再单独设计它。没有这个产品需求，不为选择生成方案建立三套 runtime 原型。

### 2. 内容源不放在任何宿主扫描的 Skill 安装目录

拟议组织：

```text
scripts/skill-guidance/
  content/skill.md.tmpl                 # 全文结构及共享检索规则
  content/recovery.md                   # 完整共用的唯一恢复规则
  profiles.ts                          # metadata、Catalog 文字和 omp hint 适配
  render.ts                            # 无 I/O 的确定性组合
  artifacts.ts                         # 读取来源、发现安装目标、检查/写入产物
  generate.ts                          # --write / --check 命令入口
  *.test.ts                            # 渲染、覆盖与漂移回归
  tsconfig.json                        # 接入现有 typecheck runner
```

generic 与各 host 的原 `skills/lorelum/SKILL.md` 和 recovery 文件都改为生成产物，继续提交 Git。源码模板不命名为 `SKILL.md`，不被 installer 当成第二个 Skill。生成工具只存在于维护端，安装包不引用 `scripts/`；无需改变 manifest 或 marketplace。

模板保留完整段落，不把每句话拆成独立文件。正文只保留 description、Catalog 入口段、omp read-hint 附加段三个替换位置；lease 是共同正文，没有宿主开关。recovery 完整共用，不因标题或文案再设替换项。共享 query/get、diagnostics、feedback 和 Backend 动作不开放宿主覆盖。固定 token 替换即可，不引入模板依赖；未知、缺失或重复的固定插槽在生成前报维护错误。

`profiles.ts` 保存小规模内容数据，而非通用 Plugin schema。generic 与普通 Hook 宿主共享同一 Catalog 段落，不必代入宿主名称；omp 单独拥有 child Catalog 政策与 read-hint 说明。description 以既有值为迁移基准，`/lore` 与 Claude 原生命名空间不由生成器重命名。

### 3. 生成边界与最小接口

维护端使用以下接口，省略实际 Markdown 和文件 I/O 细节；它们不是新的产品 API：

```ts
interface GuidanceProfile {
  readonly description: string;
  readonly catalog: string;
  readonly readHints: string;
}

interface GuidanceSources {
  readonly skillTemplate: string;
  readonly recovery: string;
}

interface RenderedGuidance {
  readonly skill: string;
  readonly recovery: string;
}

function renderGuidance(
  source: GuidanceSources,
  profile: GuidanceProfile,
): RenderedGuidance;

async function synchronizeGuidance(options: {
  readonly repositoryRoot: string;
  readonly mode: "check" | "write";
}): Promise<readonly string[]>; // 不一致的仓库相对路径；I/O/配置失败抛错
```

`renderGuidance` 组合共享正文和 profile 的真实差异。`guidanceProfiles` 以 generic 或 host key 为键；普通目标引用同一 Catalog 常量，只有 omp 使用独立 Catalog 与 read-hint 常量，不引入多个 boolean 或可配置政策框架。产物 UTF-8、LF、末尾一个换行，无本机绝对路径、时间戳或运行 ID。

`artifacts.ts` 是唯一组装边界：读取内容源和 `profiles.ts`，核对目标集合，调用纯渲染，为 generic 输出 `skills/lorelum/`，为 host 输出 `plugins/<hostKey>/lorelum/skills/lorelum/`。文件前端仍是 YAML frontmatter；生成标记放在 frontmatter 后的 HTML 注释中，指向源和重新生成命令。reference 可用相同注释，不加入模型必须执行的维护说明。

入口调用示意：

```ts
const differences = await synchronizeGuidance({ repositoryRoot, mode });
for (const path of differences) console.error(path);
if (mode === "check" && differences.length > 0) {
  console.error("运行 bun run skills:generate 后提交产物。");
  process.exitCode = 1;
}
```

维护命令为 `bun run skills:generate`，只读校验为 `bun run skills:check`；根 package scripts 分别映射 `generate.ts --write` 与 `--check`。维护者改原稿、显式运行生成命令、审阅并提交原稿与产物；不设置保存监听或自动 Git hook。直接调用脚本时参数缺失/非法返回 2，不默认写入。check 按完整期望文件内容比较实际文件，缺失或漂移返回 1，匹配返回 0；它不先生成到仓库再用 `git diff` 检查，避免覆盖人工改动、漏掉未跟踪文件。

write 先完成来源加载、目标覆盖核对和全部渲染，再只写每个目标受管的两个路径；不递归清理目录、不删除或拒绝其他宿主资源。写入失败报告准确文件和重新运行命令；这只是维护端工作树，不是安装事务，无需新锁、日志或持久状态。check 不修复产物，测试不悄悄运行 write。

### 4. 覆盖检查不能只相信生成器自己的清单

从实际 `plugins/*/lorelum/` artifact 目录发现 host 集合，与 profiles 的非 generic target 双向比对；generic 单独必须存在。另检查各原生 registration 的 source root 与真实 artifact 的映射，保留各宿主 schema 的独立测试，并为 omp 补足分发覆盖；不造通用 manifest。发现无 profile 的 host 报维护错误，不自动套 generic。

渲染测试与完整性测试独立：即使故意从 profiles 删除 omp，真实 artifact 集合仍包含它，因此必须失败。即使 profiles 包含 omp、产物却漏写其 recovery，也必须由完整文件检查失败。新宿主出现时必须显式决定适配，不允许使用可选空值跳过生成。

将原 `agent-guidance.test.ts` 的共享规则覆盖迁入维护端测试，删掉其手写路径清单，不把分发内容测试继续放在 feedback package 下。共享行为 fixtures 继续负责语义验收；精确产物比较只证明无漂移，不替代 Agent 行为测试或架构审查。

### 5. 运行链保持原生，生成器不进入 CLI

已核对的 Codex 路径：manifest 指向 Plugin skills，宿主按 metadata 发现 Skill；SessionStart 执行 `lore hook codex`。CLI `main.ts` 提前选择 Hook 路径，`parseHookInvocation`/`createHookEndpoint` 组装 `createCodexEndpoint`；endpoint 的 SessionStart 调用 `createCatalogReader().readCatalog()`，经 `listPackDetails` 和 `renderInstalledPackCatalog` 输出有界 metadata，runner 编码宿主 envelope 并负责 fail-open。Agent 按需读取原生 Skill，query/get 仍走已发布 CLI。Hook 不返回 Skill cache locator。

目标路径仅在安装前增加维护步骤：维护者加载来源、渲染七套产物、check、提交；宿主从已提交 artifact 安装。之后仍走上面的全部原生链，CLI 不导入生成器、不查找共享正文、Hook envelope 不变化。semantic query 的 Backend/Engine 路由、trace 生命周期、宿主取消与资源释放全部复用既有实现，没有新增运行态资源需要清理。

CLI 缺失时，完整指导仍可加载但命令不能执行；Hook 失效时，已有原生 Skill 仍在。两者不混为同一个“安装完成”状态，也不新建安装状态机。路径有空格、只读安装目录、多个 Plugin 版本并存，均使用宿主已选择的版本目录及其相对 reference，不发明可写共享落点。

## Risks / Trade-offs

- **磁盘副本与更新传播仍存在。** 接受：维护源唯一不等于实时热更新；用户仍需原生 Plugin 更新。不能把“改一次源码”描述成“所有已安装宿主立即变化”。
- **生成错误会传播到全部宿主。** 维护端覆盖、完整产物比较和共享语义 fixtures 各负责一类风险；初次迁移逐份审阅差异，除了生成注释、合理的文案归一和 omp 已识别的错误规则外不改行为。
- **宿主 metadata 与触发敏感。** 逐份审阅原值、目录与相对 reference，验证独立目录安装，并以可用宿主的真实原生会话确认生成产物能加载和执行 CLI 检索。只有改变入口、安装所有权或生命周期，才扩展对应宿主的安装/升级验收；没有实际执行的宿主行为不报告为已验证。
- **omp 的差异被误共享。** Catalog/read-hint 是独立适配；Backend 恢复不是。为 child 默认不 list、开启目录只增 metadata、候选采用前 get 保留实际行为证据。
- **Codex 仍可能拼错已有路径。** 方案不缩短 cache 层级、不改 root alias、不造 symlink；上游进度和任何失败读取次数的对照都单列在验证记录。不承诺缓解，更不称修复。

## Migration Plan

1. 从核对过的七份内容抽取共享源与有限适配，纠正 omp 的已识别 Backend 文案漂移，补齐 generic lease；只把有现行依据的差异保留为适配。
2. 一次生成并提交原位置的十四个 Skill/reference 文件，标记生成来源；删除共享测试的手写目标清单和人工同步说明。`bun test` 加入只读生成/覆盖检查，现有 typecheck runner 纳入新工具配置；无需修改 CI/release workflow。
3. 更新 maintainer conventions、checkout guide、fixtures，说明在哪里改、怎样生成。公众安装步骤不变，不为内部工具同步重写双语用户指南；只有真实用户流程变更时才更新对应页面。
4. 按 [product](product.md) 验证 generic 独立目录安装、可用宿主原生会话中的 Skill/reference 加载和 CLI query/get，并逐份复核十四个产物的原生 metadata、路径与真实适配。安装/更新/卸载、版本选择、CLI/Hook 缺失和跨平台行为保持既有所有权，未重新验证的部分明确记录，不作为生成器的新增交付门槛。若后续变更这些边界，再补对应专项验证；按宿主现有机制发布，不由本设计执行发布。
5. 验证记录分开列静态检查、真实宿主结果和未验平台。真实入口出现回归时修正生成器/适配后重新生成，不留下手改某个产物的长期分叉。

回滚只需回退该次源码与生成产物变更，并由宿主原生机制恢复完整旧 artifact；无需撤销用户目录或迁移 Pack 数据。内容回滚必须继续满足已接受 Backend 恢复合同，不能重新引入错误的后台重试指导。

维护演练：修改一条 shared semantic-query 或 lease 规则，只改 `content/skill.md.tmpl` 后生成七套产物；不编辑六个 host。修改 omp child Catalog 政策，只改对应适配并核对当前 agent-integration 合同，不触碰 query/recovery。新增 host 时，artifact 与 profile 集合不一致会先失败，贡献者必须证明新增差异的真实依据，而不是复制全文。
