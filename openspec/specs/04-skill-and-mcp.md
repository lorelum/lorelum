# Spec 04 — Skill Layer & MCP Server

> **Status:** 🔨 Stub — content being ported.

## The boundary

> **Skills decide *when* to query and *how* to turn knowledge into action.**
> **Knowledge Packs hold *what* the knowledge is.**

Skills are workflow orchestration — they must NOT embed domain-specific best practices. A Skill analyzes the task, calls Lorelum, and applies results. The Practice content lives in packs.

## MCP tools (surface)

| Tool | Purpose |
|---|---|
| `list_packs()` | list installed/available packs |
| `search_practices(context, filters?)` | semantic + metadata search |
| `get_practice(id)` | fetch full Practice content |
| `decide(context, constraints?)` | run the decision graph |
| `get_template(id)` | fetch a template hint |
| `scaffold(practice_id, path, opts?)` | dry-run code generation |
| `check_file(path, practice_ids?)` | check a file against anti-patterns |
| `audit_project(scope?)` | project-wide audit |

<!-- TODO: port full Skill design (best-practice-coding, code-review-with-practices, architecture-decision, practice-learning) from private spec. -->
