## 1. frontmatter 契约与一致性

- [ ] 1.1 在 `apps/site/src/features/blog/content/frontmatter.ts` 的 schema 上加入 `updated ≥ date` 校验，并扩展 `content/frontmatter.test.ts`：`updated` 晚于或等于 `date` 通过，早于 `date` 失败。
- [ ] 1.2 复核 schema 只包含当前内容能生产、当前界面能消费的字段；确认 `og:image`、`series`、`canonical` 未被加入，并在实施说明中记录该纪律。
- [ ] 1.3 扩展 `content/frontmatter.test.ts`，断言 `draft` 缺省为 `false`、`updated` 缺省为 `undefined`，且非 `YYYY-MM-DD` 或非真实日历日的输入被拒绝。

## 2. 草稿可见性与发布页面集合

- [ ] 2.1 新增 `apps/site/src/features/blog/model/post-visibility.ts`（单一可见性谓词）及其 colocated `bun:test`：published 在 dev/prod 都可见，draft 在 dev 可见、在非 dev 不可见。
- [ ] 2.2 让 `model/list-posts.ts` 改用该谓词替代内联判断，并保持既有索引测试通过。
- [ ] 2.3 让 `server/load-blog-post.ts` 在非 dev 且文章为草稿时返回 `undefined`，由各路由既有的 `notFound()` 产出 404；新增回归测试覆盖该路径。
- [ ] 2.4 新增 `server/published-pages.ts`（发布页面集合）并让 `apps/site/src/routes/sitemap[.]xml.ts` 改用该集合，使 sitemap 不收录草稿；新增或扩展测试断言草稿 slug 不在 sitemap 输出中。
- [ ] 2.5 在实施提交与说明中把"草稿在非 dev 不可见、sitemap 只收录已发布页面"单列为**可观察行为变更**，不得混入 bug 修复叙述。

## 3. 证据来源与数字表格的作者规则

- [ ] 3.1 新增 `apps/site/src/features/blog/components/blog-evidence-list.tsx`：证据来源以正文可见、非交互的清单呈现，每条给出可解析的外部文档链接，且不使用 disclosure 控件。
- [ ] 3.2 把 `apps/site/content/blog/practice-injection-measurement.mdx` 与 `.zh.mdx` 的 `<Accordions>` 折叠附录替换为可见清单，保持两份文档的证据条目与链接一致。
- [ ] 3.3 为两篇内容的两张结果表格各加一行紧邻的出处/样本图注（来源记录 + 任务数与各条件运行次数），英文与中文版本都补。
- [ ] 3.4 新增 `apps/site/src/features/blog/content/content-contract.test.ts`，扫描 `content/blog/**/*.mdx`：无 `<Accordion` / `<Accordions`；含数字的表格有紧邻出处图注；外链均为 `https`。

## 4. 双语结构与中文排版

- [ ] 4.1 在 `apps/site/src/features/blog/styles/blog.css` 内加入 `:lang(zh)` 度量：中文正文行高大于拉丁正文、中文标题不继承拉丁展示字距；规则 MUST NOT 落在 `:root`。
- [ ] 4.2 扩展 `apps/site/src/features/blog/styles/blog.test.ts`：断言 `:lang(zh)` 规则存在、样式不含 hex 字面量、且不含 `prefers-reduced-motion`。
- [ ] 4.3 在 `content-contract.test.ts` 中加入 EN/ZH `##` 标题数量相等的断言，并确认当前两篇文件（各 8 个）通过。

## 5. 分类入口与语言入口

- [ ] 5.1 把索引页分类渲染为指向 `?category=<value>` 的链接（键盘与触屏可达），并在带参数时渲染一行本地化过滤状态与清除链接；无参数时不渲染筛选 UI。
- [ ] 5.2 新增纯函数 `model/blog-routes.ts` 的 `blogPostPath(locale, slug)` 及其测试：条目链接指向内容自身语言的 URL（ZH-only 条目在 EN 页面必须链到 `/zh/blog/<slug>`），修掉单语文章的死链。
- [ ] 5.3 索引按"内容语言 vs 页面语言"显示读者语言的提示行，外语标题/摘要带 `lang={contentLocale}`，并移除 `translatedMarker()`；扩展 `model/entry-meta.test.ts` 覆盖提示选择。
- [ ] 5.4 文章页语言入口只在另一语言版本存在时渲染，且 `hreflang` / `aria-label` 正确；无译文时不得渲染指向不存在译文的入口。

## 6. 验证

- [ ] 6.1 运行 `bun run --filter @lorelum/site test`，确认新增与既有博客测试全绿。
- [ ] 6.2 运行 `bun run typecheck`，确认未引入新的第三个错误（既有两个 docs 错误与本任务无关，不修）。
- [ ] 6.3 运行 `bun run --filter @lorelum/site build` 与 `bun run lint`；在构建产物的博客 CSS chunk 中确认 `:lang(zh)` 规则实际生效，而非只存在于源码。
- [ ] 6.4 运行 `openspec validate add-site-blog-content-contract --strict` 与 `git diff --check`，确认 delta spec、任务状态与改动范围一致。
