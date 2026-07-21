import type { Practice } from "../schema";

/**
 * Seed Practice — `react.api.layered-design`, README-aligned.
 *
 * Frontmatter mirrors the README sample; `title` and `severity` (omitted in
 * README) are filled to satisfy PracticeSchema. The three README anti-patterns
 * are structured into `{ id, name, description, severity }`.
 */
export const layeredDesignPractice: Practice = {
  id: "react.api.layered-design",
  title: "Layered API Design",
  stage: "api-layer",
  tech_stack: ["react", "typescript"],
  applies_when: "building an API layer in a React SPA",
  severity: "warn",
  body: "Concrete guidance: http client, base API, modules, DTO boundary.",
  anti_patterns: [
    {
      id: "api.direct-axios-in-component",
      name: "Direct axios in component",
      description:
        "Call axios inside components. Wrap it in the API layer; components call via hooks.",
      severity: "warn",
    },
    {
      id: "api.local-storage-in-api-class",
      name: "Local storage in API class",
      description: "Persist tokens inside the API class. Keep persistence in a dedicated module.",
      severity: "warn",
    },
    {
      id: "api.dto-used-as-ui-model",
      name: "DTO used as UI model",
      description: "Reuse DTOs as UI state. Map DTOs to UI models at the boundary.",
      severity: "warn",
    },
  ],
};

/**
 * The same Practice authored as a markdown file with YAML frontmatter —
 * what a pack author actually writes. `parseFrontmatter(layeredDesignMarkdown)`
 * yields `.data` that feeds `PracticeSchema.safeParse` and matches the fields
 * above. Anti-patterns are NOT in the markdown (they ship in a separate
 * structured file in real packs); the end-to-end test checks frontmatter
 * fields only.
 */
export const layeredDesignMarkdown = `---
id: react.api.layered-design
title: Layered API Design
stage: api-layer
tech_stack: [react, typescript]
applies_when: building an API layer in a React SPA
severity: warn
---

# Layered API Design

Concrete guidance: http client, base API, modules, DTO boundary.
`;
