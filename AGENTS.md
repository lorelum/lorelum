# AGENTS.md

> This file tells AI coding agents how to work **in this specific repo**. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the human workflow. If you're using an AI assistant, point it at this file.

## Project

Lorelum is an engineering-knowledge infrastructure for AI coding agents. It retrieves team "Practices" (discrete engineering guidelines) and injects them into AI context on demand. This repo holds the core engine, CLI (`lore`), local MCP server, and format spec — written in **TypeScript on Node.js**, managed with **pnpm workspaces**.

The companion knowledge-pack repo lives elsewhere (`lorelum/lorelum-packs`). This repo does not contain knowledge-pack content.

## Layout

```
/
├── src/
│   ├── cli/            # `lore` CLI entry (commander-based)
│   ├── engine/         # retrieval engine (embed + metadata + graph)
│   ├── format/         # Practice / pack.yaml / decisions.yaml parsing
│   └── mcp/            # local MCP server
├── tests/              # unit + integration tests (Vitest)
├── docs/               # user-facing docs site source
├── AGENTS.md           # ← you are here
├── CONTRIBUTING.md     # human workflow (don't duplicate here)
└── README.md
```

**Key directories to understand before changing things:**
- `src/format/` — the Practice/pack schema is the product's contract. Changes here are high-impact; see CONTRIBUTING.md for the spec-change process.
- `src/engine/` — retrieval logic. Performance-sensitive; benchmark before changing.

## Commands

All commands run from repo root via pnpm.

```bash
pnpm install          # install deps (first time only)
pnpm build            # build all packages
pnpm test             # run all tests
pnpm test -- <path>   # run a single test file
pnpm test:watch       # watch mode
pnpm lint             # ESLint
pnpm format           # Prettier (write)
pnpm typecheck        # tsc --noEmit across the workspace
```

**Before opening a PR, all of these must pass:**

```bash
pnpm lint && pnpm typecheck && pnpm test
```

## Code style

- **TypeScript strict mode.** No `any` without a `// reason:` comment justifying it.
- **Functional, composable.** Prefer pure functions and small modules. Avoid class hierarchies unless modeling stateful resources.
- **Error handling:** throw typed errors (`PracticeNotFoundError`, `ParseError`), never bare `Error` or strings. Let CLI/MCP layers translate to user-facing messages.
- **Naming:** `camelCase` for variables/functions, `PascalCase` for types/interfaces, `kebab-case` for files.
- **Imports:** use `type` imports for types (`import type { Practice } from ...`).

**Example do/don't:**

```ts
// ❌ don't
function get(id: any): any { ... }

// ✅ do
import type { Practice } from '../format/types.js'
function getPractice(id: string): Promise<Practice> { ... }
```

## Testing

- New code ships with tests. No exceptions for `engine/` or `format/`.
- Colocate tests with source: `engine/retrieval.ts` → `engine/retrieval.test.ts`.
- Use Vitest. Mock filesystem and network — never hit the real registry in unit tests.
- When fixing a bug, add a regression test that fails before the fix and passes after.

## Git workflow

- **Never commit directly to `main`.** Every change goes through a PR.
- **One issue per PR.** Keep PRs focused and reviewable. If a change spans multiple issues, split it.
- **Conventional Commits** (`feat(cli): ...`, `fix(engine): ...`, `spec(format): ...`, `docs: ...`).
- **Every PR links to an issue** (`Closes #123`).
- **Behavioral changes need design discussion first** — open an issue or Discussion before implementing changes to the Practice format, retrieval model, or CLI surface.

## Boundaries

**Do not modify these without explicit maintainer approval:**
- `LICENSE`, `LICENSE-AGPL`, `LICENSE-CC-BY` — license files. Changes are legal events, not code edits.
- `package.json` top-level `license` field.
- `.github/workflows/` release/publish steps.

**Do not run:**
- `npm publish` / `pnpm publish` — releases are CI-only.
- Anything that posts to the public registry without approval.

**Be careful with:**
- Bumping dependencies — check for transitive license/AGPL conflicts. We are Apache-2.0 core; don't pull in GPL/AGPL deps into Apache-licensed code without a maintainer's sign-off.
- Editing the Practice/pack schema — it's the public contract. Spec required.

## Where to look

- **Product understanding:** `README.md` (overview) and `CONTRIBUTING.md` (workflow).
- **Planning a feature?** Open a Discussion or issue before implementing — product-surface changes (Practice format, retrieval model, CLI) need alignment first.

## When in doubt

If a task is ambiguous, **open a Draft PR or ask in Discussions** rather than guessing. Lorelum's product surface is the Practice format and retrieval engine — getting those right matters more than speed.
