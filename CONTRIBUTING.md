# Contributing to Lorelum

Thanks for your interest in contributing to Lorelum! This doc explains how we work — the workflow, the conventions, and what to expect.

> 🤖 **Using an AI coding assistant (Cursor / Claude Code / Codex)?** Also read [**AGENTS.md**](./AGENTS.md) — it tells the agent how to work *in this specific repo* (commands, layout, boundaries). This doc is for humans; AGENTS.md is for machines.

---

## Table of contents

- [Code of Conduct](#code-of-conduct)
- [Development environment](#development-environment)
- [How we work: spec-driven + issue-driven](#how-we-work-spec-driven--issue-driven)
- [Reporting bugs & proposing features](#reporting-bugs--proposing-features)
- [Development workflow](#development-workflow)
- [Commit conventions](#commit-conventions)
- [Testing & CI](#testing--ci)
- [AI-assisted contributions](#ai-assisted-contributions)
- [Knowledge-pack contributions](#knowledge-pack-contributions)
- [Becoming a maintainer](#becoming-a-maintainer)

---

## Code of Conduct

Everyone participating in Lorelum is expected to follow our [Code of Conduct](./CODE_OF_CONDUCT.md). Be kind, assume good intent, and keep discussions technical.

## Development environment

> ⏳ **Toolchain undecided.** Lorelum's language and package manager aren't locked in yet, so the prerequisites below will be updated once the scaffolding lands. For now, all you need is Git and a text editor to contribute to docs and governance files.

**Prerequisites (once code lands)**

- The language runtime and package manager — to be confirmed. Watch this section.
- Git ≥ 2.30

**Setup**

```bash
git clone https://github.com/lorelum/lorelum.git
cd lorelum
# install step will appear here once the toolchain is chosen
```

Once the build system is in place, this section will document the exact build, test, and lint commands.

## How we work: issue-driven, design-first

Lorelum uses **issue-driven development** with a **design-first** rule for anything that touches the product surface. Every change starts with an issue; changes to the Practice format, retrieval model, or CLI commands need design alignment *before* code.

**The flow at a glance:**

```
idea / bug
   │
   ▼
Issue (structured: background, goal, acceptance criteria)
   │
   ▼  touches product surface? ──▶ discuss design in the issue / a Discussion
   │                                  (align before coding)
   ▼
implementation (one branch per issue)
   │
   ▼
PR (linked to issue, CI green, human review)
   │
   ▼
merge → close issue
```

**What counts as "product surface"?** The Practice/pack format, the retrieval model, the CLI command surface, and the MCP tool interface. Changes to these need design discussion first — not because we love process, but because they become public contracts that packs and users depend on.

Pure bug fixes, refactors, perf improvements, and docs don't need upfront design — just an issue and a PR.

## Reporting bugs & proposing features

- 🐛 **Bug** → [bug report template](https://github.com/lorelum/lorelum/issues/new?template=bug_report.yml)
- ✨ **Feature** → [feature request template](https://github.com/lorelum/lorelum/issues/new?template=feature_request.yml) — include background, goal, and acceptance criteria
- 💬 **Discussion / question** → [Discussions](https://github.com/lorelum/lorelum/discussions)

Before opening a new issue, please search existing ones to avoid duplicates.

## Development workflow

1. **Find or open an issue.** Every change starts with an issue.
2. **Claim it.** Comment that you're working on it (or get assigned).
3. **Branch.** From `main`: `feat/<scope>-<short>` or `fix/<scope>-<short>`.
   ```bash
   git checkout -b feat/cli-decide-command
   ```
4. **Implement.** Follow [AGENTS.md](./AGENTS.md) for repo conventions. Keep PRs focused — one issue per PR.
5. **Test locally.** Whatever the test command turns out to be, it must pass. Add tests for new behavior.
6. **Open a PR.** Fill in the [PR template](./.github/PULL_REQUEST_TEMPLATE.md). Link the issue (`Closes #123`).
7. **Review.** A maintainer will review. Address feedback with new commits (don't force-push mid-review unless asked).
8. **Merge.** Squash-merge into `main`.

**Branch naming:**

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<scope>-<short>` | `feat/cli-decide-command` |
| Fix | `fix/<scope>-<short>` | `fix/decide-empty-result` |
| Spec | `spec/<topic>` | `spec/practice-format` |
| Docs | `docs/<topic>` | `docs/readme-refresh` |

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Every commit and every PR title follows the same format:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

### Type (required)

| Type | Use for |
|---|---|
| `feat` | A new feature |
| `fix` | A bug fix |
| `perf` | A change that improves performance |
| `refactor` | A code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `test` | Adding or correcting tests |
| `build` | Changes to the build system or dependencies |
| `ci` | Changes to CI configuration |
| `chore` | Routine maintenance, tooling, repo config |

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

> ⏳ Test runner and lint tooling will be confirmed with the language choice. The expectations below apply regardless of stack.

- **Unit tests ship with new code.** Colocate tests with source in whatever convention the language community uses.
- **Coverage:** aim to keep or improve coverage on touched code. New behavior needs tests.
- **Lint and typecheck:** whatever the chosen toolchain provides, it must pass. No silencing the type checker or linter without justification in the PR.
- **Mock filesystem and network in unit tests** — never hit the real registry.

CI will run build, lint, and test on every PR once the toolchain is set up. A PR cannot merge until all gates are green.

## AI-assisted contributions

We actively welcome contributions made with AI coding assistants. A few rules to keep quality high:

1. **Read [AGENTS.md](./AGENTS.md)** before letting the agent write code — it contains repo-specific commands, layout, and boundaries the agent must respect.
2. **You are responsible for the diff.** "The AI wrote it" is never a defense for bugs, broken tests, or license issues. Review every line.
3. **Disclose AI assistance.** In the PR description, check the "AI-assisted" box and briefly note which parts were AI-generated. This helps reviewers focus.
4. **No large AI-generated dump PRs.** Keep PRs focused and reviewable. If an agent produces a 1000-line diff, break it into smaller PRs.
5. **Tests still apply.** AI-generated code must pass the same lint, type-check, and test gates as hand-written code.

## Knowledge-pack contributions

Lorelum's value is in its knowledge packs. Contributing a Practice is a first-class contribution:

- Packs live in a separate repo: [`lorelum/lorelum-packs`](https://github.com/lorelum/lorelum-packs) (CC-BY-4.0).
- See the Practice format guide in that repo's README.
- Pack contributions go through their own review process focused on content quality, not code.

## Becoming a maintainer

Regular, high-quality contributors may be invited to become maintainers. Maintainers get triage rights, review responsibilities, and (later) a CLA on file. If you're interested, just tell us in Discussions — we're a small project and growing the team is the goal.

---

## Questions?

- 💬 [Discussions](https://github.com/lorelum/lorelum/discussions) — for anything that's not a bug or feature request
- 📧 maintainers@lorelum.com — for private matters

Happy hacking! 🚀
