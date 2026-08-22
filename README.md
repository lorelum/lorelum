<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">The right engineering Practice for the right AI coding task and moment.</p>
  <p align="center">
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
    <a href="https://github.com/lorelum/lorelum"><img alt="Status" src="https://img.shields.io/badge/status-early%20development-orange"></a>
    <a href="./CONTRIBUTING.md"><img alt="Contributing" src="https://img.shields.io/badge/contributions-welcome-brightgreen"></a>
  </p>
  <p align="center">
    <a href="./README.md">English</a> ·
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</p>

---

> ⚠️ **Lorelum is in early development.** No `npm install` yet — we're building in the open. Star the repo to follow along, or jump into [CONTRIBUTING.md](./CONTRIBUTING.md) / [Discussions](https://github.com/lorelum/lorelum/discussions).

## The problem

You wrote an `AGENTS.md` (or `CLAUDE.md`, `.cursorrules`). Then this happens:

- **Your rules silently stop being followed.** Frontier models comply with only ~68% of a 500-rule ruleset — _every rule you add makes every other rule less likely to be followed._<sup>[\[1\]](#fn-1)</sup> You don't get a warning; the agent just drifts.
- **A small task becomes a large engineering project.** While planning a narrow change, the agent adds unrequested product behavior, abstractions, fallbacks, tests, documentation, and guardrails because visible completeness is easy to reward and review. Each action resembles a best practice; together they optimize the appearance of thoroughness instead of the user's actual goal.
- **Compaction can both forget and distort.** A long session triggers context compaction → your early `AGENTS.md`, original requirements, acceptance criteria, and evidence boundaries can fall out of the window. At the same time, rejected approaches, disproved assumptions, legacy code, temporary workarounds, incidental issues, and raw logs can be promoted into the summary as if they were current facts. The resulting context is shorter, but it may also be less accurate.
- **You only find out when it's already wrong.** There is no signal that the agent has drifted — until you review the code yourself and spot the violation.

This is the **knowledge-and-judgment gap**: your guidance exists, but the right slice — including its applicability boundary — does not reliably reach the agent _when it plans or acts_.

## Why it happens

This is how your `AGENTS.md` actually reaches the agent today:

```
  ┌────────────────────────────────────────────────────────────┐
  │  AGENTS.md — dumped into context once, at session start    │
  └────────────────────────────────────────────────────────────┘
        │
        ├─▶ Few rules followed      ~68% compliance at 500 rules
        │                            (the more you write, the less
        │                             each one matters)
        │
        ├─▶ Proxy beats user goal   more tasks, tests, and guardrails
        │                            look complete even when unnecessary
        │
        ├─▶ Compaction discards     durable requirements, rules, and
        │   critical context         evidence can fall out
        │
        ├─▶ Exploration noise       rejected ideas or stale code can
        │   becomes "current"       be promoted into the summary
        │
        └─▶ Drift is invisible      no signal, until you review the
                                     code and find the violation
```

The conventional approach ("paste all the rules into context") fights physical limits: attention decay across long sessions, context-window capacity, and the fact that _more rules lower per-rule compliance_.<sup>[\[2\]](#fn-2)</sup> Even a 1M-token window doesn't recall early instructions reliably after compaction. It also cannot tell the agent which familiar best practice is unnecessary for a narrow change. **More rules ≠ more control.** Throwing more context at the problem doesn't fix it.

## How Lorelum solves it

Lorelum turns team engineering experience into **discrete, retrievable, trigger-conditioned units called _Practices_** — and injects them into AI context **at the moment of need**, not all at once.

Retrieval can use two kinds of clues:

- **What the agent is doing:** planning a narrow UI change, building an auth flow, changing a database schema, writing component tests.
- **What moment the agent is in:** defining scope and a validation plan, considering work beyond the requirement, recovering after compaction, deciding whether to change a failing test, or preparing to claim completion.

The caller describes the task and moment; Lorelum retrieves and ranks the relevant Practices. The task description can include its goal, scope, and risk: removing one line of copy and changing an authorization boundary should not trigger the same amount of engineering machinery. A Practice can describe not only what to do, but when it applies and which anti-patterns to avoid.

A Skill can guide the agent to trigger retrieval before it forms a plan or makes another semantic judgment. For a small task, this may be a brief scope check rather than a new planning document or workflow ceremony. A Plugin/Hook can observe lifecycle events exposed by a supported host. Around compaction, the two moments need different guidance:

- **Before compaction:** retrieve context-hygiene Practices that help distinguish durable facts from exploration noise.
- **After compaction:** retrieve recovery Practices that tell the agent how to re-ground itself, verify facts, and restore the boundary between evidence and assumption.

Lorelum Core does not manage the task, inspect the full transcript, or infer lifecycle events by itself. Whether pre-compaction guidance can become part of the host's real compaction instruction depends on the host integration and is still a Research question.

```
   ┌─────────────┐   query    ┌────────────────────┐   precise   ┌──────────────┐
   │  AI agent   │ ─────────▶ │      Lorelum       │ ──────────▶ │  3 relevant  │
   │ (Cursor /   │            │  retrieval engine  │             │  Practices   │
   │  Claude /   │ ◀───────── │  (embed + metadata │ ◀────────── │  + anti-     │
   │  Codex)     │   inject   │   + graph)         │             │  patterns    │
   └─────────────┘            └────────────────────┘             └──────────────┘
```

**Lorelum doesn't replace your `AGENTS.md` — it keeps it alive.** Every time the agent needs a piece of it, Lorelum re-injects that exact slice. When the agent starts implementing auth, Lorelum hands it the auth Practice — not the routing, testing, and deployment Practices too. When it is about to plan a change, Lorelum can surface scope and validation discipline before unnecessary work enters the plan. When it is about to make another high-risk judgment, Lorelum can surface the execution discipline needed for that moment without becoming a workflow engine.

### What a Practice looks like

```markdown
---
id: react.api.layered-design
stage: api-layer
tech_stack: [react, typescript]
applies_when: building an API layer in a React SPA
---

# Layered API Design

[Concrete guidance: http client, base API, modules, DTO boundary.]

## Anti-patterns to avoid

- api.direct-axios-in-component (call axios inside components)
- api.local-storage-in-api-class (persist tokens inside API class)
- api.dto-used-as-ui-model (reuse DTOs as UI state)
```

A **Knowledge Pack** bundles many Practices + templates + anti-patterns, scoped to a stack or team standard.

In a React auth task, for example, retrieving `react.api.layered-design` is enough to keep the component on the intended boundary:

```tsx
const { login } = useAuthApi(); // through the layered API client
await login({ email }); // token handled inside the API layer
```

The agent does not need the routing, deployment, and unrelated testing Practices at the same time.

## An end-to-end example: keep a small task small

> **Research direction:** [Issue #35](https://github.com/lorelum/lorelum/issues/35) explores Reward Hacking and behavioral overfitting in Agent Coding. This example shows the intended experience and responsibility boundary, not a capability already proven across every AI tool.

### The setup

The agent is asked to implement a settings card from an existing design. The requested result contains a title, display-name and time-zone fields, and a save action. The design does not introduce new product copy, interactions, reusable abstractions, or engineering guardrails.

### Without Lorelum — scope expands in the plan

The agent tries to make the delivery look complete and produces this plan:

```text
1. Implement the settings card and form
2. Add descriptive copy and helper text for clarity
3. Add extra success and empty states
4. Extract a reusable SettingsSection for future use
5. Add snapshots and component tests for the new content
6. Update documentation and add regression protection
```

Every item sounds defensible in isolation. Together, they turn a bounded UI task into product design, abstraction work, and permanent maintenance machinery. If nobody catches it, the tests can pass and the agent can report completion — of the plan it expanded, not the task the user asked for.

### With Lorelum — align the plan before writing code

Before committing to a plan, the agent makes a normal natural-language query:

```bash
lore query "I am implementing a settings card from an existing design. I am about to define the scope, implementation plan, and validation."
```

Lorelum can return a small set of Practices for this moment, for example:

```text
planning.ground-plan-in-user-goal
planning.separate-required-optional-and-out-of-scope
planning.scale-work-to-risk
planning.plan-evidence-for-requirements
```

The agent then produces a proportional plan:

```text
Goal: match the existing settings-card design

In scope:
- title
- display-name and time-zone fields
- save behavior

Out of scope:
- new product copy or interactions
- a reusable abstraction without a current reuse case
- permanent guardrails without an evidenced risk

Validation:
- the fields render correctly
- saving works
- existing relevant tests still pass
```

### The result

The agent implements the requested card, reuses the existing layout and relevant tests, and stops. Planning did not become another ceremony: for a narrow change, the same reasoning could be a brief scope check rather than a checked-in plan, spec, or ADR.

If the agent has already drifted and the user asks it to remove invented copy, correction is still a useful retrieval moment. But removing an unsolicited addition normally restores the original baseline; it does not automatically create a permanent requirement that the text must never exist. A negative test or guardrail needs a durable product contract or an evidenced risk — not merely a record of the agent's own mistake.

## A long-running-task example: reduce contamination before compaction, re-ground after

> **Research direction:** [Issue #32](https://github.com/lorelum/lorelum/issues/32) explores content selection and contamination control before compaction; [Issue #28](https://github.com/lorelum/lorelum/issues/28) explores recovery and Practice injection at critical moments after it. This example shows the intended experience and responsibility boundary, not a capability already shipped in every AI tool.

### The setup

An agent is implementing a common account-settings feature. The acceptance criteria cover the whole user-visible capability:

- the page edits a display name and time zone;
- the API validates and authorizes the update;
- the change persists and still appears after a reload; and
- the complete flow works for both allowed and denied users.

Before compaction, the working context contains several very different kinds of information:

- the authoritative spec, current goal, and acceptance criteria;
- the current form implementation and its focused component-test results;
- a rejected shortcut that saved settings only in the client and skipped server authorization;
- a disproved assumption that the existing endpoint already persisted the time zone;
- a legacy `LegacySettingsPanel` that bypasses the current API path; and
- long test logs, browser output, and temporary debugging notes.

They should not all survive compaction in the same way:

| Content                                               | How compaction should treat it                                       |
| ----------------------------------------------------- | -------------------------------------------------------------------- |
| Current goal, authoritative spec, acceptance criteria | Must be preserved                                                    |
| Accepted decisions                                    | Preserve the decision and only the rationale needed to understand it |
| Rejected approaches and disproved assumptions         | Preserve the conclusion, not the full exploration trail              |
| Long logs and tool output                             | Preserve only key errors and evidence                                |
| Incidental issues and unrelated tasks                 | Must not continue to influence the main task                         |

After a long session, context is compacted. A poor summary can preserve the recent form refactor and green focused tests while losing the full acceptance scope. Worse, it can retain fragments of the rejected client-only shortcut, the disproved persistence assumption, or the legacy panel without preserving the fact that they are no longer authoritative.

### Without task-and-moment retrieval — local evidence becomes a global claim

The agent sees green focused tests and reports:

```text
✅ Account settings is complete. The tests pass and the UI has been verified.
```

But the evidence only covers the form component. It says nothing about API authorization, persistence after reload, the denied-user path, or the complete user flow. The tests are valid; the **claim is broader than the evidence**.

### With Lorelum — reduce contamination, then recover the facts

In the intended flow, a supported Plugin/Hook first observes that compaction is about to start and queries Lorelum for context-hygiene Practices. If the host allows external guidance to influence compaction, those Practices can tell its compactor what to preserve, what to summarize as a rejected conclusion, and what noise to omit. Lorelum does not read or rewrite the transcript itself, and integrations that cannot pass this guidance to the compactor simply continue with normal compaction.

After compaction, the integration queries Lorelum for recovery Practices. The injected guidance reminds the agent that the summary is not the source of truth and that it must re-read the durable spec, acceptance criteria, plan, and evidence before continuing.

The agent re-establishes the task and discovers that only the UI slice has been tested. Before reporting completion, it makes a normal natural-language query:

```bash
lore query "I am implementing account settings. Focused component tests pass, and I am about to declare the whole feature complete."
```

Lorelum can return a small set of Practices for this exact moment, for example:

```text
recovery.re-ground-after-context-loss
verification.match-claims-to-evidence
delivery.separate-slice-from-capability
```

The agent corrects its report instead of changing the facts to fit the desired conclusion:

```text
Completed: the settings form and its component tests.
Not yet verified: API authorization, persistence after reload, the denied-user path,
and the end-to-end acceptance flow. I cannot claim the whole feature is complete yet.
```

### What Lorelum did — and did not do

Lorelum did not store the spec, inspect the repository, run the tests, or decide that the feature was accepted. The integration recognized a relevant event; Lorelum retrieved the execution discipline needed at that moment; the agent then checked the project's real sources of truth.

The same pattern applies beyond compaction. A Skill can prompt the query when the agent is about to change a failing test, act on an unconfirmed assumption, hand work to another agent, or claim that a partial implementation is complete.

### The complete path around compaction

Immediately guessing task-specific Practices from a possibly incomplete or contaminated summary can reinforce the wrong implementation. The intended path is:

```
host signals that compaction is about to start
        │
        ▼
Plugin / Hook queries pre-compaction guidance
        │
        ▼
if supported, the host compactor uses the guidance;
otherwise, normal compaction continues safely
        │
        ▼
host creates the compacted summary
        │
        ▼
post-compaction Hook queries recovery Practices
        │
        ▼
agent re-reads the durable spec, acceptance criteria, assumptions, and evidence
        │
        ▼
agent runs a normal lore query with the re-established task and moment
```

The Plugin/Hook knows which lifecycle event the host exposed; it does not decide whether the work is correct or complete. Lorelum retrieves guidance for that task and moment; it does not store the spec, manage task state, read the full transcript, or implement the compactor. If a host cannot accept pre-compaction guidance, that stage degrades safely without blocking compaction, and the post-compaction recovery path can still be used. The agent first re-establishes the facts, then asks for task-specific guidance.

This is one example of a broader direction: supporting critical moments across the full Agentic Coding lifecycle — requirement understanding, planning, implementation, testing, verification, delivery, recovery, and correction — rather than building a special-case compaction feature.

## 5-minute tour

_(CLI is pre-alpha — commands below show the intended UX.)_

```bash
# Install a community pack (local mode, works offline)
lore install react-fullstack

# Ask: "what practices apply to my current task?"
lore query "settings page with permission guard, form, and tests"

# Retrieve scope and validation guidance before forming a plan
lore query "I am implementing an existing design and am about to decide the scope, implementation steps, and validation."

# The same natural-language query can include a critical work moment
lore query "the focused tests passed; I am about to claim the whole settings feature is complete"

# Check if your code violates any practice
lore check src/features/auth/LoginPage.tsx

# Turn a successful fix into a reusable Practice for your team
lore learn "single-flight refresh token in the HTTP client"
```

Or wire it into your AI tool via MCP — Lorelum ships an MCP server that any MCP-compatible agent (Cursor, Claude Code, Codex, Windsurf, ...) can call.

## How it's different

|                                       | `AGENTS.md` / `.cursorrules` | Skills / Slash commands | **Lorelum**                                                                                                               |
| ------------------------------------- | ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Delivery**                          | Static, all-at-once          | Manual trigger          | **Retrieved on demand**                                                                                                   |
| **Decays over session**               | Yes                          | No (one-shot)           | No (fresh each query)                                                                                                     |
| **Support around compaction**         | Manual: re-paste all rules   | Manual                  | Research: supported integrations may guide selection before compaction and recovery after it; otherwise Skill / CLI / MCP |
| **Calibrates work to scope and risk** | No                           | Depends on the workflow | Research: retrieves planning Practices and anti-patterns for the current task and moment                                  |
| **Scales to 100s of rules**           | ❌                           | Tedious                 | ✅ built for it                                                                                                           |
| **Tool-agnostic**                     | Tool-specific                | Tool-specific           | ✅ MCP / CLI / Skill                                                                                                      |
| **Anti-pattern checks**               | No                           | No                      | ✅ `lore check`                                                                                                           |

Lorelum isn't a better `.cursorrules`. It's the **Practice retrieval layer** that sits behind whatever AI tool you use.

## Architecture (in brief)

```
┌──────────────────────────────────────────────────────────┐
│  AI tool layer  (Cursor / Claude Code / Codex / Windsurf) │
└─────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌───────────────────────────────────────────────────────────┐
│ Integration: Skill / Plugin / Hook / CLI / MCP             │
│ detect or describe task + moment · invoke · inject         │
└───────────────────────────────────────────────────────────┘
                             │ query
                             ▼
┌──────────────────────────────────────────────────────────┐
│                  Lorelum engine                          │
│         retrieve + rank (embed + metadata + graph)       │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴─────────┐
   ▼                   ▼
local packs        endpoint (team / SaaS / self-hosted)
(offline)          (real-time, multi-user)
```

The integration layer owns **when to call** and **how to inject**. Lifecycle signals come from a Skill, Plugin, or Hook; Lorelum Core only retrieves the Practices relevant to the described task and moment. It does not control the host's compactor. Whether text returned at `PreCompact` can become a real compaction instruction is an integration capability that still needs to be validated. This keeps host-specific lifecycle handling out of the retrieval engine.

Two modes share the same commands:

- **Local mode (default):** `lore install` a public pack, query offline. Zero ops. Like npm.
- **Endpoint mode:** point the CLI at a team/SaaS/self-hosted endpoint for real-time, multi-user knowledge.

## Roadmap

We're building in the open, in milestones:

- **P0–P2** — Core engine: Practice format, retrieval (embed + metadata), `lore query` / `get` / `check`. Local mode only.
- **P3–P4** — First public pack (`react-fullstack`), MCP server, `lore install` / `search`, public registry MVP.
- **P5** — Endpoint kernel (AGPL, self-hostable), team packs.
- **P6** — Enterprise governance (SSO, audit, sensitive-info scanning).

See [Discussions](https://github.com/lorelum/lorelum/discussions) for what's being worked on right now.

## Project status

🟡 **Early development.** No stable release, no published CLI yet. The design is being finalized. This is the right moment to shape the direction — join [Discussions](https://github.com/lorelum/lorelum/discussions).

## Contributing

We welcome contributors. Lorelum is **open-core** (see [license architecture](#license)) — the core engine, format, and community packs are open source forever.

- 📖 Read [**CONTRIBUTING.md**](./CONTRIBUTING.md) for the development workflow (spec-driven + issue-driven)
- 🤖 Using an AI coding assistant? Also read [**AGENTS.md**](./AGENTS.md)
- 💬 Drop by [Discussions](https://github.com/lorelum/lorelum/discussions) to say hi or propose ideas
- 🐛 Found a bug? [Open an issue](https://github.com/lorelum/lorelum/issues/new/choose)

## License

Lorelum is **open-core**:

| Component                                            | License                                   |
| ---------------------------------------------------- | ----------------------------------------- |
| Core engine (CLI, local retrieval, MCP, format spec) | **Apache 2.0**                            |
| Community knowledge packs                            | **CC-BY-4.0**                             |
| Endpoint server kernel (self-hostable)               | **AGPL-3.0** _(separate repo, later)_     |
| SaaS platform & enterprise governance                | **Proprietary** _(separate repos, later)_ |

The boundary: **if it lets a developer run the full workflow offline on a personal laptop, it's open source.** The paid tiers buy managed ops, collaboration, and compliance — never gated features.

See [LICENSE](./LICENSE) for the Apache 2.0 terms applicable to this repository.

## Notes

<ol>
<li id="fn-1">~68% compliance from <em>IFScale</em> (<a href="https://arxiv.org/abs/2507.11538">Jaroslawicz et al., 2025</a>, NeurIPS 2025): even the best frontier model followed only ~68% of 500 simultaneous keyword-inclusion instructions, with accuracy degrading as instruction density grew. The <a href="https://paddo.dev/blog/your-agents-md-is-a-liability/">"Your AGENTS.md is a Liability"</a> post discusses what this means for large rules files specifically.</li>
<li id="fn-2">Position-dependent recall from <em>Lost in the Middle</em> (<a href="https://arxiv.org/abs/2307.03172">Liu et al., TACL 2024</a>): models recall information at the start and end of a long context better than in the middle — a U-shaped curve that holds even within the stated context window.</li>
</ol>

## Acknowledgements

Lorelum stands on the shoulders of the broader AI-coding and developer-tools community. The name combines **Lore** (knowledge handed down through practice) + **Lum** (light, as in lumen) — turning team engineering experience into light that AI agents can work by.
