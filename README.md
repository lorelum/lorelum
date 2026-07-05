<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">Engineering knowledge infrastructure for AI coding agents.</p>
  <p align="center">
    <a href="https://github.com/lorelum/lorelum/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue"></a>
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

You've felt this:

- Your team wrote a `.cursorrules` / `AGENTS.md` / Skills file. It worked for the first 10 minutes of a session. By message 20, the agent has forgotten the rules from message 1.
- Every developer's AI assistant outputs **different** architecture, naming, error handling, API layering — even though "the standard" is written down somewhere.
- Onboarding new AI tools feels like starting from scratch every time: rewrite the conventions, re-explain the stack, re-state the anti-patterns.

You're not alone. This is the **knowledge layer gap** in AI coding.

## Why it happens

```
                       ┌─────────────────────────────────┐
                       │  full ruleset dumped at start   │
                       │  (10k tokens of conventions)    │
                       └──────────────┬──────────────────┘
                                      ▼
   message 1 ── message 5 ── message 10 ── message 20 ── message 30
   [rules recalled]   [partial]        [attention decay]   [forgotten]
```

The conventional approach ("paste all the rules into context") fights two **physical limits**: attention decay across long sessions, and context-window capacity. Even a 1M-token window doesn't recall early instructions reliably after long sessions. Throwing more context at the problem doesn't fix it.

## How Lorelum solves it

Lorelum turns team engineering experience into **discrete, retrievable, trigger-conditioned units called *Practices*** — and injects them into AI context **at the moment of need**, not all at once.

```
   ┌─────────────┐   query    ┌────────────────────┐   precise   ┌──────────────┐
   │  AI agent   │ ─────────▶ │      Lorelum       │ ──────────▶ │  3 relevant  │
   │ (Cursor /   │            │  retrieval engine  │             │  Practices   │
   │  Claude /   │ ◀───────── │  (embed + metadata │ ◀────────── │  + anti-     │
   │  Codex)     │   inject   │   + graph)         │             │  patterns    │
   └─────────────┘            └────────────────────┘             └──────────────┘
```

**Need-to-know, not all-at-once.** When the agent starts implementing auth, Lorelum hands it the auth Practice — not the routing, testing, and deployment Practices too.

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
- api.direct-axios-in-component   (call axios inside components)
- api.local-storage-in-api-class  (persist tokens inside API class)
- api.dto-used-as-ui-model        (reuse DTOs as UI state)
```

A **Knowledge Pack** bundles many Practices + a decision graph (`decisions.yaml`) + templates + anti-patterns, scoped to a stack or team standard.

## 5-minute tour

*(CLI is pre-alpha — commands below show the intended UX.)*

```bash
# Install a community pack (local mode, works offline)
lore install react-fullstack

# Ask: "what practices apply to my current task?"
lore query "settings page with permission guard, form, and tests"

# Get a decision recommendation based on project context
lore decide "React SPA, medium client state, RBAC routes, component tests"

# Check if your code violates any practice
lore check src/features/auth/LoginPage.tsx
```

Or wire it into your AI tool via MCP — Lorelum ships an MCP server that any MCP-compatible agent (Cursor, Claude Code, Codex, Windsurf, ...) can call.

## How it's different

| | `.cursorrules` / `AGENTS.md` | Skills / Slash commands | **Lorelum** |
|---|---|---|---|
| **Delivery** | Static, all-at-once | Manual trigger | **Retrieved on demand** |
| **Decays over session** | Yes | No (one-shot) | No (fresh each query) |
| **Scales to 100s of rules** | ❌ | Tedious | ✅ built for it |
| **Captures team decisions** | No | No | ✅ `decisions.yaml` |
| **Tool-agnostic** | Tool-specific | Tool-specific | ✅ MCP / CLI / Skill |
| **Anti-pattern checks** | No | No | ✅ `lore check` |

Lorelum isn't a better `.cursorrules`. It's the **retrieval + decision layer** that sits behind whatever AI tool you use.

## Architecture (in brief)

```
┌──────────────────────────────────────────────────────────┐
│  AI tool layer  (Cursor / Claude Code / Codex / Windsurf) │
└────────────┬─────────────────────────────────┬───────────┘
             │ CLI                              │ MCP
             ▼                                  ▼
┌──────────────────────────────────────────────────────────┐
│                  Lorelum engine                          │
│   retrieval (embed + metadata + graph) · decisions.yaml  │
└────────────┬─────────────────────────────────────────────┘
             │
   ┌─────────┴─────────┐
   ▼                   ▼
local packs        endpoint (team / SaaS / self-hosted)
(offline)          (real-time, multi-user)
```

Two modes share the same commands:
- **Local mode (default):** `lore install` a public pack, query offline. Zero ops. Like npm.
- **Endpoint mode:** point the CLI at a team/SaaS/self-hosted endpoint for real-time, multi-user knowledge.

## Roadmap

We're building in the open, in milestones:

- **P0–P2** — Core engine: Practice format, retrieval (embed + metadata), `lore query` / `get` / `decide` / `check`. Local mode only.
- **P3–P4** — First public pack (`react-fullstack`), MCP server, `lore install` / `search`, public registry MVP.
- **P5** — Endpoint kernel (AGPL, self-hostable), team packs, decision graph evaluator.
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

| Component | License |
|---|---|
| Core engine (CLI, local retrieval, MCP, format spec) | **Apache 2.0** |
| Community knowledge packs | **CC-BY-4.0** |
| Endpoint server kernel (self-hostable) | **AGPL-3.0** *(separate repo, later)* |
| SaaS platform & enterprise governance | **Proprietary** *(separate repos, later)* |

The boundary: **if it lets a developer run the full workflow offline on a personal laptop, it's open source.** The paid tiers buy managed ops, collaboration, and compliance — never gated features.

See [LICENSE](./LICENSE) for the Apache 2.0 terms applicable to this repository.

## Acknowledgements

Lorelum stands on the shoulders of the broader AI-coding and developer-tools community. The name combines **Lore** (knowledge handed down through practice) + **Lum** (light, as in lumen) — turning team engineering experience into light that AI agents can work by.
