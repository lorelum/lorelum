# Lorelum Web Design Infrastructure

> Implementation plan for [Issue #86](https://github.com/lorelum/lorelum/issues/86). This document describes the current approved stage; it does not publish a UI package or redesign the landing page.

## Conclusion

Create a private workspace package, `@lorelum/ui`, as the single Web UI ownership boundary. It owns production CSS tokens, Tailwind v4 mappings, and a small set of reviewed shadcn components. The site imports that contract, keeps its existing Fumadocs/next-themes provider, and retains route, locale, navigation-motion, and landing-effects behavior.

This stage deliberately avoids a token compiler, Storybook, a second theme provider, and bulk component installation. CSS is already the only confirmed runtime consumer. A larger platform would add generation and release semantics without solving a current problem.

## Observed starting state

- The root workspace already includes `packages/*` and `apps/*`; no new monorepo runner is needed (`package.json`).
- The site is React 19, TanStack Start, Tailwind v4, and Fumadocs (`apps/site/package.json`).
- `fumadocs-ui` resolves to `@fumadocs/base-ui`, and `@base-ui/react` is already in the dependency graph. Base UI is therefore the lowest-friction shadcn primitive choice.
- Fumadocs' `RootProvider` and `next-themes` own the `.dark` class. The existing theme toggle preserves hydration safety and View Transition behavior (`apps/site/src/app/root-document.tsx`, `src/shared/ui/theme-toggle.tsx`).
- The global stylesheet currently imports Fumadocs' neutral theme, while brand and component values are distributed through `app.css`, landing styles, navigation styles, and vendored component CSS.
- The site already uses Lucide. The current base-nova generator selects `cn@0.2.6`, so the shared package owns that helper and the site re-exports it rather than keeping a second direct utility dependency. The site retains `cnfast` while legacy landing motion utilities still consume its compatibility export.

## Required result

- A stable package import for shared components and tokens.
- One production source for light/dark semantic roles, with Tailwind and Fumadocs consuming adapters.
- A reviewed shadcn workflow that writes source into the shared package.
- At least one real site control consuming the package while preserving its current behavior.
- Tests that fail when theme roles drift, required component states disappear, or SSR output loses semantics.
- No change to Practice, retrieval, CLI, MCP, persistence, or release contracts.

## Responsibility and dependency direction

```text
approved brand decisions
        |
        v
@lorelum/ui tokens.css  -->  theme.css  -->  Tailwind utilities
        |                                  |
        +--> Fumadocs shadcn adapter        +--> shared components
                         \                       |
                          +------ apps/site <----+
```

The root `DESIGN.md` follows Google's DESIGN.md alpha format and is the agent-readable design contract. Its YAML values are normative for the visual roles represented there. `tokens.css` is the production Web implementation and keeps those values aligned while extending them with runtime-only roles. `theme.css` maps variables into Tailwind namespaces and contains no palette. Shared components consume semantic utilities. The site owns the theme lifecycle and applies its own composition, locale, routing, data, and animation.

`@lorelum/shared` remains domain-neutral and must not import React, browser primitives, Tailwind, or UI dependencies.

## Package contract

The first package surface is intentionally narrow:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./globals.css": "./src/styles/globals.css",
    "./tokens.css": "./src/styles/tokens.css",
    "./components/*": "./src/components/*.tsx",
    "./lib/utils": "./src/lib/utils.ts"
  }
}
```

The package is private and source-distributed inside the workspace. React is a peer dependency. Runtime dependencies belong to the UI package rather than relying on Fumadocs transitive packages. CSS is marked as a side effect; no `dist/` is built or committed in this stage.

## Token layers

`tokens.css` has two runtime layers in one source:

- Foundations use the `--lore-*` prefix: brand palette, typography, spacing roles, radii, blur, shadow, motion, layout, and layer values.
- Semantic roles use conventional shadcn names: `--background`, `--foreground`, `--primary`, `--accent`, `--border`, `--ring`, feedback roles, chart roles, and sidebar roles. `:root` is light; `.dark` is dark.

Primary action colors preserve the approved pair: light uses `#168263` with white; dark uses brand green `#35b88f` with `#10251e`. Blur and surface alpha remain independent. Product code consumes roles, not raw palette steps.

The current runtime has only a CSS consumer, so DESIGN.md-to-CSS generation is deferred. The official `designmd lint` command validates the document schema, while package tests guard theme parity, contrast, and CSS mapping. Reconsider generation when a confirmed non-CSS consumer needs the same values or repeated releases show manual drift.

## shadcn ownership

Both `packages/ui` and `apps/site` have `components.json` with the same `base-nova`, Base UI, Lucide, Tailwind v4, and CSS-variable decisions. The shared package configuration is the only place used to add reusable primitives. The site configuration teaches blocks and future tooling to import shared UI rather than creating a second local `components/ui` tree.

The initial set is Button, Badge, and Separator. They cover commands, status labels, and structural division without pre-installing speculative forms, overlays, tables, or navigation systems. Components are added from the explicit `@shadcn` registry, reviewed after generation, and changed only through semantic variants.

## Site integration

The site imports `@lorelum/ui/globals.css` after Tailwind and explicitly sources the workspace package for class discovery. Fumadocs switches from its standalone neutral palette to its shadcn adapter. Its selector-level adapter stays isolated at `src/features/docs/styles/docs.css` and is loaded only by the Docs screen. No additional provider is mounted.

The existing `ThemeToggle` becomes the first shared Button consumer. Its mount guard, locale label, `next-themes` state, View Transition path, and fallback stay site-owned. This proves SSR and real production consumption without rewriting the navbar or landing composition.

Landing-specific raw colors and special effects are not migrated in this stage. They remain visible debt rather than being silently declared compliant with the new system.

## Verification and rollback

Automated evidence:

- UI package typecheck and `bun:test` cover token parity/contrast and server-rendered component semantics.
- Root typecheck, lint, and tests cover workspace integration.
- The production site build proves package exports, Tailwind class discovery, SSR, and prerendering.

Browser evidence checks the landing and docs in English/Chinese and light/dark themes, keyboard focus, theme transition, top/detached navbar states, and touch target size. If integration regresses, revert the site consumer import first; the new private package has no external consumers or stored state.

## Deferred

- Publishing `@lorelum/ui` or providing semantic-version guarantees.
- A standalone token compiler, registry service, or cross-platform format.
- Storybook or a public component gallery.
- Bulk shadcn installation, app shells, tables, forms, and overlay systems without concrete consumers.
- Landing redesign, Fumadocs replacement, animation-library migration, or movement of WebGL/GSAP effects into shared UI.

These decisions reopen only when a real second consumer, a non-CSS export requirement, or recurring component review work provides evidence for the added lifecycle.
