# Lorelum site (TanStack Start + Fumadocs)

Landing + Docs site built with [TanStack Start](https://tanstack.com/start) and
[Fumadocs](https://fumadocs.dev). Part of the P0 website spike
([#1](https://github.com/AzMilabo/lorelum/issues/1)).

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
- `/llms.txt`, `/llms-full.txt` — LLM-friendly content export
- `/api/search` — built-in ZBSearch endpoint

Content is owned by the Docs feature: the server-side Fumadocs source lives in
`src/features/docs/server/source.ts`, while browser MDX loading lives in
`src/features/docs/content/client.ts`. The shared locale configuration is in
`src/shared/i18n/config.ts`.

## Deployment

The site is deployed to **Cloudflare Workers** (project `lorelum`). Production
deployment is deliberately manual: run the GitHub Actions **Deploy site**
workflow for a verified ref. `wrangler.jsonc` points `main` at
`@tanstack/react-start/server-entry`.

Local verification:

```bash
bun run --filter @lorelum/site build
cd apps/site && npx wrangler dev --port 8788
```

Release through Actions:

```bash
# GitHub → Actions → Deploy site → Run workflow
# Choose a verified commit or branch ref.
```

`bun run build:site && bun run deploy:site` performs an immediate production
upload and is reserved for an explicitly authorized emergency release. See
`docs/development/site-deploy.md` for the complete workflow and
`docs/research/tanstack-fumadocs-spike.md` for the spike conclusion and risks.
