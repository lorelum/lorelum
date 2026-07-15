<p align="center">
  <h1 align="center">Lorelum</h1>
  <p align="center">Engineering knowledge infrastructure for AI coding agents.</p>
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

- **Your rules silently stop being followed.** Frontier models comply with only ~68% of a 500-rule ruleset — *every rule you add makes every other rule less likely to be followed.*<sup>[\[1\]](#fn-1)</sup> You don't get a warning; the agent just drifts.
- **Compaction eats your rules.** A long session triggers context compaction → your early `AGENTS.md` is gone from the window. The community workaround is to re-paste `@AGENTS.md` and dump *all* the rules back in.
- **You only find out when it's already wrong.** There is no signal that the agent has drifted — until you review the code yourself and spot the violation.

This is the **knowledge layer gap**: your rules exist, but they don't reliably reach the agent *at the moment it needs them*.

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
        ├─▶ Compaction discards     long sessions summarize the
        │   your rules               context window — rules fall out
        │
        └─▶ Drift is invisible      no signal, until you review the
                                     code and find the violation
```

The conventional approach ("paste all the rules into context") fights physical limits: attention decay across long sessions, context-window capacity, and the fact that *more rules lower per-rule compliance*.<sup>[\[2\]](#fn-2)</sup> Even a 1M-token window doesn't recall early instructions reliably after compaction. **More rules ≠ more control.** Throwing more context at the problem doesn't fix it.

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

**Lorelum doesn't replace your `AGENTS.md` — it keeps it alive.** Every time the agent needs a piece of it, Lorelum re-injects that exact slice. When the agent starts implementing auth, Lorelum hands it the auth Practice — not the routing, testing, and deployment Practices too.

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

## An end-to-end example

Same task, same agent — once without Lorelum, once with.

### The setup

A long session. Your `AGENTS.md` says *"layer the API; never call axios from a component."* But that was 40 messages ago, and the context was just compacted. The agent is now asked to build a login page.

### Without Lorelum — the agent drifts

```tsx
// LoginPage.tsx — what the agent wrote
function LoginPage() {
  const [email, setEmail] = useState("");
  async function handleLogin() {
    const res = await axios.post("/api/login", { email });  // ❌ axios in component
    localStorage.setItem("token", res.data.token);           // ❌ token in localStorage
  }
}
```

It called `axios` inside the component and stuffed the token into `localStorage`. Your rules said not to. The agent never knew it broke them.

### With Lorelum — triggered, not dumped

When the agent touches `src/features/auth/`, Lorelum retrieves the one Practice that applies — `react.api.layered-design` — and injects only that slice:

```markdown
## Anti-patterns to avoid
- api.direct-axios-in-component   (call axios inside components)
- api.local-storage-in-api-class  (persist tokens inside API class)
- api.dto-used-as-ui-model        (reuse DTOs as UI state)
```

The agent rewrites its own output — *fresh, from the relevant slice, not the whole ruleset*:

```tsx
// LoginPage.tsx — corrected by the agent after injection
function LoginPage() {
  const { login } = useAuthApi();   // ✅ through the layered API client
  async function handleLogin() {
    await login({ email });          // ✅ token handled inside the API layer
  }
}
```

### The loop closes

```bash
lore check src/features/auth/LoginPage.tsx   # confirms no violation
lore learn "single-flight refresh token in the HTTP client"
```

That fix is now a Practice your whole team retrieves next time — without anyone re-pasting an `AGENTS.md`.

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

# Turn a successful fix into a reusable Practice for your team
lore learn "single-flight refresh token in the HTTP client"
```

Or wire it into your AI tool via MCP — Lorelum ships an MCP server that any MCP-compatible agent (Cursor, Claude Code, Codex, Windsurf, ...) can call.

## How it's different

| | `AGENTS.md` / `.cursorrules` | Skills / Slash commands | **Lorelum** |
|---|---|---|---|
| **Delivery** | Static, all-at-once | Manual trigger | **Retrieved on demand** |
| **Decays over session** | Yes | No (one-shot) | No (fresh each query) |
| **Re-injection after compaction** | Manual: re-paste all rules | Manual | ✅ Automatic, task-scoped |
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

## Notes

<ol>
<li id="fn-1">~68% compliance from <em>IFScale</em> (<a href="https://arxiv.org/abs/2507.11538">Jaroslawicz et al., 2025</a>, NeurIPS 2025): even the best frontier model followed only ~68% of 500 simultaneous keyword-inclusion instructions, with accuracy degrading as instruction density grew. The <a href="https://paddo.dev/blog/your-agents-md-is-a-liability/">"Your AGENTS.md is a Liability"</a> post discusses what this means for large rules files specifically.</li>
<li id="fn-2">Position-dependent recall from <em>Lost in the Middle</em> (<a href="https://arxiv.org/abs/2307.03172">Liu et al., TACL 2024</a>): models recall information at the start and end of a long context better than in the middle — a U-shaped curve that holds even within the stated context window.</li>
</ol>

## Acknowledgements

Lorelum stands on the shoulders of the broader AI-coding and developer-tools community. The name combines **Lore** (knowledge handed down through practice) + **Lum** (light, as in lumen) — turning team engineering experience into light that AI agents can work by.
