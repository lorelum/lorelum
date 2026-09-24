# Contributing to Lorelum

Thanks for your interest in contributing to Lorelum! This doc explains how we work — the workflow, the conventions, and what to expect.

> 🤖 **Using an AI coding assistant (Cursor / Claude Code / Codex)?** Also read [**AGENTS.md**](./AGENTS.md) — it tells the agent how to work _in this specific repo_ (commands, layout, boundaries). This doc is for humans; AGENTS.md is for machines.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Development environment](#development-environment)
- [Contributor License Agreement (CLA)](#contributor-license-agreement-cla)
- [How we work: focused PRs, design-first](#how-we-work-focused-prs-design-first)
- [Reporting bugs & proposing features](#reporting-bugs--proposing-features)
- [Writing reviewable issues and PRs](#writing-reviewable-issues-and-prs)
- [Development workflow](#development-workflow)
- [Commit conventions](#commit-conventions)
- [PR titles](#pr-titles)
- [Testing & CI](#testing--ci)
- [AI-assisted contributions](#ai-assisted-contributions)
- [Knowledge-pack contributions](#knowledge-pack-contributions)
- [Becoming a maintainer](#becoming-a-maintainer)

---

## Code of Conduct

Everyone participating in Lorelum is expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind, assume good intent, and keep discussions technical.

## Development environment

**Prerequisites**

- **Bun ≥ 1.1** — the runtime and package manager. TypeScript support is built in, so you don't need a separate Node.js or `tsc` install. Install at [bun.sh](https://bun.sh).
- Git ≥ 2.30

**Setup**

```bash
git clone https://github.com/lorelum/lorelum.git
cd lorelum
bun install
```

**Common commands**

| Task                   | Command                              |
| ---------------------- | ------------------------------------ |
| Run tests              | `bun test`                           |
| Lint                   | `bun run lint` (oxlint)              |
| Format                 | `bun run fmt` (oxfmt)                |
| Typecheck              | `bun run typecheck` (`tsc --noEmit`) |
| Run any package script | `bun run <script>`                   |

Precise scripts live in each `packages/*/package.json`.

For the complete local CLI and multi-worktree setup (including isolated Store roots), see [Development guide](./docs/development/README.md).

## Contributor License Agreement (CLA)

Before we can merge your first pull request, you need to sign our CLA. It's quick and one-time:

1. Open a PR as usual.
2. The **CLA assistant** bot will comment on your PR with a link.
3. Click it, confirm via GitHub OAuth, and you're done — **a few seconds**.

That signature covers **all** Lorelum repositories. You only sign once, ever.

**Why we require a CLA.** Lorelum is open-core: the core engine is open source (Apache 2.0), but we also ship closed-source SaaS and enterprise tiers. The CLA grants us the right to sublicense your contribution into both open and closed releases. You **keep your copyright** — this is the standard license-style model used by Apache, Google, and HashiCorp.

- Read the full text: [CLA (Gist)](https://gist.github.com/TatsukiMeng/407a0f07f61da9b71557d7fd0754a0ec)
- We use [cla-assistant.io](https://cla-assistant.io/) — a free, open-source GitHub App.

A PR cannot be merged until the CLA check passes. This protects the entire Lorelum codebase from IP contamination (a single unsigned contribution would break the licensing foundation).

## How we work: focused PRs, design-first

Use a focused PR for a self-contained change. Open an Issue when the problem needs separate discussion, coordination, or backlog tracking; do not create one just to duplicate the PR overview. Changes to the product surface still need design alignment before code, as described below.

**What counts as "product surface"?** The Practice/Pack format, retrieval semantics, CLI commands and output, configuration/defaults, and host Skill/Plugin/Hook integration. Changes to these need design alignment first because users and Agents depend on the resulting contracts. Current local integrations remain CLI-first; they do not add an MCP tool interface.

Focused bug fixes, refactors, performance work, and factual docs corrections can usually proceed within the existing contract. A change to observable behavior, defaults, lifecycle, or cross-module ownership needs an OpenSpec proposal first, even when its motivation is a bug or performance problem. See [AGENTS.md](./AGENTS.md#change-scale-and-openspec) for the boundary.

## Reporting bugs & proposing features

- 🐛 **Bug** → [bug report template](https://github.com/lorelum/lorelum/issues/new?template=bug_report.yml)
- ✨ **Feature** → [feature request template](https://github.com/lorelum/lorelum/issues/new?template=feature_request.yml) — include background, goal, and acceptance criteria
- 🧭 **Field feedback** → [field feedback template](https://github.com/lorelum/lorelum/issues/new?template=field_feedback.yml) — for useful-but-incomplete guidance, retrieval misses, integration timing, or observations that still need evidence
- 💬 **Discussion / question** → [Discussions](https://github.com/lorelum/lorelum/discussions)

Before opening a new issue, please search existing ones to avoid duplicates.

## Writing reviewable issues and PRs

An Issue should let someone who was not in your local session understand the problem and take it forward independently. Give the relevant starting state and current behavior, the user or Agent impact, a concrete example or reproduction when available, and an observable result that would count as success. For a bug, distinguish what you saw from a suspected cause; include a realistic failure path, not only the successful path. For a feature, explain its scope and nearby work that is **not** part of it. Do not require a contributor to reconstruct private chat context or guess what "better" means.

An Issue can still be useful before the root cause or exact design is known. Say what evidence is missing instead of asserting an unverified cause. If an observation cannot yet support a product change, use field feedback. Performance requests should name the affected operation, workload, and metric; a proposed target without a measured baseline is a goal, not proof of the current performance.

Maintainers triage Issues after submission; reporters do not need to guess difficulty or mark their own work newcomer-friendly. An actionable bug or feature receives one `difficulty: beginner`, `difficulty: intermediate`, or `difficulty: advanced` label based on the work needed, not the length of the write-up; field feedback need not be graded until it becomes a task. `design`, `evaluation`, and `research` signal the kind of decision or evidence still needed. `help wanted` means an outside contributor can act on the public Issue without private context or access; `good first issue` is reserved for a bounded beginner task with an existing contract, not a broad design proposal. These labels invite participation but do not approve an implementation before the design-first gate above.

A PR should be understandable without reading every commit or the whole Issue. Its description should answer:

- Why was this change needed, and what behavior is different before and after?
- What are the important changes and deliberate exclusions? Which public contracts or existing users are affected, and is migration needed? State explicitly when there is no user-facing compatibility change.
- What evidence covers the important acceptance paths and realistic failure/recovery cases? Give the actual command or method, result, and environment when it matters. Distinguish local tests, CI, compiled/released binaries, and real-host checks; disclose what was not run or still fails.
- If claiming a performance improvement, what are the **before and after** measurements for the same representative workload and environment? Include metric, data size, repetition/variation, benchmark method, and any correctness or resource trade-off. Without a comparable benchmark, describe the change as a performance hypothesis, not a proven speedup.

The level of detail follows the change. A small documentation correction may need only a few sentences and a link check. A changed CLI error, persisted format, host integration, or performance claim needs enough evidence for a reviewer to assess the relevant boundary. Do not substitute an inventory of files, a generic "tests pass," or a checked box for the observed result. Keep the [PR template](./.github/PULL_REQUEST_TEMPLATE.md) headings that apply and remove the conditional performance section when it does not.

### Local feedback drafts and public reporting

When a local CLI invocation has a relevant `diagnostics.traceId`, you can prepare a local-only draft before deciding whether to open an issue:

```sh
lore feedback draft --trace-id <traceId> --kind bug
```

The default command writes a private `report.json` and `report.md` below `~/.lorelum/feedback/` unless you select an output directory. It includes same-trace error/lifecycle summary facts, not every local query or debug record. If you explicitly need already-recorded detail, add `--include-logs info` or `--include-logs debug` and review that added content before sharing. The command does **not** upload data, open a browser, create an Issue, or contact maintainers. A successful draft only means that the local files were written.

Treat these as three distinct states:

1. **Local draft generated** — you can inspect the report and its missing evidence. Original query, Practice, path, native output, or error text may still be present because the report is local.
2. **User manually submitted an Issue** — you choose which fields to disclose in the public form and remove credentials, cookies, tokens, private keys, signed URLs, and other secrets.
3. **Maintainer triaged the Issue** — a maintainer records a suggested disposition, the evidence boundary, and a next step. The result may be Pack, Core, Skill/Plugin, documentation, evaluation, or defer pending evidence.

Neither a draft nor an Issue automatically authorizes a Pack, Core, Skill, docs, or evaluation change. In particular, a retrieval observation is not a ranking-quality conclusion until it has suitable retrieval evidence, and a structurally valid report is not proof of downstream Agent behavior.

## Development workflow

1. **Check scope and existing Issues.** Use an Issue when independent tracking or design discussion is needed; otherwise go directly to a focused PR. Claim an Issue if you take one on.
2. **Branch.** From `main`: `feat/<scope>-<short>` or `fix/<scope>-<short>`.
   ```bash
   git checkout -b feat/cli-decide-command
   ```
3. **Implement.** Follow [AGENTS.md](./AGENTS.md) for repo conventions. Keep the PR focused.
4. **Verify the changed boundary.** Add tests for new behavior and run relevant checks. Record the actual results, including failures or checks you could not run; don't claim an old result covers code changed afterward.
5. **Open a PR.** Fill in the [PR template](./.github/PULL_REQUEST_TEMPLATE.md). If it addresses an Issue, use `Closes #123` only when complete; otherwise use `Refs #123` and say what remains.
6. **Review.** A maintainer will review. Address feedback with new commits (don't force-push mid-review unless asked).
7. **Merge.** Squash-merge into `main`.

**Branch naming:**

| Type    | Pattern                | Example                   |
| ------- | ---------------------- | ------------------------- |
| Feature | `feat/<scope>-<short>` | `feat/cli-decide-command` |
| Fix     | `fix/<scope>-<short>`  | `fix/decide-empty-result` |
| Spec    | `spec/<topic>`         | `spec/practice-format`    |
| Docs    | `docs/<topic>`         | `docs/readme-refresh`     |

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit and every PR title follows the same format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Type (required)

| Type       | Use for                                                   |
| ---------- | --------------------------------------------------------- |
| `feat`     | A new feature                                             |
| `fix`      | A bug fix                                                 |
| `perf`     | A change that improves performance                        |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `docs`     | Documentation only                                        |
| `test`     | Adding or correcting tests                                |
| `build`    | Changes to the build system or dependencies               |
| `ci`       | Changes to CI configuration                               |
| `chore`    | Routine maintenance, tooling, repo config                 |

### Scope (optional but encouraged)

A short noun identifying the area of the change — e.g. `cli`, `engine`, `format`, `mcp`, `docs`, `readme`. Omit the parentheses if it doesn't fit.

### Subject (required)

- Imperative, present tense: "add", not "added" or "adds".
- Lowercase first letter, no trailing period.
- ≤ 72 characters.
- Specific, not generic: `add decide command with decision-graph evaluator`, not `update cli`.

### Body (optional)

- One blank line after the subject.
- Explain **what and why**, not how (the diff shows the how).
- Wrap at ~72 characters.
- Use `-` bullets for lists.

### Footer (optional)

- One blank line before the footer.
- Used for: breaking changes (`BREAKING CHANGE: <description>`), issue closing (`Closes #123`), co-authors (`Co-authored-by: name <email>`).

### Examples

**Simple (most commits):**

```
docs(readme): add 5-minute tour section
```

**With body:**

```
fix(engine): handle empty practice list in retrieval

Returning an empty array when no Practices match caused the CLI to
print a confusing "no results" message. Now it suggests related packs
and the `lore learn` workflow.
```

**Breaking change:**

```
feat(format)!: rename `applies_when` to `trigger`

BREAKING CHANGE: the Practice frontmatter field `applies_when` is now
`trigger`. Existing packs must update their frontmatter.
```

**Closing an issue:**

```
feat(cli): add `lore decide` with decision-graph evaluator

Closes #42
```

## PR titles

Because we **squash-merge**, the PR title becomes the commit message on `main`. So PR titles **must follow the same Conventional Commits format** as commits.

✅ Good:

- `feat(cli): add lore decide command`
- `fix(engine): handle empty practice list in retrieval`
- `docs: refresh README 5-minute tour`

❌ Avoid:

- `update` (no type, no detail)
- `fixed the bug` (no type, lowercase scope missing)
- `Feat: added a new CLI command!!!` (uppercase, trailing punctuation, vague)

If a PR spans multiple types, pick the **most significant** change as the type (usually `feat` or `fix`). Split the PR if the types are equally significant.

## Testing & CI

Tests run on `bun:test`, linting on `oxlint`, formatting on `oxfmt`, typecheck via `tsc --noEmit`.

- **Unit tests ship with new code.** Colocate tests as `*.test.ts` next to the source they cover.
- **Coverage:** aim to keep or improve coverage on touched code. New behavior needs tests.
- **Lint and typecheck:** `oxlint` and `tsc --noEmit` must pass. No silencing the type checker or linter without justification in the PR.
- **Mock filesystem and network in unit tests** — never hit the real registry.

CI runs build, lint, typecheck, and test on every PR. A PR cannot merge until all gates are green.

## AI-assisted contributions

We actively welcome contributions made with AI coding assistants. A few rules to keep quality high:

1. **Read [AGENTS.md](./AGENTS.md)** before letting the agent write code — it contains repo-specific commands, layout, and boundaries the agent must respect.
2. **You are responsible for merged behavior.** "The AI wrote it" is never a defense for bugs, broken tests, or license issues. Use evidence-based review: approve the architecture, public contracts, security boundaries, acceptance evidence, and residual risks. "Reviewed every line" is not an acceptance criterion.
3. **Disclose AI assistance and its review evidence.** In the PR description, check the "AI-assisted" box, briefly note which parts used AI, and link or summarize the AI code review. This helps reviewers focus.
4. **Tests still apply.** AI-generated code must pass the same lint, type-check, and test gates as hand-written code.

## Knowledge-pack contributions

Lorelum's value is in its knowledge packs. Contributing a Practice is a first-class contribution:

- Packs live in a separate repo: [`lorelum/lorelum-packs`](https://github.com/lorelum/lorelum-packs) (CC-BY-4.0).
- See the Practice format guide in that repo's README.
- Pack contributions go through their own review process focused on content quality, not code.

## Becoming a maintainer

Regular, high-quality contributors may be invited to become maintainers. Maintainers get triage rights, review responsibilities, and a say in project direction. If you're interested, just tell us in Discussions — we're a small project and growing the team is the goal.

---

## Questions?

- 💬 [Discussions](https://github.com/lorelum/lorelum/discussions) — for anything that's not a bug or feature request
- 📧 maintainers@lorelum.com — for private matters

Happy hacking! 🚀
