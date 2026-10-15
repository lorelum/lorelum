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

## Deployment

The site is deployed to **Cloudflare Workers** (project `lorelum`). Production deployment is deliberately manual: run the GitHub Actions **Deploy site** workflow for a verified ref. `wrangler.jsonc` points `main` at `@tanstack/react-start/server-entry`.

Local verification:

```bash
bun run --filter @lorelum/site build
bun run --filter @lorelum/site preview
```

博客索引使用 `wrangler.jsonc` 的 `assets.run_worker_first` 路由到 Worker，使分类、搜索和排序参数在服务端生效；文章和其他预渲染页面保留默认的静态资源优先路由。`vite.config.ts` 排除带 query 的预渲染路径，避免筛选状态覆盖完整索引的 HTML。

验证博客时，在构建产物预览中直接打开带分类或搜索参数的 URL，并用一个确定不匹配任何标题或摘要的词检查空结果：服务端 HTML 与浏览器应显示相同的筛选结果，不能依赖客户端渲染纠正静态页面。另检查中英文文章、亮暗主题、窄屏目录，以及搜索的 Escape 焦点返回、输入 Enter 选择文章和提交按钮 Enter 应用查询。视觉与交互以实际页面为准，不用源码字符串或 CSS 拼写断言替代。

Landing 与博客导航在页面顶部保持透明且无阴影，滚动后由导航面板自身承载共享的 lift 阴影，不能把阴影放进面板裁切的内层背景。验证时检查亮暗主题切换、滚动回顶部后的阴影消失，以及桌面和窄屏胶囊形态；阴影随主题 token 更新，不写入固定颜色。

Release through Actions:

```bash
# GitHub → Actions → Deploy site → Run workflow
# Choose a verified commit or branch ref.
```

`bun run build:site && bun run deploy:site` performs an immediate production upload and is reserved for an explicitly authorized emergency release. See `docs/development/site-deploy.md` for the complete workflow and `docs/research/tanstack-fumadocs-spike.md` for the spike conclusion and risks.
