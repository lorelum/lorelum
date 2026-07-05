# AGENTS.md

> This file tells AI coding agents how to work **in this specific repo**. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the human workflow. If you're using an AI assistant, point it at this file.

## Project

Lorelum is an engineering-knowledge infrastructure for AI coding agents. It retrieves team "Practices" (discrete engineering guidelines) and injects them into AI context on demand. This repo will hold the core engine, CLI (`lore`), local MCP server, and format spec.

> ⚠️ **The codebase doesn't exist yet.** The language, toolchain, and project layout are undecided. The commands and conventions below will be filled in once the scaffolding lands. Treat this file as a statement of *how we want to work*, not a description of a build system that exists today.

The companion knowledge-pack repo lives elsewhere (`lorelum/lorelum-packs`). This repo does not contain knowledge-pack content.

## Layout

> The source tree isn't established yet — Lorelum is in the scaffolding phase. This section will be filled in once the codebase takes shape. For now, the repo contains project docs and governance files only (`README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `LICENSE`, `.github/`).

**When the codebase lands**, the product contract to be aware of:
- **Practice / pack format** — the public schema that packs and users depend on. Changes are high-impact; see CONTRIBUTING.md.
- **Retrieval engine** — performance-sensitive; benchmark before changing.

## Commands

> ⏳ **Toolchain undecided.** Build, test, and lint commands will be documented here once the language and package manager are chosen. Until then, refer to any `package.json` / manifest that appears in the repo root, and keep CI green on whatever it runs.

## Code style

> Toolchain-specific style rules will be added once the language is fixed. The principles below are language-agnostic and apply from day one.

- **Small, composable modules.** Prefer pure functions. Avoid deep class hierarchies unless modeling genuine state.
- **Typed errors over bare strings.** Throw specific error types; let the CLI/MCP boundary translate them into user-facing messages. Never throw a bare string.
- **No silent failures.** A function that can fail should signal it explicitly (typed error, Result, or similar) — not return `null` and hope.
- **Naming:** consistent with the chosen language's prevailing conventions. Whatever they are, apply them uniformly.

## Testing

- New code ships with tests. No exceptions for the format/parser and retrieval layers.
- Test framework and file layout will be documented here once the toolchain is chosen. Until then, colocate tests with source in whatever convention the language community uses.
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
- Any package-publish command (e.g. `npm publish`, `pnpm publish`, or the chosen toolchain's equivalent) — releases are CI-only.
- Anything that posts to the public registry without approval.

**Be careful with:**
- Bumping dependencies — check for transitive license/AGPL conflicts. We are Apache-2.0 core; don't pull in GPL/AGPL deps into Apache-licensed code without a maintainer's sign-off.
- Editing the Practice/pack schema — it's the public contract. Spec required.

## Where to look

- **Product understanding:** `README.md` (overview) and `CONTRIBUTING.md` (workflow).
- **Planning a feature?** Open a Discussion or issue before implementing — product-surface changes (Practice format, retrieval model, CLI) need alignment first.

## When in doubt

If a task is ambiguous, **open a Draft PR or ask in Discussions** rather than guessing. Lorelum's product surface is the Practice format and retrieval engine — getting those right matters more than speed.
