# ADR 0002: Bun + TypeScript toolchain

- **Date:** 2026-07-08
- **Status:** Accepted

## Context

Lorelum ships a CLI (`lore`), a local MCP server, a Practice/pack parser, and a retrieval engine. Before writing code, we needed to pick a runtime, language, and package manager. This is the single most expensive decision to reverse later — once packages, build steps, and contributors depend on a stack, changing it means a full rewrite.

The constraints that shaped the choice:

1. **CLI first.** The primary user-facing surface is a command-line tool. Fast cold start, fast install, and single-binary distribution materially affect user experience.
2. **MCP is a core surface.** Lorelum's value is delivered to AI agents via an MCP server. The official `@modelcontextprotocol/sdk` is a Node/TypeScript library, so a JS-runtime stack avoids a foreign-function bridge.
3. **Type safety is non-negotiable for the format layer.** The Practice/pack schema is a public contract. We want runtime validation and static types derived from the same source.
4. **AI toolchain alignment.** Most AI coding agents and their ecosystems (Cursor, Claude Code, Codex, MCP SDK, embedding SDKs) are TypeScript-first. Working in the same language reduces friction across the board.
5. **Open-core friendly.** The engine is Apache-2.0; we must be able to inspect the dependency tree for license conflicts.

## Decision

**Runtime & package manager: Bun.**
**Language: TypeScript** (`strict: true`), run directly by Bun without a separate compile step.
**Monorepo: Bun workspaces** (`packages/cli`, `engine`, `format`, `mcp`, `shared`).

For the adjacent tooling (chosen at the same time and documented here for completeness):

| Concern | Choice |
|---|---|
| Tests | `bun:test` |
| Lint | `oxlint` |
| Format | `oxfmt` (beta; see consequences) |
| Schema validation | `zod` (export JSON Schema for pack authors) |
| Embedding | thin OpenAI-compatible client (covers Voyage/Jina/Ollama via `baseURL`) |
| Local vector store (P2) | `bun:sqlite` + in-memory brute-force cosine search |
| MCP | `@modelcontextprotocol/sdk` |

### Why Bun over Node + pnpm

- **All-in-one binary.** `bun install / run / test / build` live in one executable; contributors install one thing.
- **Single-binary distribution.** `bun build --compile` produces a standalone CLI binary — users don't need to install Bun to use `lore`.
- **TypeScript native.** `.ts` runs directly; no `tsc` prerequisite in the dev loop.
- **Speed.** Install and cold start are dramatically faster than Node, which matters for a CLI users invoke often.
- **Node compatibility** covers the npm ecosystem, including the MCP SDK.

Node + pnpm remains the **fallback** if Bun incompatibilities block us. Today Bun is mature (stable since 2023) and the MCP SDK runs cleanly under it.

### Why TypeScript over Go / Rust / Python

- Go: weak MCP SDK support, AI toolchain is not Go-native.
- Rust: best performance, but slow iteration and a thin CLI ecosystem — overkill for a knowledge-retrieval CLI.
- Python: distribution pain (packaging, version management) and weak static typing.

TypeScript is the common language of the AI tooling ecosystem Lorelum integrates with.

## Consequences

**Positive:**

- One toolchain to learn, one to install. Contributors get `bun install` → `bun test` in seconds.
- MCP server, CLI, and parser share types end-to-end — no serialization cliff between layers.
- `bun build --compile` gives us a distributable binary without a separate packaging step.

**Negative / accepted risk:**

- **`oxfmt` is still in beta** (as of mid-2026). It passes 100% of Prettier's JS/TS conformance tests, but stable is not 1.0 yet. Mitigation: **pin the version in CI**; treat formatter upgrades as PR-reviewed changes, not automatic.
- **Embedding providers lock the index dimension.** Different providers use different vector dimensions (OpenAI 1536, Voyage 1024, Jina 768). Switching the default provider invalidates stored embeddings and forces a full re-embed. Mitigation: P2 standardizes on one default (`text-embedding-3-small`); multi-provider support is a later concern.
- **Native Node addons** (e.g. `better-sqlite3`) are a Bun compatibility risk. We deliberately avoid them in P2 by using Bun's built-in `bun:sqlite`. If a future phase needs a native vector extension, re-validate Bun compatibility before committing.

**Follow-ups:**

- The vector store choice (brute-force in P2) is intentionally minimal. P4 will revisit once we hit the roadmap's "million Practices < 100ms" target — see the corresponding section in the internal roadmap.
- Lint/format version pinning and the CI workflow land with the P2 code scaffold.
