# AGENTS.md

> This file defines the repository-wide baseline for AI coding agents. Humans should use [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution workflow.

## Module guidance

When a task develops or changes one of the following areas, read and prioritize that module's `AGENTS.md`. Read README files, current specs/contracts, ADRs, active changes, tests, or source only when the task needs them; do not recursively load the repository merely because a file may be relevant.

When sources conflict, distinguish the current request and accepted rules from observations. Current user authorization defines task scope; an explicitly selected active change, current specs, current CLI/API/configuration/development contracts, and non-superseded Accepted ADRs define repository intent; code and tests show the current state; plans, summaries, research, and archived changes may provide context but do not silently define current behavior.

## Project and product boundaries

Lorelum is a Bun + TypeScript monorepo for engineering-knowledge retrieval: the Core engine, the `lore` CLI, format/schema tooling, local Backend capabilities, and supported host Skills/Hooks. Knowledge-Pack content lives in the separate `lorelum/lorelum-packs` repository.

| Area | Owns | Read before changing |
| --- | --- | --- |
| `packages/engine` | retrieval semantics, LocalStore, canonical reads, derived indexes, ranking | `packages/engine/AGENTS.md` |
| `packages/cli` | command parsing, execution-route selection, JSON envelopes | `packages/cli/AGENTS.md` |
| `packages/backend` | local daemon, model/runtime lifecycle, authenticated HTTP adapters | `packages/backend/AGENTS.md` |
| `packages/format` | public Practice/Pack schema, parsing, validation, localization helpers | `packages/format/AGENTS.md` |
| `apps/site` | public landing and documentation site | `apps/site/AGENTS.md` |
| `packages/ui` | reusable Web primitives and production design tokens | `packages/ui/AGENTS.md` |
| `plugins` | host-native Plugin overlays, marketplace mappings, Skills, Hooks, and host lifecycle integration | `docs/development/plugin-conventions.md`, `openspec/specs/agent-integration/spec.md`, `openspec/specs/plugin-distribution/spec.md` |
| `docs` | maintainer material, internal APIs, ADRs, research | `docs/AGENTS.md` |

Current integrations are CLI-first: use the released CLI together with host-native Skills and Hooks. Do not introduce local MCP servers, stdio wiring, MCP tools, MCP-backed Plugin behavior, or a local MCP wrapper around `lore`. `packages/mcp` is a non-product scaffold. A remote-retrieval MCP boundary requires a separately approved design.

## Documentation ownership

- Decide the reader before changing documentation. A product user who needs to install, configure, operate, understand an observable result, or recover from an error reads the bilingual site under `apps/site/content/docs/`; update the matching English and Chinese pages only when that user-facing guidance changes.
- `docs/` is for maintainers: internal APIs, implementation and ABI details, architecture rationale, source/build verification, and operational evidence. Do not move such material into the site merely because the same code change has a user-facing aspect.
- A user guide and a maintainer document may both exist when they serve those distinct readers. They must not restate the same workflow or contract: link across the boundary instead. If a root document is fully equivalent to a site guide after a migration, delete the root copy and repair its inbound links.

For visual or component work, read [DESIGN.md](./DESIGN.md) first. Reusable Web components and production tokens belong in `packages/ui`; routes, copy, data, and page-specific composition belong to the consuming application. Run `bun run design:lint` after changing `DESIGN.md`.

## User experience and failure handling

- Treat user experience as a first-order product correctness requirement. For every feature and interaction, make the common, safe workflow complete with sensible defaults, clear precedence, and minimal manual setup or cleanup.
- Do not make users resolve internal ambiguity, stale derived state, transient failures, or recoverable conflicts by default. Before exposing an error, prefer an explicit product rule, safe automatic recovery, idempotent retry, background continuation, or a user-visible choice that preserves their work.
- An error is appropriate only for invalid input, an unsafe action, a genuinely ambiguous intent with no safe default, or a failure that cannot be recovered automatically. It must preserve canonical user data, avoid partial or hidden leftovers, explain the outcome plainly, and give one actionable next step.
- Never silently guess when doing so could lose data, weaken security, or change a public contract. In those cases, surface the decision early and make the trade-off understandable.

## Global commands and verification

- Runtime: Bun ≥ 1.1. Install dependencies with `bun install`.
- Test: `bun test`; lint: `bun run lint`; format: `bun run fmt`; typecheck: `bun run typecheck`.
- Run a package command with `bun run --filter <package> <script>` when a focused check exists.
- Use `bun build --compile` only when the task actually needs a single compiled binary. See [the development guide](./docs/development/README.md) for source, worktree, native, and release-staging workflows.

Match verification to the changed boundary. New behavior ships with colocated `bun:test` coverage; format/parser and retrieval behavior have no exception. Mock filesystem and network in unit tests. A bug fix needs a regression test that fails before the fix and passes after it.

## Code and file conventions

- TypeScript runs under Bun with `strict: true`. Do not use `any` without justification; use a reasoned `// @ts-expect-error: <reason>` only when necessary.
- Use `PascalCase` for types/interfaces/classes and `camelCase` for values and functions.
- Prefer small, composable modules and typed errors. Do not throw bare strings or hide failures behind `null`.
- One file owns one coherent responsibility. Group modules by function in subdirectories; `index.ts` is a barrel only. File names should predict their exports.
- Co-locate `*.test.ts` with the source it covers.

## Git, contract, and release guardrails

- Never commit directly to `main`. Keep PRs focused, use Conventional Commits and the PR template, and review the complete diff before opening a PR. Link an existing Issue when the PR addresses it; create a new Issue only when the problem needs independent tracking, discussion, or coordination. Do not open one merely to restate a self-contained PR.
- Write Issues so a contributor without the current conversation can act: state the observed starting state and user/Agent impact, reproducible steps or a concrete scenario, expected outcome, realistic failure behavior, scope, and observable acceptance criteria. Separate evidence from hypotheses and avoid prerequisites to unrelated Issues unless the capability truly depends on them.
- Before publishing an Issue, search for duplicates and inspect the relevant current contract, implementation or test evidence, and comparable Issues. Use that evidence to explain the actual starting state and the decision a contributor must make; do not pad the body with generic process text, unsupported claims, private session context, or placeholders for the submitter to fill later. For a proposal, distinguish the recommended outcome from an unverified mechanism and state what evidence or design alignment is needed before implementation.
- Triage every newly published Issue, then read back its final body and labels. For an actionable bug or feature, apply `bug` or `enhancement` even when bypassing the form, plus exactly one difficulty label. Field feedback without an actionable scope need not be graded until it becomes a task.
  - `difficulty: beginner` means self-contained work within an existing contract; `difficulty: intermediate` means a focused package or workflow change; `difficulty: advanced` means public-contract, cross-boundary, or design-critical work. Grade the work, not the length of the write-up.
  - Add `design` when implementation needs design alignment, `evaluation` when a reproducible experiment must decide a product change, or `research` for an evidence-gated investigation. These describe the work, not its difficulty.
  - Add `help wanted` only when an outside contributor can act from public evidence and acceptance criteria. Add `good first issue` only to a bounded beginner task with a safe existing contract and `help wanted`, never to unresolved design or advanced work. Leaving invitation labels off is an explicit decision.
- Write PR descriptions for review, not as a commit summary: explain why, meaningful before/after behavior, important changes, compatibility and migration (or explicitly none), and evidence for success plus relevant failure/recovery paths. Name commands, results, and material environment/artifact boundaries; disclose unrun or failing checks and remaining risks. Claim performance gains only with comparable baseline and changed measurements under a stated workload/method, or label them as unverified hypotheses. Scale detail to the change; a small docs fix needs no benchmark.
- Public Practice/Pack schema, retrieval semantics, CLI surface, and any future approved remote MCP interface require design alignment before implementation. Internal refactors, focused bug fixes, performance work, and docs preserve the existing public contract unless they say otherwise.
- Do not modify `LICENSE`, future `LICENSE-*` files, the root `package.json` `license` field, or release/publish workflow steps without explicit maintainer approval.
- Do not run package-publish commands or publish to a public registry. Check dependency licenses before adding or upgrading dependencies; do not add GPL/AGPL dependencies to this Apache-2.0 core without maintainer approval.
- Before every commit or push, inspect the staged file list and diff, scan for secrets and private runtime data, and exclude local outputs, caches, logs, credentials, generated media, and machine-specific artifacts unless explicitly required.

### Change scale and OpenSpec

- **Small — execute directly, without OpenSpec.** It preserves current behavior and contracts within an existing boundary; documentation or current-spec edits that only correct facts, links, wording, examples, or formatting without changing a requirement or scenario are small.
- **Large — write an OpenSpec proposal first.** This includes any observable or cross-boundary contract/default/error change; architecture, ownership, lifecycle, integration, security/privacy, persistence, release, or platform change; and any cross-package or unresolved design decision.
- **If uncertain, treat it as large.** Do not split a coupled large decision into nominally small edits.

## Canonical references

- Product and user entry: [README.md](./README.md)
- Human contribution process: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Current capability specs: [openspec/specs](./openspec/specs/)
- Public user documentation: [site content](./apps/site/content/docs/)
- Maintainer documentation and internal APIs: [docs](./docs/)
- Architecture decisions and lifecycle: [docs/adr/README.md](./docs/adr/README.md)
- Current agent-integration scope: [agent-integration spec](./openspec/specs/agent-integration/spec.md)
- Archived changes are provenance only: [openspec/changes/archive](./openspec/changes/archive/)

When a task is ambiguous, inspect the relevant module guidance and canonical sources before asking. Ask only when the unresolved fact changes authorization, public contract, acceptance criteria, or a material architecture direction; continue independent, authorized investigation and verification in the meantime.
