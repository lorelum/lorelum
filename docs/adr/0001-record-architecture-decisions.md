# ADR 0001: Record Architecture Decisions

- **Date:** 2026-07-08
- **Status:** Accepted

## Context

Lorelum is an open-core project whose product surface — the Practice/pack format, the retrieval model, the CLI — will become public contracts that packs, users, and contributors depend on. The codebase is about to enter active development, and many of the choices that shape it (runtime, language, data format, storage strategy) are hard to reverse after code lands.

Today, decisions are made in team discussion and live in people's heads or scattered across chat. That has two failure modes:

1. **"Why is it like this?"** — a newcomer (human or AI agent) hits a non-obvious design choice and has no record of the alternatives considered or the constraints that drove it.
2. **Re-litigation** — without a durable record, settled questions get reopened every few months when someone re-discovers the trade-off.

We need a lightweight, in-repo mechanism to capture *why* a decision was made at the time, not just *what* was decided.

## Decision

We will keep Architecture Decision Records (ADRs) in `docs/adr/`, one decision per file, numbered `NNNN-short-title.md`.

We adopt the Nygard format: each ADR has **Status**, **Context**, **Decision**, **Consequences**. See [`0000-template.md`](./0000-template.md) and [`README.md`](./README.md) for the full convention.

ADRs go through the normal PR workflow. They are **immutable history** — to change a decision, write a new ADR that supersedes the old one rather than editing the conclusion in place.

## Consequences

**Positive:**

- Every hard-to-reverse decision has a durable rationale attached. Future contributors (and AI agents reading [`AGENTS.md`](../../AGENTS.md)) can trace *why* instead of guessing.
- Settled decisions stay settled — reopening a question means writing a new ADR that references the old one, which forces the challenger to engage with the original reasoning.
- The `Accepted`/`Superseded` lifecycle gives a clear picture of which decisions are still in force.

**Negative:**

- A small ongoing cost: every architecturally significant decision needs a written record. We accept this — it's the point.
- ADRs can drift from reality if a decision is changed in code but no superseding ADR is written. We mitigate by treating "no ADR for a change" as a review smell.

**Neutral:**

- ADRs are English prose, not machine-readable. They're for humans (and agents), not tooling.
