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

### Requirement: 左栏内容由已发布内容派生

左栏 SHALL 由已发布文章与分类派生，MUST NOT 引入新的数据源或新的 frontmatter 字段。当前文章 SHALL 以与全站一致的方式标记为当前目的地。

#### Scenario: 单篇文章时仍是可用导航

- **WHEN** 仓库只有一篇已发布文章时打开文章页
- **THEN** 左栏列出该文章（标记为当前）与分类链接，而不是空栏

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
