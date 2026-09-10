# 官网部署工作流（Cloudflare Workers + GitHub Actions）

> **适用范围**：`apps/site`（Lorelum 官网：Landing + Docs）。
> **线上地址**：https://lorelum.com
> **部署目标**：Cloudflare **Workers**（项目名 `lorelum`），正式发布通过 **GitHub Actions 手动触发**（`.github/workflows/deploy-site.yml`），本地应急发布可用 `wrangler deploy` 直传。
> **更新日期**：2026-09-10

## 1. 部署形态（先搞清楚再动手）

`apps/site` 用官方 `@cloudflare/vite-plugin`（SSR Worker 模式）构建：

- `bun run build:site` 产出 `apps/site/dist/`（`dist/client` 静态资源 + `dist/server` Worker）
- `wrangler.jsonc` 的 `main` 指向 `@tanstack/react-start/server-entry`
- Cloudflare 后台项目类型是 **Worker**（不是 Pages）；线上地址 `https://lorelum.com` 由后台为 Worker 绑定的自定义域提供

**常见误区**：本项目不走 Cloudflare Pages，也不使用 push 自动部署。Workers Builds 的 Git 集成已断开；只有明确运行 GitHub Actions 的 `Deploy site` workflow，或在本地执行 `wrangler deploy`，才会更新线上 Worker。

## 2. 两种上线方式

| 方式 | 触发 | 成本 | 适用场景 |
|---|---|---|---|
| **Actions 手动发布** | Actions → Deploy site → Run workflow | GitHub Actions（公开仓库免费） | 已验证 commit 的正式发布 |
| **本地直传** | 本地 `bun run build:site && bun run deploy:site` | 无 | 有明确需要的应急发布 |

合并和发布现在是两个独立动作。任何 push，包括 push 到 `main`，都不会触发生产部署；发布者必须在 Actions 中明确选择目标 ref 并运行 workflow。

## 3. 日常迭代工作流（推荐，零配额消耗）

改版期间**不需要每次 push 触发构建**，全部在本地完成：

```bash
# 1) 本地开发（vite dev，含 Worker 运行时模拟）
bun install
bun run --filter @lorelum/site dev          # http://localhost:3000

# 2) 类型检查
bun run --filter @lorelum/site typecheck

# 3) 验证生产产物
bun run build:site                          # 产出 apps/site/dist
cd apps/site && bun run preview             # vite preview 预览产物
# 或验证 Worker 运行时：
cd apps/site && npx wrangler dev --port 8788

# 4) 日常迭代到本地生产预览结束；不要把线上部署当作预览手段
```

正式发布按第 6 节手动运行 GitHub Actions。`bun run deploy:site` 会立即更新 `lorelum.com`，只作为有明确需要的应急路径。

## 4. 成本说明

- 正式发布按需运行在 **GitHub Actions**，不会因每次合并自动消耗构建时间。
- Workers Builds（Cloudflare 端构建）的 Git 集成已断开（见 §5），不再产生构建分钟消耗；免费档 3,000 build 分钟/月 的配额因此与本部署流程无关。
- 本地直传同 §2，不消耗 GitHub Actions 或 Workers Builds 配额。

## 5. 手动部署现状（GitHub Actions）

正式发布由 `.github/workflows/deploy-site.yml` 驱动：

| 项 | 值 | 说明 |
|---|---|---|
| 触发 | `workflow_dispatch` | GitHub 页面 Actions → Deploy site → Run workflow；push 不触发 |
| 目标版本 | Run workflow 时选择的 ref | 正式发布通常选择已通过 CI 的 `main` |
| 并发控制 | `concurrency: deploy-site` + `cancel-in-progress` | 新的手动发布请求会取消仍在执行的旧部署 |
| 认证 | GitHub `production` Environment secrets：`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | Token 为 Cloudflare 后台创建的专用 deploy token |

> 2026-09-10 起，GitHub Actions 也不再响应 push。Workers Builds 的 Git 集成继续保持断开，避免出现绕过人工发布动作的第二条自动部署路径。

### 操作方式

- **正式发布**：Actions → Deploy site → Run workflow，选择已经完成验证的 ref 后运行。
- **CLI 触发**：`gh workflow run deploy-site.yml --ref main`，随后到 Actions 页面核对目标 SHA 和结果。
- **恢复自动部署**：需要重新评审发布风险，并确保 GitHub Actions 与 Cloudflare 端只有一条自动部署路径。

## 6. 正式发布（Go Live）

```bash
# 在 feature 分支完成开发、验证后合并到 main；此时不会自动上线
git checkout main && git merge feat/xxx
git push origin main

# 明确发布已验证的 main
gh workflow run deploy-site.yml --ref main
```

发布后在 Actions 页面确认 workflow 对应的 commit SHA 与预期一致。仅在有明确应急需要时使用本地直传：

```bash
bun run build:site && bun run deploy:site
```

## 7. 相关命令速查

（均在仓库根目录，见根 `package.json`）

| 命令 | 作用 |
|---|---|
| `bun run build:site` | 构建 `apps/site` → `apps/site/dist/` |
| `bun run deploy:site` | `cd apps/site && npx wrangler deploy`（手动直传线上站点） |
| `bun run versions:site` | `cd apps/site && npx wrangler versions upload`（上传非生产版本，不切流量） |

## 8. 已知问题 / 排障

- **push 后没有部署**：这是预期行为；到 Actions → Deploy site 手动运行 workflow。
- **Run workflow 不可用**：确认 workflow 已存在于默认分支且当前账号具有 Actions 运行权限。
- **认证失败（Authentication error）**：检查 repo secrets `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 是否有效；Token 在 Cloudflare 后台 My Profile → API Tokens 管理。
- **配额查询**：手动部署按需运行在 GitHub Actions；Cloudflare 端构建历史在 Workers & Pages → `lorelum` → Deployments。

## 关联

- `docs/research/tanstack-fumadocs-spike.md` — 技术选型 spike 结论
- `apps/site/README.md` — 站点开发说明
