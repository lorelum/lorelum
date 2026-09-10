# @lorelum/ui

Private workspace package for Lorelum's reusable Web components and production design tokens. The root [`DESIGN.md`](../../DESIGN.md) is the agent-readable design contract; this package is its runtime implementation for Web products.

```tsx
import { Button } from "@lorelum/ui/components/button";
```

The consuming application imports `@lorelum/ui/globals.css` once. It must provide the `.dark` class lifecycle; this package intentionally has no ThemeProvider.

## Ownership

- `src/styles/tokens.css`: token values and light/dark semantic roles.
- `src/styles/theme.css`: Tailwind v4 mappings only.
- `src/styles/globals.css`: stable CSS import entry.
- `src/components/`: reviewed shadcn source using Base UI and Lucide conventions.
- `src/lib/utils.ts`: shared `cn` implementation.

Typography roles use `type-*` utilities such as `type-label` and `type-body`. Do not expose them as `text-*`: class-merging tools treat that namespace as text color and may remove the typography role when a semantic foreground class is present.

Design values represented in `DESIGN.md` and `tokens.css` must change together. Run `bun run design:lint` plus this package's tests to catch format, theme-parity, contrast, and Tailwind-mapping drift.

Run `bunx --bun shadcn@latest info --json` here before component work. Add components from an explicit registry only after reading their docs and previewing `--dry-run`.
