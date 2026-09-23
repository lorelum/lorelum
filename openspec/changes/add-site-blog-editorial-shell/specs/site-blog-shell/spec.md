# site-blog-shell

## ADDED Requirements

### Requirement: 博客索引与文章页共用一套三栏壳

博客的索引页与文章页 SHALL 渲染同一套壳结构：左栏（博客导航）、中间阅读列、右栏（文章页的目录）。左栏 SHALL 贴壳的左边缘，右栏 SHALL 贴壳的右边缘；壳 SHALL 通栏，MUST NOT 以固定宽度居中形成孤岛。

#### Scenario: 宽视口下目录接近视口右缘

- **WHEN** 在 ≥ 1280px 的视口打开任一文章页
- **THEN** 目录轨的右边缘距视口右缘不超过壳的横向内边距（实测值记入证据），而不是现状的数百像素

#### Scenario: 索引页与文章页的壳一致

- **WHEN** 在 ≥ 1024px 的视口分别打开索引页与文章页
- **THEN** 两者的左栏在同一横向位置、宽度相同

### Requirement: 断点上的栏存在性可预期

壳 SHALL 在 ≥ 1280px 显示左栏与右栏，在 1024–1279px 只显示左栏，在 < 1024px 只显示阅读列。右栏缺席时 SHALL 回落到既有的 `<details>` 目录披露。

#### Scenario: 窄视口不强行三栏

- **WHEN** 视口 < 1024px
- **THEN** 不渲染左栏，正文列宽与改造前相同

### Requirement: 博客导航与分类筛选由已发布内容派生

文章导航 SHALL 由已发布文章派生；索引筛选控件中的分类 SHALL 由同一组已发布文章派生。两者 MUST NOT 引入新的数据源或新的 frontmatter 字段。当前文章 SHALL 以与全站一致的方式标记为当前目的地。

#### Scenario: 单篇文章时仍是可用导航

- **WHEN** 仓库只有一篇已发布文章时打开文章页或索引
- **THEN** 文章页的文章导航列出该文章并标记为当前，索引的分类选项由该已发布内容派生

#### Scenario: 草稿不出现在左栏

- **WHEN** 存在 `draft: true` 的文章
- **THEN** 它 MUST NOT 出现在左栏，与索引、sitemap 的可见性规则一致

### Requirement: 博客路由的导航具备挂载态

在博客路由上，导航 SHALL 在滚动越过文章头部后进入与首页相同的紧凑态（复用现有 panel morph 的几何），并在回到顶部时复原。该行为 MUST NOT 依赖 hero 元素的存在。docs 面的导航行为 MUST NOT 改变。

#### Scenario: 文章页下滑后导航收缩

- **WHEN** 在文章页向下滚动越过文章头部
- **THEN** 导航 panel 进入紧凑态；回到顶部后复原为全宽

#### Scenario: docs 面不受影响

- **WHEN** 在 docs 面滚动
- **THEN** 导航 panel 的几何保持全宽（与改造前一致）

### Requirement: 阅读列宽度与既有度量不变

阅读列的宽度 SHALL 保持改造前的实测值（664px，620–675 区间内），图版出栏 MUST NOT 改变正文文字的度量。

#### Scenario: 正文度量不回归

- **WHEN** 在 ≥ 768px 视口打开文章页
- **THEN** 正文列宽仍在 620–675px 区间内，且横向溢出为 0

### Requirement: 索引以卡片呈现条目，并提供常驻的筛选与排序

索引 SHALL 以「有界的卡片」呈现每个条目（色调表面 + `panel` 圆角 + 内边距 + `--blog-hairline` 细线），条目之间以间距分隔而不是分隔线；卡片是带边框的面板，SHALL 占满中间轨道（正文的 68ch 度量属于正文，不属于面板）。分类 SHALL 以 Badge（胶囊）呈现，与文章页元数据行使用同一组件。卡片 SHALL 整卡可点，但**只有标题是交互元素**（链接以拉伸覆盖层覆盖卡片，而不是把卡片本身变成链接）。

索引 SHALL 常驻渲染筛选与排序控件：视口 ≥ 1024px 时放在左栏，视口 < 1024px 时放在卡片列表上方，且同一时刻只显示一组。分类 SHALL 是链接行，排序 SHALL 是 4 个链接胶囊；每个链接 SHALL 保留另一项搜索状态，复位链接 SHALL 显式清除两项状态。控件 MUST NOT 使用原生 `<select>` 或 GET 表单。两者 SHALL 是 URL 状态（`?category=`、`?sort=`），无需 JavaScript 即可导航，并由服务端/预渲染渲染结果列表；未知取值 SHALL 回落为默认而不是报错。链接 SHALL 不小于 `--lore-size-touch` 并使用共享焦点环，而不是输入控件边界角色。文章页 SHALL NOT 渲染这些控件（改了不影响该页的控件等于无控件）。

#### Scenario: 卡片与分隔方式

- **WHEN** 在 ≥ 1024px 视口打开索引
- **THEN** 每个条目渲染为带表面、细线与 `panel` 圆角的有界卡片，占满中间轨道，条目之间没有分隔线

#### Scenario: 筛选与排序控件随视口切换位置

- **WHEN** 在 < 1024px 视口打开索引
- **THEN** 一组筛选与排序链接显示在卡片列表上方，左栏副本不显示且不进入键盘顺序
- **WHEN** 在 ≥ 1024px 视口打开索引
- **THEN** 同一组控件显示在左栏，卡片上方副本不显示且不进入键盘顺序

#### Scenario: 悬停/聚焦反馈不违反阅读面约定

- **WHEN** 检查索引卡片的悬停与聚焦样式
- **THEN** 反馈 SHALL 是卡片自身的边框与抬升（`--lore-shadow-lift`），MUST NOT 使用 `group-hover` 或任何只在悬停时出现的元素——该约定由 `blog-identity.test.ts` 守住

#### Scenario: 无 JavaScript 也能筛选与排序

- **WHEN** 关闭 JavaScript 后访问 `?category=<空分类>`
- **THEN** 服务端返回的 HTML 已不含任何条目并显示空状态文案

#### Scenario: 排序反映在控件状态里

- **WHEN** 访问 `?sort=title-desc`
- **THEN** 排序控件显示该档为选中，且分类链接保留同一排序值

### Requirement: 文章导航与筛选控件各自单一

博客索引的文章导航 SHALL 只列出文章；分类入口 SHALL 只由索引筛选控件提供，不得在文章导航中重复列出。文章页 SHALL NOT 渲染索引筛选与排序控件。

#### Scenario: 索引不重复分类入口

- **WHEN** 打开博客索引
- **THEN** 分类入口只出现在一组筛选控件中，文章导航只列文章

#### Scenario: 文章页不显示索引控件

- **WHEN** 打开博客文章页
- **THEN** 筛选与排序控件均不渲染
