## Why

用户要求把博客页做成有高级感、设计感、可直接上线的成品，并批准按推荐方案执行：技术期刊式完整版面，双主题同等对待，只靠版式、比例与排版取得质感，不新增展示字体、材质或光效；文章页纳入改版；默认不加入新动效。

这一改动会替换 `add-site-blog-editorial-shell` 中已冻结的若干可见契约（三栏文章布局之外的索引形态、664px 阅读列的版式归属、索引卡片与主稿结构），属于大变更，按 AGENTS.md 先提案再实施。

## 版本回流策略

- 基线：git tag `blog-v1-baseline`（commit `04b40b0`）。v1 的全部代码、测试、OpenSpec 规划均可由该 tag 完整还原。
- 工作分支：`feat/blog-redesign-v2`，自基线切出。
- 单一代码路径：v2 直接替换 v1 实现，不引入 feature flag 或 v1/v2 并存分支，避免新旧逻辑混杂。
- 每个实施步骤单独提交，便于按提交回滚；回滚路径为 `git revert` 对应提交区间，或从 `blog-v1-baseline` 切出新分支。
- 旧 change `add-site-blog-editorial-shell` 保持原样不改写；v2 的 spec 增量以 `REMOVED`/`MODIFIED` 标明替换关系。v2 验收通过后再归档 v1，归档不删除历史内容。
- v1 基线的截图与 dist 作为对照证据保存在 `.tmp/`（已忽略，不入库）。

## What Changes

- 索引页：顶部平铺分类导航与搜索保留；主稿为品牌绿 stage 舞台内左标题右图版，摘要与元数据在下方独立成区；后续条目为分隔线列表，不再使用卡片。
- 文章页：纳入同一视觉系统。首屏与索引共用图版与标题层级；左导航与右目录保留，间距与线条按统一网格重排。
- 视觉系统：只使用 DESIGN.md 已有的 token 与圆角档位（control / panel / stage），不新增 token、字体或玻璃材质。
- 动效：默认无新增动效；hover 与焦点反馈沿用 v1 已批准的克制规则。
- 不变量保持：无 JS 时查询 URL 返回完整静态索引；`q`、`category`、`sort` 参数名与语义不变；搜索弹窗复用 docs 组件；封面表达 baseline / placebo / oracle 三条件，不画测量结果；缓办项（og:image、canonical/series、RSS、阅读时长）不做。

## Impact

- 代码：`apps/site/src/features/blog/**`（索引、文章页组件与样式）、`apps/site/src/shared/i18n/legacy-translations.ts`（仅在必要时增删文案）。
- 测试：按获准迁移与替换旧版式守卫；无 JS、搜索、焦点、触达、i18n 守卫保留。
- 不涉及：`packages/ui` token、DESIGN.md、路由结构、内容数据源、frontmatter 字段。
- 不引入依赖。
