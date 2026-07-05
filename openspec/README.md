# OpenSpec — Lorelum specifications

> **Spec = source.** This directory holds Lorelum's product specifications. They are the single source of truth for *what* Lorelum is — not an afterthought to the code.

## Layout

```
openspec/
├── specs/           # canonical, adopted specifications (the "what is Lorelum")
│   ├── 01-core-concepts.md
│   ├── 02-knowledge-pack.md
│   ├── 03-cli-design.md
│   ├── 04-skill-and-mcp.md
│   └── 05-registry.md
└── changes/         # proposed changes & decision records (the "why we changed it")
    └── 000-template.md
```

## How to read

- **New to Lorelum?** Start with [`specs/01-core-concepts.md`](./specs/01-core-concepts.md).
- **Wondering why a decision was made?** Search [`changes/`](./changes/) — it's our ADR-style history.
- **Planning a change?** Read [`AGENTS.md`](./AGENTS.md) in this directory for the spec workflow.

## Status

Specs in `specs/` are **adopted** — they describe the current or near-current design. Anything under development will be marked clearly at the top of the file.

Lorelum is in early development, so specs evolve fast. Each material change goes through a proposal in `changes/`.

## Language

All specs are written in **English**. Lorelum is an international project; specs are source code and a single language avoids drift.
