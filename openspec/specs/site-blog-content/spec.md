# site-blog-content Specification

## Purpose
定义 Lorelum 博客的内容契约：frontmatter 字段与一致性、草稿的可见性边界、证据来源与表格来源的呈现要求、EN/ZH 结构与排版对齐、分类与语言入口行为、长不可断文本的换行边界，以及博客面不引入 reduced-motion 处理。它使文章在两种语言、两种主题与无 JS 条件下都保持可读、可验证，并阻止发布界面无法消费的字段或需要交互才能读到的证据。

## Requirements
### Requirement: Blog frontmatter contract and consistency

每篇博客文章的 frontmatter MUST 提供非空的 `title`、非空的 `description`、作为真实日历日的 `date`（`YYYY-MM-DD`）、`category`（`benchmark` / `packs` / `lorelum` 三者之一）与非空 `author`。`updated` 为可选字段，`draft` 为可选字段并默认 `false`。

`updated` 存在时 MUST NOT 早于 `date`。frontmatter MUST NOT 定义当前内容无法生产或当前界面无法消费的字段；`og:image`、`series`、`canonical` MUST NOT 进入合同。

#### Scenario: A complete published frontmatter is accepted

- **WHEN** 一篇文章提供非空 title、description、真实日历日 date、已知 category、非空 author，且不写 draft
- **THEN** schema MUST 接受它，并把 `draft` 解析为 `false`、把 `updated` 视为缺失

#### Scenario: An update date earlier than the publish date is rejected

- **WHEN** frontmatter 的 `updated` 早于 `date`
- **THEN** 校验 MUST 失败，且该文章 MUST NOT 被视为合同内的合法内容

#### Scenario: An impossible or malformed date is rejected

- **WHEN** `date` 或 `updated` 不是 `YYYY-MM-DD`，或虽是该格式但不是真实日历日（如 `2026-02-30`）
- **THEN** 校验 MUST 失败

#### Scenario: A field without a producer stays out of the contract

- **WHEN** 有人提议加入一个当前内容无法填写、或当前界面没有消费者的 frontmatter 字段
- **THEN** 该字段 MUST NOT 被加入合同，直到同一变更同时给出生产者与消费者

### Requirement: Draft visibility is environment-scoped

`draft: true` 的文章在非 dev 环境 MUST 对所有内容入口不可见：post loader MUST 返回 `undefined`，由各路由既有的 `notFound()` 产出 404；索引 MUST NOT 列出该条目；sitemap MUST NOT 收录该 slug。dev 环境下草稿 MUST 仍可访问与预览。

可见性判定 MUST 有单一来源：索引、post loader 与 sitemap MUST 用同一个谓词判定，MUST NOT 各自实现互相独立的草稿过滤。索引与 post loader 传当前环境；sitemap MUST 以「非 dev」判定，因为 sitemap 是索引入口清单，任何环境都不收录草稿。

dev 环境下索引 MUST 列出草稿，与「草稿的 URL 在 dev 可访问」一致：索引与文章 URL 对同一篇草稿 MUST 给出同一答案，不得出现「文章可读而索引不列」或反之。

#### Scenario: A draft slug is not reachable outside dev

- **WHEN** 用户直接访问一个 `draft: true` 文章的 URL，且运行在非 dev 环境
- **THEN** post loader MUST 返回 `undefined`，路由 MUST 返回 not-found 结果，且该 slug MUST NOT 出现在 sitemap 中

#### Scenario: A draft stays previewable in dev

- **WHEN** 同一篇 `draft: true` 文章在 dev 环境被访问
- **THEN** 它 MUST 可见，以便作者在发布前预览

#### Scenario: The index agrees with the article URL about a draft

- **WHEN** 一篇 `draft: true` 文章在 dev 环境可访问
- **THEN** 索引 MUST 在同一环境下列出它；而在非 dev 环境下文章 URL 返回 not-found 时，索引 MUST NOT 列出它

#### Scenario: A published post is visible everywhere

- **WHEN** 一篇文章的 `draft` 为 `false`（或缺省）
- **THEN** 它在 dev 与非 dev 环境 MUST 都可见，索引 MUST 列出它，sitemap MUST 收录它

### Requirement: Evidence sources are visible without interaction

文章的证据来源 MUST 在正文中作为可直接阅读的内容呈现，MUST NOT 被放入需要用户交互才能展开的折叠控件。每个证据来源 MUST 给出可解析的外部文档链接，并使用与正文引用相同的链接呈现方式。

#### Scenario: The evidence appendix renders as readable content

- **WHEN** 一篇文章列出支撑其数字与结论的公开文档
- **THEN** 该清单 MUST 在正文中直接可见，且 MUST NOT 依赖 disclosure 控件的展开状态

#### Scenario: Collapsed evidence markup is rejected by the content contract

- **WHEN** 博客内容文件使用 `<Accordion>` / `<Accordions>` 折叠证据来源
- **THEN** 内容合同测试 MUST 失败

### Requirement: Numeric tables carry an adjacent source caption

当文章内的表格包含数字时，该表格 MUST 紧邻出现一行图注，说明数据出处与样本口径（例如来源文档或运行记录，以及任务数与各条件的运行次数）。图注 MUST 在英文与中文版本中都存在。

#### Scenario: A results table states where its numbers come from

- **WHEN** 文章用一个表格给出各条件的通过次数
- **THEN** 表格 MUST 紧邻给出来源与样本口径的图注，读者无需跳转即可判断这些数字能支持什么

#### Scenario: A numeric table without a caption fails the content contract

- **WHEN** 一个含数字的表格没有紧邻的出处图注
- **THEN** 内容合同测试 MUST 失败

### Requirement: Bilingual structure alignment

同一 slug 的英文与中文版本 MUST 具有相同数量的 `##` 二级标题。

#### Scenario: Aligned translations are accepted

- **WHEN** 同一 slug 的 EN 与 ZH 文件的 `##` 标题数量相等
- **THEN** 内容合同测试 MUST 通过

#### Scenario: A structure drift is rejected

- **WHEN** 同一 slug 的两个语言版本 `##` 标题数量不等
- **THEN** 内容合同测试 MUST 失败并指出该 slug

### Requirement: Bilingual typography contract

博客 surface MUST 为 `:lang(zh)` 文本提供与拉丁正文不同的排版度量：`:lang(zh)` 正文的行高 MUST 大于同一 surface 内拉丁正文的行高；`:lang(zh)` 标题 MUST NOT 继承拉丁标题的展示字距。该度量 MUST 在不修改 `:root` 的前提下生效。

#### Scenario: A Chinese paragraph gets the CJK line height

- **WHEN** 页面以中文内容渲染正文段落
- **THEN** 这些段落的行高 MUST 大于 `:lang(en)` 正文段落，且该差异由博客 surface 的单一度量提供

#### Scenario: A Chinese heading drops the Latin display tracking

- **WHEN** 标题的语言为中文
- **THEN** 它 MUST NOT 继承拉丁展示标题的收紧字距

### Requirement: Category entry and filter state

索引页的分类 MUST 是链接到 `?category=<value>` 的入口，且 MUST 对键盘与触屏可达。URL 带 `category` 参数时，索引 MUST 渲染一行页面语言的过滤状态，包含当前分类名与一个清除该参数的链接；URL 不带该参数时，索引 MUST NOT 渲染筛选 UI。

#### Scenario: A category is a working, shareable entry

- **WHEN** 读者在索引页选择一个分类
- **THEN** 页面 MUST 导航到带 `category` 参数的博客索引 URL，而不是依赖只在客户端存在的筛选状态

#### Scenario: The filter state line appears only when filtered

- **WHEN** 博客索引 URL 带有 `category` 参数
- **THEN** 索引 MUST 显示当前分类名与一个清除链接；当 URL 不带该参数时，它 MUST NOT 显示任何筛选条

### Requirement: Language entry reflects content language versus page language

索引与文章的语言入口 MUST 按内容语言与页面语言的关系呈现。跨语言合并时，同一 slug MUST 只列一次；条目链接 MUST 指向内容自身语言的 URL；当内容语言 ≠ 页面语言时，索引 MUST 以读者语言提示该文章仅以另一语言提供；外语标题与摘要 MUST 带指向内容语言的 `lang`，提示行与语言标记 MUST NOT 误用该 `lang`。文章页的语言入口 MUST 仅在另一语言版本存在时渲染。

#### Scenario: A single-language post does not become a dead link

- **WHEN** 一篇只有中文版本的文章出现在英文索引页
- **THEN** 它的链接 MUST 指向该内容自身的 `/zh/blog/<slug>` URL，而非页面语言的路径

#### Scenario: The reader is told the post is in the other language

- **WHEN** 索引条目的内容语言与页面语言不同
- **THEN** 条目 MUST 在读者语言中显示一行提示，且该提示 MUST NOT 被当作外语文本标注

#### Scenario: Foreign text carries its own language

- **WHEN** 页面列出与页面语言不同的标题或摘要
- **THEN** 该文本 MUST 带指向其内容语言的 `lang` 属性

#### Scenario: The post-level language entry appears only with a translation

- **WHEN** 文章在另一语言没有对应版本
- **THEN** 文章页 MUST NOT 渲染指向不存在译文的语言入口

### Requirement: Long unbroken runs do not widen the page

作者可填写的任一文字角色中的长不可断串（URL、哈希、标识符、无标点长句）MUST 在阅读列内换行，MUST NOT 把页面撑宽到出现横向滚动。该契约 MUST 覆盖文章的标题（含小节标题）、dek、metadata 行、索引行的标题与摘要、收尾块的相邻文章标题，以及正文段落；在 375px 起的各视口 MUST 成立。

实现 MUST 满足两件事，缺一不可：换行声明落在博客 surface 上以便被继承；flex 行上的文字项 MUST 能被压到 min-content 以下（或给该行自己的容器设上限），因为 flex item 与 shrink-to-fit 盒都不会自动缩到内容最小宽度以下。

#### Scenario: A long identifier in any text role stays inside the column

- **WHEN** 一篇文章的标题、dek、作者名、小节标题，或索引行的标题/摘要，或收尾块的相邻文章标题里出现一个不可断的长串
- **THEN** 页面 MUST NOT 出现横向滚动，且该角色的右边界 MUST NOT 越过视口

#### Scenario: The wrap rule reaches the roles outside the reading column

- **WHEN** 有人把换行声明只写在正文段落（`.blog-post__reading .prose p`）或只写在标题上
- **THEN** dek / metadata 行 / 索引摘要 / 收尾块相邻标题 MUST 仍被覆盖，否则该宽度下的横向滚动 MUST 被验收矩阵测出

### Requirement: Blog surface excludes reduced-motion handling

博客 surface MUST NOT 引入 `prefers-reduced-motion` 处理或 `motion-reduce:` 工具类；这是 `apps/site/AGENTS.md` 记录的当前产品决定。博客的动效 MUST 限于交互反馈，且 MUST NOT 为阅读面引入动画。

#### Scenario: Adding reduced-motion handling fails the blog guard

- **WHEN** 博客样式或 screen 引入 `prefers-reduced-motion` 或 `motion-reduce:`
- **THEN** 博客护栏测试 MUST 失败

