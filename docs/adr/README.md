# Architecture Decision Records

This directory holds Lorelum's Architecture Decision Records (ADRs) — short documents that capture **why** an architecturally significant choice was made, not just *what* was decided.

## Why ADRs

Code tells you *how* the system works today. ADRs tell you *why* it works that way — the context, the alternatives considered, and the trade-offs accepted. When someone (human or AI agent) asks "why is X like this?", the answer lives here.

## When to write an ADR

Write an ADR for decisions that are:

- **Hard to reverse** — changing it later is expensive (tech stack, data format, public API).
- **Cross-cutting** — affects multiple packages or modules.
- **Public contract** — packs, users, or contributors depend on it (Practice format, retrieval model, CLI surface).

Trivial decisions (naming a helper, picking a minor util) don't need ADRs. If in doubt, write one — a short ADR is cheap insurance against re-litigating the same question later.

## Directory layout

```
docs/adr/
├── README.md                                  # this file (convention + index)
├── 0001-record-architecture-decisions.md      # meta-ADR: we use ADRs
├── 0002-bun-typescript-toolchain.md           # the first real decision
├── 0003-...                                   # subsequent decisions
└── 0000-template.md                           # copy this to start a new ADR
```

- Files are **zero-padded 4-digit numbers** + kebab-case title: `NNNN-short-title.md`.
- Numbers are **monotonic** — never renumber, never reuse. Superseded ADRs keep their number.
- One decision per file. If a decision has sub-decisions, link to child ADRs rather than cramming them in.

## ADR lifecycle

Every ADR has a **Status** field at the top:

| Status | Meaning |
|---|---|
| `Proposed` | Open for discussion (usually via a PR). Not yet the source of truth. |
| `Accepted` | The decision is active and in effect. |
| `Deprecated` | No longer relevant; nothing replaces it directly. |
| `Superseded by NNNN` | Replaced by a later ADR. The old one stays for history. |

ADRs are **immutable history**. To change a decision, write a new ADR that supersedes the old one — don't edit an Accepted ADR to flip its conclusion. The reasoning at the time matters as much as the outcome.

## How to add an ADR

1. Copy [`0000-template.md`](./0000-template.md).
2. Pick the next free number.
3. Fill in Context, Decision, Consequences.
4. Open a PR — ADRs go through the same review as code. Link any relevant issue/Discussion.
5. Merge → status becomes `Accepted`.

> ADRs follow the same [Conventional Commits](../../CONTRIBUTING.md#commit-conventions) and [issue-driven workflow](../../CONTRIBUTING.md#development-workflow) as the rest of the repo. Use the `spec` scope: `spec(adr): accept 0003 vector-storage strategy`.
