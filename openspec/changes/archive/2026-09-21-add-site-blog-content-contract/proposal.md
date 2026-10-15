## Why

博客前端设计（issue #178 / PR #210）的产品定位是「可验证证据的工程笔记」。当前内容面只有一层最薄的 frontmatter 校验（`title` / `description` / `date` / `category` / `author` / `updated?` / `draft`），其余行为散落在实现里且没有合同：草稿只在索引被过滤，post loader 与 sitemap 仍会暴露它；证据来源以折叠 `<Accordion>` 呈现，含数字的表格没有出处图注；同一 slug 的 EN/ZH 结构没有任何一致性约束；中文正文的排版度量没有约定。

按根 `AGENTS.md` 的「Change scale and OpenSpec」，本 change 改变可见输出并新增公开行为，属 **large**，因此先落规划产物。它记录一部分既有行为（frontmatter 校验、索引合并、单语条目回退），并引入新的产品行为（草稿在非 dev 环境不可见、sitemap 只收录已发布页面）。

## What Changes

- 新增 `site-blog-content` capability，定义博客内容面的可观察合同。
- **frontmatter 可见性**：`draft: true` 的文章在非 dev 环境 MUST 不可见——post loader 返回 `undefined`，由各路由既有的 `notFound()` 处理；索引与 sitemap MUST 只收录已发布页面（sitemap 改用发布页面集合）。这是新的产品行为，当前 loader 与 sitemap 都会暴露草稿。
- **frontmatter 一致性**：`updated` 存在时 MUST NOT 早于 `date`。
- **证据作者规则**：文章的证据来源 MUST 在正文中直接可见，MUST NOT 藏在需要交互才能展开的控件之后（现有 `<Accordions>` 折叠附录按此替换）；表格若含数字 MUST 紧邻给出出处/样本口径的图注。
- **EN/ZH 结构对齐**：同一 slug 的英文与中文版本 `##` 标题数量 MUST 相等。
- **中文排版合同**：`:lang(zh)` 的正文行高 MUST 大于拉丁正文；`:lang(zh)` 标题 MUST NOT 继承拉丁展示字距。
- **不发布无生产者字段**：frontmatter MUST 只包含当前内容能产出、当前界面能消费的字段；`og:image`、`series`、`canonical` 明确不在合同内。
- **索引分类入口**：分类 MUST 是 `?category=<value>` 链接；带参数时渲染一行本地化过滤状态（含清除链接），无参数时 MUST NOT 渲染筛选 UI。
- **语言入口**：每条文章跨语言只列一次，链接 MUST 指向内容自身语言的 URL；内容语言 ≠ 页面语言时 MUST 以读者语言提示；标题与摘要带正确的 `lang`。
- 博客 surface MUST NOT 引入 `prefers-reduced-motion`（`apps/site/AGENTS.md` 记录的产品决定）。
- 明确不在本 change：markdown 孪生、`llms.txt`、JSON-LD / `hreflang` / `og:image`、`series` / `canonical` 字段、阅读时长、相关阅读、RSS、docs 侧 CJK 行高、`:root` 的 `--color-fd-*` 根因修缮。

## Capabilities

### New Capabilities

- `site-blog-content`: 博客内容面的可观察合同——frontmatter 可见性与一致性、证据来源的作者规则、EN/ZH 结构对齐、中文排版度量、分类与语言入口，以及不发布无生产者字段的规则。

### Modified Capabilities

无。`site-feature-architecture` 与 `web-design-system` 的要求不改变；两者与本 change 的关系见下方 Spec Conflicts。

## Spec Conflicts and Open Questions

- **`web-design-system` 的「生产 CSS 值 MUST 位于 UI token source」与本 change 的 blog-local 取值存在张力。** 设计决定把博客的 `--blog-*` 组合别名与 `:lang(zh)` 行高乘数放在 `apps/site/src/features/blog/styles/blog.css`，不新增 `packages/ui` 导出。方案给出的理由：别名值全部是 `var(--…)` 或 `color-mix(… var(--…) …)`，不引入新色值、不重建 palette；docs 同样需要 `:lang(zh)` 却不在本次范围，按「两边都需要的规则才进 `@lorelum/ui`」应保持 surface-local。**维护者已确认（阶段 1 前）：该要求不覆盖 surface-local 别名。** 结论：`--blog-*` 作为**消费方**的 surface-local 复合别名保留在 `features/blog/styles/blog.css`，**不新增 `packages/ui` 导出，也不修改 `web-design-system`**。约束落在别名取值上——颜色组（`--blog-link` / `--blog-hairline` / `--blog-quiet-surface`）必须完全由 `var(--…)` 或 `color-mix(… var(--…) …)` 组合而来；尺寸组（`--blog-sticky-offset` / `--blog-toc-rail`）必须是有单位的长度值。两组均不得出现 hex 颜色字面量。
- `site-feature-architecture` 与 `web-design-system` 的其余要求（route/feature 所有权、vendor 隔离、SSR 安全、`.lorelum-ui` 作用域、不新建 site-local UI 树、组件需真实 consumer）与本 change 一致，无需 delta。
- 设计输入 `.tmp/blog-frontend-plan.md` §7 记录了若干已被推翻的历史论证；本提案只采纳该文档的「维护者决定记录」表与当前代码/内容，未采纳被推翻的断言。

- **`?category=` 的过滤语义（维护者已确认）**：分类链接**同时过滤条目清单**，且过滤必须在服务端/预渲染完成——带 `?category=<x>` 的请求只列出该分类的条目，页内状态行显示当前分类与「显示全部」链接。因此该行为在无 JS 时同样成立，URL 可分享。
- **`--lore-font-sans` 的 Windows 具名 CJK 族缺口（维护者已确认）**：本轮不解决。`:lang(zh)` 合同只约束行高、字距与标点行为，**不承诺具体中文字族**；修改生产 token 属本 change 的排除范围。

## Impact

- 契约与作者约束落在 `apps/site/src/features/blog/content/frontmatter.ts`、`apps/site/src/features/blog/model/list-posts.ts`、`apps/site/src/features/blog/server/load-blog-post.ts`、`apps/site/src/routes/sitemap[.]xml.ts`、`apps/site/src/features/blog/styles/blog.css` 与 `apps/site/content/blog/*.mdx`（EN/ZH 各一篇）。
- sitemap 与 post loader 的可见性变化是**可观察的行为变更**，必须在实施说明中单列。
- 不改变公开 Practice/Pack schema、CLI 或检索语义；不新增 `packages/ui` 导出；不引入 markdown 孪生、`llms.txt`、JSON-LD、OG 图片、RSS、阅读时长、相关阅读。
- 不改变 route 所有权边界与 SSR 约定。
