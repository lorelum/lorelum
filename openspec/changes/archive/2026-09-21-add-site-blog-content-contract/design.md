## Context

博客是 `apps/site` 的一个 feature（`src/features/blog/`），内容位于 `apps/site/content/blog/`。当前内容面的合同只有一层 frontmatter 校验与索引合并逻辑，其余行为散落在实现里：

- frontmatter schema 在 `apps/site/src/features/blog/content/frontmatter.ts`（字段与日历日校验）。
- 索引在 `apps/site/src/features/blog/model/list-posts.ts` 合并两种语言并按日期排序。
- 单篇解析在 `apps/site/src/features/blog/server/load-blog-post.ts`。
- sitemap 在 `apps/site/src/routes/sitemap[.]xml.ts`。

仓库当前**没有任何 spec 提及 blog**（`grep -rin blog openspec/specs/` 无结果），因此这是一个新 capability，而不是对既有 spec 的修改。本设计输入是 `.tmp/blog-frontend-plan.md` 与 `.tmp/goal-prompt.md`；两者混合了已被推翻的历史论证，本设计只采纳方案文档的「维护者决定记录」表与当前代码/内容。

## Goals / Non-Goals

**Goals:**

- 把博客内容面已经决定的规则写成可验证的合同：frontmatter 字段与一致性、草稿可见性、证据作者规则、双语结构与排版、分类与语言入口。
- 明确并单列本轮引入的新产品行为：草稿在非 dev 环境不可见、sitemap 只收录已发布页面。
- 记录一条"不发布无生产者字段"的纪律，防止 frontmatter 长出填不了的字段。

**Non-Goals:**

- markdown 孪生与 copy affordance、`llms.txt` 接入、JSON-LD / `hreflang` / `og:image`、`series` / `canonical` 字段、阅读时长、相关阅读、RSS。
- `packages/ui` 新增导出、docs 侧 CJK 行高、`:root` 的 `--color-fd-*` 文档层根因修缮、打印样式。
- 任何博客页面视觉改写的实现细节（那些属于同一 PR 的实施阶段，本 change 只定义其内容契约）。

## Observed Evidence

以下为写入合同前复核过的当前事实（均可由本工作树复核）：

- frontmatter 字段与校验：`apps/site/src/features/blog/content/frontmatter.ts:8-21`（真实日历日）、`:27-35`（字段集），`draft` 默认 `false` 在 `:34`。
- 索引过滤草稿：`apps/site/src/features/blog/model/list-posts.ts:39`（`if (record.data.draft) continue;`），注释在 `:25`。
- **post loader 不过滤草稿**：`apps/site/src/features/blog/server/load-blog-post.ts` 只做 `getPage` + `pickFrontmatter`。
- **sitemap 枚举全部博客页面**：`apps/site/src/routes/sitemap[.]xml.ts:47`（`blogSource.getPages()`），不区分草稿。
- 语言标记：`blog-index-screen.tsx:15-17` 的 `translatedMarker()` 生成 `EN` / `中文`；条目 `href` 由页面语言拼成（`:26`、`:40`），不是内容语言。
- 内容：EN 与 ZH 各 8 个 `##` 标题（当前恰好对齐）；证据附录使用 `<Accordions type="single">`（`apps/site/content/blog/practice-injection-measurement.mdx` 与其 `.zh.mdx`）；文章含两张含数字的结果表格，均无出处/样本图注。
- 样式：`apps/site/src/features/blog/styles/blog.css` 只做 Fumadocs 角色到生产语义 token 的映射；`grep ":lang(" apps/site/src packages/ui/src` **无结果**，站点与 UI 包都没有中文排版规则。
- 既有测试：`content/frontmatter.test.ts`、`model/list-posts.test.ts`、`styles/blog.test.ts`（已断言博客不含 `prefers-reduced-motion`）。没有任何测试覆盖 loader/sitemap 的草稿行为、双语结构对齐或内容作者规则。

## Decisions

### D1 草稿可见性用单一谓词

新增纯函数可见性谓词（`model/post-visibility.ts`，例如 `isPostVisible(post, { isDev })`），由三个入口共用：索引（`buildBlogIndex` 调用它而非内联判断）、post loader（不可见时返回 `undefined`，交给路由既有的 `notFound()`）、sitemap（改用发布页面集合 `getPublishedBlogPages()`）。

- 选择理由：方案缺陷 4 的根因是三个入口各写各的过滤；单谓词是让"索引、loader、sitemap 一致"可被测试而不只是被声明的方式。
- 备选：只在路由层做 404——否决，sitemap 仍会泄露草稿 URL，且 loader 仍返回数据。

### D2 `updated ≥ date` 进入 schema

在 `blogFrontmatterSchema` 上用 `refine` 拒绝 `updated < date`（字符串按 `YYYY-MM-DD` 可比）。选择在 schema 层而非内容测试层，因为它是字段之间的关系，且 `pickFrontmatter` 会在预渲染时快速失败。

### D3 证据来源替换为可见清单

把 `<Accordions>` 折叠附录替换为非交互的证据来源清单（`components/blog-evidence-list.tsx`）。**采用三条已复核的理由**，不采用已被实验证伪的"markdown 孪生会丢掉 Accordion 标题"论证（方案 §7.1 已推翻：`remarkLLMs` 显式传入自己的 `filterElement`，标题实际保留）：

1. 渲染产物是"卡片 + 折叠"（`rounded-lg border bg-fd-card` + 全部 `aria-expanded="false"`），同时违反"不是所有元素都装进卡片"与"阅读面需要足够直边"。
2. 机器可读面（未来的孪生）应当是干净的 Markdown 列表，而不是组件标记。
3. 现有 `id="evidence-*"` 全仓库无入链。

### D4 数字表格必须有紧邻出处图注

在两张结果表格后各加一行图注，给出源文档（`issue-92` 逐次运行记录）与样本口径（3 个任务、各条件运行次数），两种语言都加。由内容合同测试强制。

### D5 双语结构对齐由内容合同测试强制

扫描 `content/blog/**/*.mdx`，对同一 slug 的两个语言版本比较 `##` 标题数量。当前两文件各 8 个，已对齐，因此这是一条**记录既有行为并防止漂移**的约束。

### D6 `:lang(zh)` 保持 blog-local

在 `blog.css` 内定义 `:lang(zh)` 的长行高与标题字距归零，不新增 `packages/ui` 导出。

- 选择理由：docs 同样需要该规则却不在本次范围，按"两边都需要的规则才进 `@lorelum/ui`"应保持 surface-local；为一个行高乘数引入包级导出不成比例。
- 与 `web-design-system` 的张力见 Risks。

### D7 不发布无生产者字段

`og:image`、`series`、`canonical` 不进入合同。选择在 proposal/design 里记为纪律，并在实施时不为它们写 schema 字段——发布"存在但填不了"的字段就是假能力。

### D8 分类入口是链接 + 条件状态行

分类渲染为指向 `?category=<value>` 的链接；带参数时渲染一行本地化过滤状态与清除链接，无参数时不渲染筛选 UI。选择链接而非客户端筛选状态，因为它在 n=1 时就是一个可用、可分享的 URL。

### D9 语言入口按内容语言

条目 `href` 由内容自身 locale 与 slug 拼成（纯函数，例如 `blogPostPath(locale, slug)`），修掉"单语文章在另一语言索引页链到 404"；内容语言 ≠ 页面语言时显示读者语言的提示；外语标题/摘要带 `lang={contentLocale}`；删除 `translatedMarker()`。文章页的语言入口仅在另一语言版本存在时渲染。

### D10 不引入 reduced-motion

沿用 `apps/site/AGENTS.md` 的当前产品决定，并用既有 `blog.test.ts` 护栏维持。

## Requirement Sources

| Requirement | 当前来源（既有行为） | 实施/验证来源 |
| --- | --- | --- |
| Blog frontmatter contract and consistency | `content/frontmatter.ts:27-35`、`content/frontmatter.test.ts` | schema `refine(updated ≥ date)` + 新增断言 |
| Draft visibility is environment-scoped | `model/list-posts.ts:39`（索引）、`server/load-blog-post.ts`（无过滤）、`routes/sitemap[.]xml.ts:47` | `model/post-visibility.ts`（新）、`server/published-pages.ts`（新）、`model/post-visibility.test.ts`（新）、loader 与 sitemap 接入 |
| Evidence sources are visible without interaction | `content/blog/*.mdx` 的 `<Accordions>` | `components/blog-evidence-list.tsx`（新）、`content/content-contract.test.ts`（新） |
| Numeric tables carry an adjacent source caption | 两张结果表格，无图注 | 内容文件加图注行 + `content/content-contract.test.ts` |
| Bilingual structure alignment | EN/ZH 各 8 个 `##`（已对齐） | `content/content-contract.test.ts` |
| Bilingual typography contract | 无 `:lang(` 规则（`apps/site/src`、`packages/ui/src` 均无） | `styles/blog.css` 的 `:lang(zh)` 规则 + `styles/blog.test.ts` 护栏 |
| Category entry and filter state | `blog-index-screen.tsx:46` 仅渲染原始枚举值 | `components/category-chip.tsx`、`model/category-label.ts`、索引 search param |
| Language entry reflects content vs page language | `blog-index-screen.tsx:15-17,26,40` | `model/blog-routes.ts`（`blogPostPath`）+ 提示行与 `lang` 属性 + `entry-meta.test.ts`/`blog-routes.test.ts` |
| Blog surface excludes reduced-motion handling | `styles/blog.test.ts:55-58` 护栏 | 维持护栏，扩展到新增 screen/样式 |

## Risks / Trade-offs

- **[可观察行为变更被淡化成 bug 修复]** → 草稿可见性与 sitemap 收录是新的产品行为，必须在实施提交与 PR 说明中单列，不得混入"修 bug"。
- **[与 `web-design-system` 的 token 归属张力]** → 该 spec 要求"生产 CSS 值 MUST 位于 UI token source"，而本设计把 `--blog-*` 组合别名与 `:lang(zh)` 乘数放在 blog-local 样式。缓解：别名值全部是 `var(--…)` / `color-mix(… var(--…) …)`，不新增色值；但**这处解释需要维护者确认**，不由本 change 静默拍板（见 Open Questions）。
- **["表格含数字"启发式可能脆弱]** → 内容合同测试识别"表格含数字"会有假阴性/假阳性风险。缓解：规则基于 Markdown 表格单元格是否含数字字符，并对无法判定的表格要求人工确认；宁可少报也不要静默通过。
- **[双语结构对齐限制作者]** → 某些内容可能天然需要语言特有章节。缓解：先把对齐作为合同（当前内容已满足）；若出现正当例外，应显式修订合同而不是放宽测试。
- **[`--lore-font-sans` 缺 Windows CJK 族]** → 方案 §6.7 记录该 token 命名了 `"PingFang SC"` 而无 `"Microsoft YaHei"`。这不在本 change 范围，但会影响 `:lang(zh)` 排版合同在 Windows 上的可观察结果。缓解：记录为依赖项，token 变更单独处理。
- **[`updated` 缺失被省略 vs 占位]** → 合同要求缺省时不产生占位（避免伪造出处）。实施时不得合成 `updated`。

## Deferred Work

以下在调研中被确认为真实缺口，但**不属于本 change**，逐项写明触发条件：

| 项 | 切出理由 | 触发 / 归属 |
| --- | --- | --- |
| markdown 孪生 + copy affordance | 需要 `postprocess: { includeProcessedMarkdown: true }`，会改变编译后 MDX 模块载荷与 worker 运行时行为，须先实测体积 | 独立变更；路由文件名须用 `{$slug}[.]md.ts` |
| `llms.txt` / `llms-full.txt` 接入博客 | 依赖孪生 | 与孪生同一变更 |
| JSON-LD、`hreflang` alternates、`article:modified_time`、`twitter:card` | 不是页面设计；`hreflang` 依赖服务端探测译文存在性 | 独立 SEO 变更 |
| `og:image`（需要 PNG 图源）、`series`、`canonical` 字段 | 无生产者或无消费者 | 不发布，等生产者/消费者出现 |
| 阅读时长 | 依赖 registry 开关，且 200 wpm 口径无出处 | 孪生变更之后 |
| 相关阅读 | 需要词法评分与中文分词，n=1 返回空 | n ≥ 3 |
| RSS | 新增公开端点，是跨边界契约 | 维护者单独提出 |
| docs 侧 CJK 行高 | 与博客属于不同 surface；两边都需要时再提取共享样式表 | docs 一并修改时 |
| `:root` 的 `--color-fd-*` 文档层根因修缮、打印样式 | 跨 docs + landing + blog 三个面 | 独立小变更 |

## Open Questions

1. **`web-design-system` 的 token 来源要求是否覆盖 blog-local 组合值？** 若覆盖，需新增 `packages/ui` 导出或修改 `web-design-system`；本 change 按 surface-local 解释实施，等待维护者确认。
2. **`?category=` 是否同时过滤条目清单？** 方案只明确"分类链接 + 过滤状态行"，未写明带参数时清单本身是否被限制到该分类。合同当前只要求链接与状态行的可观察行为；清单是否过滤需要确认。
3. **双语结构对齐是否对所有未来文章都成立？** 当前已定为合同；若存在正当语言特有章节，需要显式修订而不是放宽测试。
4. **`--lore-font-sans` 是否补 Windows CJK 族？** 该 token 决策会改变 `:lang(zh)` 排版的可观察结果；不在本 change 内。
