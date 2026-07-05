# Spec 02 — Knowledge Pack Format

> **Status:** 🔨 Stub — content being ported.
> Defines the on-disk format of a Knowledge Pack.

A Knowledge Pack is a directory containing:

```
my-pack/
├── pack.yaml           # metadata: name, version, tech_stack, dependencies
├── decisions.yaml      # decision graph (DAG of Decision Nodes)
├── practices/          # one Markdown file per Practice
│   └── api-layered-design.md
├── anti-patterns/      # one file per anti-pattern
│   └── direct-axios-in-component.md
└── templates/          # template hints (code skeletons)
    └── api-http-layer.ts
```

## pack.yaml (sketch)

```yaml
name: react-fullstack
version: 1.0.0
description: Best practices for React SPA applications
tech_stack: [react, typescript]
stages: [project-init, routing, auth, state-management, api-layer, ui, testing, deployment]
dependencies:
  - typescript-core@^1.0.0
```

## Practice frontmatter (sketch)

```markdown
---
id: react.api.layered-design
stage: api-layer
tech_stack: [react, typescript]
applies_when: building an API layer in a React SPA
anti_patterns: [api.direct-axios-in-component]
---
```

<!-- TODO: port full schema, validation rules, dependency resolution from private spec. -->
