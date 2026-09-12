# AGENTS.md

> This file tells AI coding agents how to work **in this specific repo**. Humans: see [CONTRIBUTING.md](./CONTRIBUTING.md) for the human workflow. If you're using an AI assistant, point it at this file.

## Project

Lorelum is an engineering-knowledge infrastructure for AI coding agents. It retrieves team "Practices" (discrete engineering guidelines) and injects them into AI context on demand. This repo will hold the core engine, CLI (`lore`), local MCP server, and format spec.

The codebase is **Bun + TypeScript**, organized as a Bun workspace monorepo (`packages/*`). The exact commands are in [Commands](#commands) below; conventions in [Code style](#code-style) and [Testing](#testing).

The companion knowledge-pack repo lives elsewhere (`lorelum/lorelum-packs`). This repo does not contain knowledge-pack content.

For local CLI work, including isolated Store roots and multi-worktree usage, see [the development guide](./docs/development/README.md).

## Layout

The source tree is a Bun workspace monorepo (`packages/backend`, `packages/cli`, `packages/config`, `packages/engine`, `packages/format`, `packages/mcp`, `packages/shared`). Repo-root `package.json` declares `workspaces: ["packages/*"]`. `backend` hosts long-lived local capabilities; `config` is the shared configuration foundation.

**The product contract to be aware of:**

- **Practice / pack format** — the public schema that packs and users depend on. Changes are high-impact; see CONTRIBUTING.md.
- **Retrieval engine** — performance-sensitive; benchmark before changing.

### UI and design system

- Read [`DESIGN.md`](./DESIGN.md) before visual or component work.
- Keep its front matter compatible with Google DESIGN.md and run `bun run design:lint` after edits.
- Reusable Web components and production tokens belong to `packages/ui`; page composition, routes, copy, data, and page-specific motion stay with the consuming app.
- Follow `packages/ui/AGENTS.md` for shadcn changes and `apps/site/AGENTS.md` for site integration and visual verification.

### Service boundaries and dependency direction

Keep package dependencies and runtime routes distinct when designing or changing retrieval.

- **Engine owns retrieval semantics and Store-derived data.** LocalStore snapshots, canonical Practice reads, keyword and semantic indexes, ranking, candidate validation, and result assembly belong in `@lorelum/engine`. Engine must not import `@lorelum/backend`, Elysia, CLI code, or a model runtime.
- **Backend is the local, long-lived host for cold-start-expensive capabilities.** It owns model download/load/unload, process lifecycle, authentication, and the execution lifetime of Backend-hosted Engine use cases. It may depend on Engine and compose an Engine service with an in-process runtime adapter, but its controllers must not reimplement retrieval, Store, index, or ranking rules.
- **CLI is the composition and protocol boundary.** It parses commands, resolves `--store-root`, chooses the execution route, and renders the JSON envelope. It may depend on both Engine and Backend; neither Engine nor Backend may depend on CLI.
- **Runtime routes are intentional:** keyword query stays `CLI → Engine` so it remains zero-config and offline. Semantic query and semantic index operations use `CLI → Backend client → Backend daemon → Engine semantic use case`; the daemon reuses its ready local runtime. Do not introduce a `CLI → Engine → Backend client` semantic path.
- **Scope data correctly:** model configuration and runtime state are user-level Backend concerns; each Store root owns its canonical Pack data and derived indexes. `--store-root` selects Store/index data only, never a model, model cache, backend address, or runtime directory.
- When adding a Backend endpoint, treat it as an adapter over an Engine use case. Define the Engine contract and error semantics first, then keep HTTP DTO/controller code in `packages/backend/src/modules/<feature>/` and client/CLI adapters thin.

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

### Current-worktree CLI verification

- Run every source-level CLI check from the target worktree. Agents and automation should invoke the source entrypoint directly: `bun packages/cli/src/main.ts ...`. `lore-dev` is an optional human convenience that wraps the same entrypoint; it is not an Agent prerequisite. Do not inspect, redefine, or edit a human's shell startup files to use it. Do not use global `lore` or a binary from another worktree to validate source changes.
- Use an isolated `--store-root` by default for worktree validation, including commands that mainly read: Store opening, recovery, and derived indexes can write state. Omit it only when the task explicitly requires checking the developer's real shared Store.
- `backend start/status/stop` and keyword checks do not require a native candidate. Before source-level validation that loads a model or uses embedding/semantic index features, run `bun run build:native`, then explicitly start the Backend and load the model. These commands do not currently start either service implicitly.
- Choose compiled checks by purpose: `bun run build:cli` only for non-embedding behavior; `bun run build:release-staging` for a runnable compiled embedding candidate; `bun run build:release` only when validating the final archive. See [the development guide](./docs/development/README.md#normal-development-workflow) for commands and rationale.

### LocalStore CLI constraint

- Every LocalStore-consuming CLI command must use the shared Store-root resolver; do not call `defaultStorageRoot` directly when honoring the global override.
- When manually writing Store data from a branch or worktree, use an isolated Store root. Never point it at another worktree's or the user's default Store.
- `lore-dev` is documented only as a human convenience. An Agent must call the source entrypoint directly and must not use a failed helper lookup as a reason to inspect, redefine, or edit shell configuration. See [the development guide](./docs/development/README.md#source-entrypoint-and-human-helper) for the equivalent human workflow.

## Code style

TypeScript is the language; Bun runs it. These rules apply from day one.

- **Strict mode.** `tsconfig.json` has `strict: true`. No `any` without justification; if unavoidable, mark `// @ts-expect-error: <reason>` (reason required).
- **Naming.** TypeScript community norms: `PascalCase` for types/interfaces/classes, `camelCase` for functions/variables. Apply uniformly.

- **Small, composable modules.** Prefer pure functions. Avoid deep class hierarchies unless modeling genuine state.
- **Typed errors over bare strings.** Throw specific error types; let the CLI/MCP boundary translate them into user-facing messages. Never throw a bare string.
- **No silent failures.** A function that can fail should signal it explicitly (typed error, Result, or similar) — not return `null` and hope.
- **Naming:** consistent with the chosen language's prevailing conventions. Whatever they are, apply them uniformly.

### File organization

Keep the tree navigable and each file independently understandable. These are principles, not a line-count budget — judge by whether a file can be understood on its own.

- **One responsibility per file.** A file owns one schema entity, one piece of closely-related logic, or one group of constants. If you are editing a file and the change is unrelated to its existing contents, that work probably belongs in a sibling file.
- **Group by function into subdirectories.** Don't accumulate files at the `src/` root. A package like `format` separates `schema/`, `validate/`, `frontmatter/`, `fixtures/` so each concern has a home. Cross-cutting helpers live in a `common.ts` within the relevant directory.
- **`index.ts` is a barrel, nothing more.** It re-exports the directory's public API. Business logic does not live in `index.ts` — put it in a named file and re-export it.
- **File name matches what it exports.** `practice.ts` exports the Practice schema and `Practice` type; `cycle.ts` exports cycle detection. A reader should predict the file's contents from its name.
- **Co-locate tests.** `*.test.ts` sits next to the source it covers, mirroring the same split — `schema/practice.test.ts` tests `schema/practice.ts`.

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
- **Use the repository PR template.** Before opening or editing a PR, read [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md) and keep every section, including the linked issue, change type, verification, checklist, AI assistance, and reviewer notes.
- **Review the full diff before opening a PR.** Read every changed line, verify the change is intentional and in scope, and record the result in the PR's AI assistance section.
- **Public-contract changes need design alignment first.** Changes to the Practice/pack format, retrieval model, CLI surface, or MCP tool interface require an issue or Discussion with design alignment before implementation. Reuse existing agreed design and acceptance criteria when they cover the requested change; do not require a new discussion for the same decision.
- **Work that preserves the existing public contract does not need upfront design discussion.** This includes pure bug fixes restoring documented behavior, internal refactors, performance improvements, and docs. Issue and PR requirements, applicable tests and benchmarks, and the approval boundaries below still apply.

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
- **Planning a feature?** Check existing issues, Specs, and agreed designs, then apply the design-alignment rule in [Git workflow](#git-workflow).

## When in doubt

- Check the request, existing issues, Specs, tests, and code before asking for clarification. Resolve ordinary implementation details using repository conventions and conservative assumptions within the authorized scope.
- If ambiguity changes the public contract, acceptance criteria, or authorization, state the unresolved decision and pause only the affected steps. Continue independent, authorized investigation, preparation, and verification without crossing the design or approval gates.
- Do not create a Draft PR or Discussion solely because an implementation detail is unclear. Use them when required by the repository workflow and covered by the task's authorization; preserve the Issue and PR requirements above.
