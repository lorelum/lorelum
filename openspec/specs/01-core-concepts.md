# Spec 01 — Core Concepts

> **Status:** 🔨 Stub — content being ported from private design docs.
> This file defines the foundational vocabulary of Lorelum.

## Overview

Lorelum is engineering-knowledge infrastructure for AI coding agents. It converts team engineering experience into discrete, retrievable, trigger-conditioned units called **Practices**, and injects them into AI context at the moment of need.

## Core vocabulary

| Term | Definition |
|---|---|
| **Practice** | A discrete engineering guideline, the atomic unit of knowledge. Has an id, stage, applies_when, content, and linked anti-patterns. |
| **Knowledge Pack** | A bundle of Practices + a decision graph (`decisions.yaml`) + templates + anti-patterns, scoped to a stack or team standard. |
| **Decision Node** | A node in `decisions.yaml` — evaluates project context and recommends a Practice (or branch of nodes). |
| **Anti-Pattern** | A specific mistake pattern to avoid, linked to a Practice. Used by `lore check`. |
| **Template Hint** | A reusable code/doc skeleton tied to a Practice, used by `lore scaffold`. |

## The core principle

> **Need-to-know, not all-at-once.** Lorelum retrieves the 2-3 Practices relevant to the *current* task, rather than dumping the whole ruleset into context.

## Two consumption modes

- **Local mode (default):** install packs locally, query offline, zero ops.
- **Endpoint mode:** point the CLI at a team / SaaS / self-hosted endpoint for real-time, multi-user knowledge.

Both modes share the same command surface (`query`, `get`, `decide`, `check`).

---

<!-- TODO: port full content from private spec, translated to English, rationale stripped. -->
