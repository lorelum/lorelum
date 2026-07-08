# AGENTS.md

> This file tells AI coding agents how to work **in this specific repo**. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the human workflow. If you're using an AI assistant, point it at this file.

## Project

Lorelum is an engineering-knowledge infrastructure for AI coding agents. It retrieves team "Practices" (discrete engineering guidelines) and injects them into AI context on demand. This repo will hold the core engine, CLI (`lore`), local MCP server, and format spec.

The codebase is **Bun + TypeScript**, organized as a Bun workspace monorepo (`packages/*`). The exact commands are in [Commands](#commands) below; conventions in [Code style](#code-style) and [Testing](#testing).

The companion knowledge-pack repo lives elsewhere (`lorelum/lorelum-packs`). This repo does not contain knowledge-pack content.

## Layout

The source tree is a Bun workspace monorepo (`packages/cli`, `packages/engine`, `packages/format`, `packages/mcp`, `packages/shared`). Repo-root `package.json` declares `workspaces: ["packages/*"]`.

**The product contract to be aware of:**
- **Practice / pack format** — the public schema that packs and users depend on. Changes are high-impact; see CONTRIBUTING.md.
- **Retrieval engine** — performance-sensitive; benchmark before changing.

## Commands

- **Runtime:** Bun ≥ 1.1 (TypeScript support is built in — no separate `tsc`/Node install needed)
- **Install deps:** `bun install`
- **Run a workspace script:** `bun run <script>` (or just `bun <script>`)
- **Test:** `bun test` (uses `bun:test`)
- **Lint:** `bun run lint` (oxlint)
- **Format:** `bun run fmt` (oxfmt)
- **Typecheck:** `bun run typecheck` (`tsc --noEmit`)
- **Build single binary:** `bun build --compile`

Precise scripts live in each `packages/*/package.json`; the above is what the root delegates to. Keep CI green on whatever it runs.

## Code style

TypeScript is the language; Bun runs it. These rules apply from day one.

- **Strict mode.** `tsconfig.json` has `strict: true`. No `any` without justification; if unavoidable, mark `// @ts-expect-error: <reason>` (reason required).
- **Naming.** TypeScript community norms: `PascalCase` for types/interfaces/classes, `camelCase` for functions/variables. Apply uniformly.

- **Small, composable modules.** Prefer pure functions. Avoid deep class hierarchies unless modeling genuine state.
- **Typed errors over bare strings.** Throw specific error types; let the CLI/MCP boundary translate them into user-facing messages. Never throw a bare string.
- **No silent failures.** A function that can fail should signal it explicitly (typed error, Result, or similar) — not return `null` and hope.
- **Naming:** consistent with the chosen language's prevailing conventions. Whatever they are, apply them uniformly.

## Testing

- New code ships with tests. No exceptions for the format/parser and retrieval layers.
- Test framework is `bun:test`. Test files are `*.test.ts`, colocated next to the source they cover. The format/parser and retrieval layers must have tests for every new behavior.
- **Mock filesystem and network** — never hit the real registry in unit tests.
- When fixing a bug, add a regression test that fails before the fix and passes after.

## Git workflow

- **Never commit directly to `main`.** Every change goes through a PR.
- **One issue per PR.** Keep PRs focused and reviewable. If a change spans multiple issues, split it.
- **Conventional Commits** (`feat(cli): ...`, `fix(engine): ...`, `spec(format): ...`, `docs: ...`).
- **Every PR links to an issue** (`Closes #123`).
- **Behavioral changes need design discussion first** — open an issue or Discussion before implementing changes to the Practice format, retrieval model, or CLI surface.

## Boundaries

**Do not modify these without explicit maintainer approval:**
- `LICENSE` and any future `LICENSE-*` files — license files. Changes are legal events, not code edits.
- `package.json` top-level `license` field.
- `.github/workflows/` release/publish steps.

**Do not run:**
- Any package-publish command (e.g. `bun publish`, `npm publish`) — releases are CI-only.
- Anything that posts to the public registry without approval.

**Be careful with:**
- Bumping dependencies — check for transitive license/AGPL conflicts. We are Apache-2.0 core; don't pull in GPL/AGPL deps into Apache-licensed code without a maintainer's sign-off.
- Editing the Practice/pack schema — it's the public contract. Spec required.

## Where to look

- **Product understanding:** `README.md` (overview) and `CONTRIBUTING.md` (workflow).
- **Planning a feature?** Open a Discussion or issue before implementing — product-surface changes (Practice format, retrieval model, CLI) need alignment first.

## When in doubt

If a task is ambiguous, **open a Draft PR or ask in Discussions** rather than guessing. Lorelum's product surface is the Practice format and retrieval engine — getting those right matters more than speed.
