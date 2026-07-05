# AGENTS.md (openspec)

> This file is for AI agents (and humans) doing **spec work** on Lorelum. It tells you how to propose, write, and review changes to the product specification.
>
> For code-work instructions, see the root [`../AGENTS.md`](../AGENTS.md).

## When you're in this directory

You're here because the task involves **changing what Lorelum is or does** — not implementing existing behavior, but defining new behavior, changing the Practice format, altering the retrieval model, or modifying the CLI surface.

## TL;DR checklist

Before proposing a spec change:

```bash
# 1. See what specs exist
ls specs/

# 2. Read the relevant spec(s) carefully
cat specs/01-core-concepts.md

# 3. Check if a similar change was already proposed
ls changes/
```

## The spec-change workflow

```
1. Identify the problem          → "Practice format can't express X"
2. Draft a proposal              → create changes/<NNN>-<slug>.md
3. Discuss in the proposal PR    → reviewers + community
4. Adopted?                      → move content into specs/, archive the proposal
5. Implement                     → code PRs referencing the adopted spec
```

### Step 1 — File a proposal

Copy [`changes/000-template.md`](./changes/000-template.md) to `changes/<NNN>-<slug>.md`:

```
changes/
├── 001-default-local-mode.md
├── 002-anti-pattern-frontmatter.md
└── ...
```

The proposal must answer:
- **Problem** — what can't you do today, and why does it matter?
- **Proposal** — concretely, what changes?
- **Alternatives** — what else did you consider, and why is this better?
- **Impact** — what breaks? What specs need updating?

### Step 2 — Open a PR

Open a PR with **only the proposal file**. The PR reviews the *spec*, not code. Keep code out of spec PRs.

### Step 3 — After adoption

Once a proposal is merged/adopted:
1. Update the relevant `specs/*.md` files in a follow-up PR (or the same PR if small).
2. The proposal file stays in `changes/` as a permanent decision record.

## Specs are source

- Specs are versioned in Git like code.
- Code PRs that change product behavior **must** reference an adopted spec.
- "No spec, no merge" for behavioral changes — CI will eventually enforce this.

## Style

- **English only.** Lorelum is an international project.
- **Imperative, precise.** "The CLI SHALL...", "A Practice MUST contain...". Avoid vague language.
- **Examples over prose.** Show the YAML/Markdown/command, don't just describe it.
- **State the "what", leave the "why" to the proposal.** The spec is the contract; the rationale lives in `changes/`.

## What NOT to put in specs

- Marketing language ("Lorelum is amazing")
- Implementation details that belong in code comments
- Personal notes or TODOs (use a proposal instead)
- Anything in Chinese — English only, to avoid drift across translations
