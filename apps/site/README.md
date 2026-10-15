# Lorelum site (TanStack Start + Fumadocs)

Lorelum 的 Landing、双语 Docs 与博客站点，使用 [TanStack Start](https://tanstack.com/start) 和 [Fumadocs](https://fumadocs.dev)。

## Development

```bash
bun install
bun run --filter @lorelum/site dev        # http://localhost:3000
bun run --filter @lorelum/site typecheck  # tsc --noEmit
bun run --filter @lorelum/site build      # static + Cloudflare Worker output in dist/
```

## Routes

- `/` — landing (default English), with a client-hydrated terminal demo
- `/en` / `/zh` — per-locale landing
- `/en/docs` / `/zh/docs` — bilingual docs (en: `content/docs/*.mdx`, zh: `*.zh.mdx`)
- `/blog` / `/zh/blog` — 双语博客索引；文章位于各自的 `/<slug>` 路径。`/en/blog` 也可访问，英文 canonical 使用无语言前缀的地址。
- `/llms.txt`, `/llms-full.txt` — LLM-friendly content export
- `/api/search` — built-in ZBSearch endpoint

Docs 与 Blog 分别拥有自己的内容集合，共用 Fumadocs MDX 编译管线。各 feature 的 `content/registry.ts` 定义集合，`server/source.ts` 提供服务端内容索引，`content/client.ts` 按需加载编译后的正文与目录。博客 frontmatter 契约位于 `src/features/blog/content/frontmatter.ts`；语言配置共用 `src/shared/i18n/config.ts`。

博客索引默认只在第一页主推最新文章；标题、完整摘要和元信息常显，桌面左文右图、手机先文后图。

普通文章使用稳定的双列封面卡片，窄屏单列：封面按原始比例铺满卡片宽度（首发素材为 16:10），完整标题、摘要与元信息在下。只有外层卡片负责圆角裁切，图片不再叠独立圆角、边框或固定比例底框；键盘焦点绘制在外层，不被图片裁切。卡片高度随真实内容自然增长，不用截断摘要统一高度；没有作者提供的图片时直接显示文字区域，不补空框。分类、搜索与非默认排序使用同一卡片列表，不主推结果中的某篇文章。文章正文与索引共用原始图片。

文章页封面和正文图片沿用共享 panel 圆角。正文入口保留 panel 留白，较宽屏幕使用 block 留白；正文图片前后使用 panel 留白，带图注时将这段留白放在整个 figure 外侧，不重复加在图片与图注之间。图片间距规则只作用于博客正文，不影响 Docs 或页面目录。文章收尾卡片同样由外层统一裁切圆角并绘制键盘焦点，不在图片边缘叠加边框；有作者图片和生成式封面都沿用这一边界。

`page` 控制 URL 分页，每页 12 条普通条目，主推文章不计入分页序列且不重复出现；第一页省略 `page=1`。非法页码使用第一页，超出范围时显示最后一页。翻页保留 `category`、`sort` 和 `q`，分类、搜索与重置操作回第一页；后退和前进恢复对应 URL 的状态。列表和主推的分配由 `src/features/blog/model/index-layout.ts` 负责，不按文章数量循环切换版式。

## Deployment

The site is deployed to **Cloudflare Workers** (project `lorelum`). Production deployment is deliberately manual: run the GitHub Actions **Deploy site** workflow for a verified ref. `wrangler.jsonc` points `main` at `@tanstack/react-start/server-entry`.

Local verification:

```bash
bun run --filter @lorelum/site build
bun run --filter @lorelum/site preview
```

博客索引使用 `wrangler.jsonc` 的 `assets.run_worker_first` 路由到 Worker，使分类、搜索、排序和分页参数在服务端生效；文章和其他预渲染页面保留默认的静态资源优先路由。`vite.config.ts` 排除带 query 的预渲染路径，避免筛选状态覆盖完整索引的 HTML。

验证博客时，在构建产物预览中直接打开带分类或搜索参数的 URL，并用一个确定不匹配任何标题或摘要的词检查空结果：服务端 HTML 与浏览器应显示相同的筛选结果，不能依赖客户端渲染纠正静态页面。另检查中英文文章、亮暗主题、窄屏目录，以及搜索的 Escape 焦点返回、输入 Enter 选择文章和提交按钮 Enter 应用查询。视觉与交互以实际页面为准，不用源码字符串或 CSS 拼写断言替代。

索引布局验收使用临时内容扩充到 3、12 及跨三页的文章数量，检查列表顺序、跨页无重复、缺图条目、长标题和完整摘要；结束后删除临时内容并重新构建真实文章集。分页检查需覆盖直接请求第二页、非法与越界页码、筛选后的翻页、筛选/搜索重置页码、返回历史，以及只有一种语言的文章回退链接与提示。通过实际键盘导航检查焦点，手机分页链接的点击区域至少为 44×44 CSS 像素。

Landing 与博客导航在页面顶部保持透明且无阴影，滚动后由导航面板自身承载共享的 lift 阴影，不能把阴影放进面板裁切的内层背景。验证时检查亮暗主题切换、滚动回顶部后的阴影消失，以及桌面和窄屏胶囊形态；阴影随主题 token 更新，不写入固定颜色。

Release through Actions:

```bash
# GitHub → Actions → Deploy site → Run workflow
# Choose a verified commit or branch ref.
```

`bun run build:site && bun run deploy:site` performs an immediate production upload and is reserved for an explicitly authorized emergency release. See `docs/development/site-deploy.md` for the complete workflow and `docs/research/tanstack-fumadocs-spike.md` for the spike conclusion and risks.
