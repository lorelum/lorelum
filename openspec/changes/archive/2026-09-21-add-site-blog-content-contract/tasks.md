## 1. frontmatter 契约与一致性

- [x] 1.1 在 `apps/site/src/features/blog/content/frontmatter.ts` 的 schema 上加入 `updated ≥ date` 校验，并扩展 `content/frontmatter.test.ts`：`updated` 晚于或等于 `date` 通过，早于 `date` 失败。
      - 证据：`frontmatter.ts` 的 `.refine(... path: ["updated"])`（字符串比较即时间序，两个字段都被 `isoDate` 约束为 `YYYY-MM-DD`）；`frontmatter.test.ts` **两条**新用例（同日通过 / 早一天失败且 issue 指向 `updated`）；「完整 frontmatter 默认 `draft: false`、`updated` 缺省」那条在 `ac444aa` 之前就存在，属任务 1.3 的既有覆盖。第 4 轮复核指出此处原写「三条」，已改。门禁：`bun run --filter @lorelum/site test`。**实施于阶段 4**（此前为未实施）。
- [x] 1.2 复核 schema 只包含当前内容能生产、当前界面能消费的字段；确认 `og:image`、`series`、`canonical` 未被加入，并在实施说明中记录该纪律。
      - 证据：schema 字段集为 `title/description/date/category/author/updated?/draft`（`frontmatter.ts`）；`check-stage3-constraints.py` 断言三个字段在源码与产物中都不存在（各自「源码 + 产物」两条检查）。该纪律的落地位置是本任务行与 PR 描述：任何新增字段的提案必须同时给出生产者与消费者。
- [x] 1.3 扩展 `content/frontmatter.test.ts`，断言 `draft` 缺省为 `false`、`updated` 缺省为 `undefined`，且非 `YYYY-MM-DD` 或非真实日历日的输入被拒绝。
      - 证据：`frontmatter.test.ts` 的「defaults draft to false」/「accepts optional updated」/「rejects an impossible calendar date」/「rejects a date that is not YYYY-MM-DD」四组用例。

## 2. 草稿可见性与发布页面集合

- [x] 2.1 新增 `apps/site/src/features/blog/model/post-visibility.ts`（单一可见性谓词）及其 colocated `bun:test`：published 在 dev/prod 都可见，draft 在 dev 可见、在非 dev 不可见。
      - 证据：`post-visibility.ts`（`isPostVisible({ draft, isDevelopment })`）与 `post-visibility.test.ts` 2 条用例。
- [x] 2.2 让 `model/list-posts.ts` 改用该谓词替代内联判断，并保持既有索引测试通过。
      - 证据：`list-posts.ts` 的 `if (!isPostVisible({ draft: record.data.draft, isDevelopment })) continue;`；`BlogIndexOptions.isDevelopment` **必填**（无默认值，编译期强制调用点声明环境），`server/list-blog-posts.ts` 传 `import.meta.env.DEV`。`list-posts.test.ts` 新增「lists a draft while developing, because its own URL answers there」并对比 dev/prod 两侧。**实施于阶段 4**：该改动同时消掉了「dev 索引不列草稿、而草稿 URL 在 dev 可读」的不一致（阶段 3 证据 §11.10），实测见 `.tmp/stage4-visibility.json`。
- [x] 2.3 让 `server/load-blog-post.ts` 在非 dev 且文章为草稿时返回 `undefined`，由各路由既有的 `notFound()` 产出 404；新增回归测试覆盖该路径。
      - 证据：`load-blog-post.ts:41,52` 两处 `isPostVisible`（文章本体与「译文是否为草稿」）；产物级读数：`.tmp/stage4-visibility.json`（两篇都标草稿时生产构建不产出任何文章页；dev 下两个索引各 1 行且文章 URL 200）；404 读数在阶段 3 的录制 `.tmp/draft-probe-facts.json` 里，由 `check-stage3-matrix.py` 重新推导。**接线守卫**（本阶段补）：`server/post-visibility-wiring.test.ts` 钉住两处 `isPostVisible` 都传 `import.meta.env.DEV`——此前 `load-blog-post.ts` 没有任何 colocated 测试，把该处改成 `true`（草稿在构建里也可读）时 181 条测试全绿。
- [x] 2.4 新增 `server/published-pages.ts`（发布页面集合）并让 `apps/site/src/routes/sitemap[.]xml.ts` 改用该集合，使 sitemap 不收录草稿；新增或扩展测试断言草稿 slug 不在 sitemap 输出中。
      - 证据：`published-pages.ts` 调用同一谓词并固定 `isDevelopment: false`（阶段 4 改动：此前是内联 `!draft`，「单一来源」这条此前并不成立）；`routes/sitemap[.]xml.ts` 只消费该集合。sitemap 输出是**被服务的路由**，因此读数取自 `vite preview`：`.tmp/stage4-visibility.json` 记录了两篇都标草稿时 `/sitemap.xml` 200、52 条 loc、两个博客 slug 都不在；还原发布态后 54 条 loc、slug 在。**说明（复核指出，已补）**：在补之前，没有任何单元测试断言「sitemap 排除草稿」，把该处的 `isDevelopment` 改成 `true` 或换回内联 `!draft` 都能让 181 条测试全绿；本阶段补了 `server/post-visibility-wiring.test.ts` 把「同一谓词 + 固定非 dev」写入守卫，效果级读数仍由上面的探针提供。
- [x] 2.5 在实施提交与说明中把"草稿在非 dev 不可见、sitemap 只收录已发布页面"单列为**可观察行为变更**，不得混入 bug 修复叙述。
      - 证据：阶段 3 证据 §4 按「可观察行为变更」单列；阶段 4 的提交信息同样把「dev 索引改为列出草稿」写成独立的行为变更段，而不是混进换行修复。

## 3. 证据来源与数字表格的作者规则

- [x] 3.1 新增 `apps/site/src/features/blog/components/blog-evidence-list.tsx`：证据来源以正文可见、非交互的清单呈现，每条给出可解析的外部文档链接，且不使用 disclosure 控件。
- [x] 3.2 把 `apps/site/content/blog/practice-injection-measurement.mdx` 与 `.zh.mdx` 的 `<Accordions>` 折叠附录替换为可见清单，保持两份文档的证据条目与链接一致。
- [x] 3.3 为两篇内容的两张结果表格各加一行紧邻的出处/样本图注（来源记录 + 任务数与各条件运行次数），英文与中文版本都补。
- [x] 3.4 新增 `apps/site/src/features/blog/content/content-contract.test.ts`，扫描 `content/blog/**/*.mdx`：无 `<Accordion` / `<Accordions`；含数字的表格有紧邻出处图注；外链均为 `https`。

## 4. 双语结构与中文排版

- [x] 4.1 在 `apps/site/src/features/blog/styles/blog.css` 内加入 `:lang(zh)` 度量：中文正文行高大于拉丁正文、中文标题不继承拉丁展示字距；规则 MUST NOT 落在 `:root`。
- [x] 4.2 扩展 `apps/site/src/features/blog/styles/blog.test.ts`：断言 `:lang(zh)` 规则存在、样式不含 hex 字面量、且不含 `prefers-reduced-motion`。
- [x] 4.3 在 `content-contract.test.ts` 中加入 EN/ZH `##` 标题数量相等的断言，并确认当前两篇文件（各 8 个）通过。

## 5. 分类入口与语言入口

- [x] 5.1 把索引页分类渲染为指向 `?category=<value>` 的链接（键盘与触屏可达），并在带参数时渲染一行本地化过滤状态与清除链接；无参数时不渲染筛选 UI。
- [x] 5.2 新增纯函数 `model/blog-routes.ts` 的 `blogPostPath(locale, slug)` 及其测试：条目链接指向内容自身语言的 URL（ZH-only 条目在 EN 页面必须链到 `/zh/blog/<slug>`），修掉单语文章的死链。
- [x] 5.3 索引按"内容语言 vs 页面语言"显示读者语言的提示行，外语标题/摘要带 `lang={contentLocale}`，并移除 `translatedMarker()`；扩展 `model/entry-meta.test.ts` 覆盖提示选择。
- [x] 5.4 文章页语言入口只在另一语言版本存在时渲染，且 `hreflang` / `aria-label` 正确；无译文时不得渲染指向不存在译文的入口。

## 6. 验证

- [x] 6.1 运行 `bun run --filter @lorelum/site test`，确认新增与既有博客测试全绿。
- [x] 6.2 运行 `bun run typecheck`，确认未引入新的第三个错误（既有两个 docs 错误与本任务无关，不修）。
- [x] 6.3 运行 `bun run --filter @lorelum/site build` 与 `bun run lint`；在构建产物的博客 CSS chunk 中确认 `:lang(zh)` 规则实际生效，而非只存在于源码。
- [x] 6.4 运行 `openspec validate add-site-blog-content-contract --strict` 与 `git diff --check`，确认 delta spec、任务状态与改动范围一致。

      - 证据（3.x）：`components/blog-evidence-list.tsx`（清单、无 disclosure）、两份内容的 `<Accordion*>` 已改为可见清单、两张结果表各有紧邻图注；`content/content-contract.test.ts` 扫描 `content/blog/**/*.mdx` 断言无 `<Accordion`、数字表格有图注、外链为 `https`。
      - 证据（4.x）：`styles/blog.css` 的 `:lang(zh)` 度量（行高 × 1.08、`letter-spacing: 0`）、`styles/blog.test.ts` 断言存在且不含 hex 字面量与 `prefers-reduced-motion`；`content-contract.test.ts` 断言 EN/ZH 的 `##` 数量相等。
      - 证据（5.x）：`blog-entry-row.tsx` 的分类链接与 `?category=` 入口、`blog-routes.ts` 的 `blogPostPath(locale, slug)`、`model/entry-meta.ts` 的提示行与 `lang=`、文章页语言入口仅在译文存在时渲染（`.tmp/stage4-visibility.json` 与 `.tmp/matrix-translation-en-draft.json`）。
      - 证据（6.x）：门禁与自检脚本的读数见阶段 3 证据 §1/§16/§18.4；`openspec validate ... --strict`（valid）与 `git diff --check`（干净）见 §18.4。**接线守卫的边界**：`server/post-visibility-wiring.test.ts` 是源文本断言（与其它守卫同类，上限已在 §14.3 披露）；效果级读数由 `.tmp/stage4-visibility.py` 与 `.tmp/check-stage3-matrix.py` 从产物重算。
