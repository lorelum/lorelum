# AGENTS.md — apps/site

The [root AGENTS.md](../../AGENTS.md) applies here. This file only adds rules
specific to Lorelum's public landing and bilingual docs site.

## Stack and commands

TanStack Start (SSR + prerender), Fumadocs MDX, Tailwind v4, React 19, GSAP,
and vendored React Bits components. Visual quality and runtime performance are
part of the acceptance criteria.

```bash
bun run --filter @lorelum/site dev
bun run --filter @lorelum/site typecheck
bun run --filter @lorelum/site test
bun run --filter @lorelum/site build
bun run lint
```

## File placement

- Framework document/provider composition belongs in `src/app/`; route files
  stay thin and only wire TanStack URL, head, loader, and response contracts.
- Product-owned code belongs in `src/features/<feature>/`; stable site-wide
  brand, config, i18n, utilities, UI, and runtime integrations belong in
  `src/shared/`. Shared code must not import a feature.
- Landing navigation belongs in `src/features/landing/navigation/`. The legacy
  Landing implementation remains in `src/components/landing/` until its visual
  rewrite; do not expand that exception or move its old CSS merely for symmetry.
- Vendored React Bits source belongs in `src/vendor/react-bits/`. Vendor code
  may import external packages only; keep provenance and Aurora's direct lazy
  import boundary intact.
- Use Tailwind utilities and semantic tokens for ordinary layout and states.
  Add CSS only for complex animation, material/filter effects, pseudo-elements,
  upstream adaptation, or selector relationships that utilities cannot express
  clearly. Do not put feature styles in `styles/app.css`.
- The current handwritten locale catalog is a temporary compatibility layer in
  `src/shared/i18n/legacy-translations.ts`. Do not redesign or replace i18n as
  part of a directory-only migration.
- Docs source stays in `content/docs/`; `src/routeTree.gen.ts` is generated and
  must never be edited.

## Runtime rules

- Keep SSR safe: access `window`, `document`, `matchMedia`, and `localStorage`
  only in effects, event handlers, or other client-only callbacks.
- Lorelum-owned GSAP choreography uses `shared/motion/gsap-client.ts`. Keep
  vendored React Bits self-contained; its client-only upstream registration is
  the narrow exception. Create site-owned work inside `gsap.context` and return
  `ctx.revert()`. Under ScrollSmoother, use ScrollTrigger rather than raw
  window-scroll calculations.
- Canvas/WebGL and per-frame effects must be capability-gated and must not add
  another ambient background layer. `effects/page-background.tsx` owns that layer.
- The current product decision does not use `prefers-reduced-motion`; do not
  add it unless that decision changes.
- Dark mode is the `.dark` class on `<html>`. Theme controls use the View
  Transition API with `flushSync` when available, and fall back to `setTheme`.
- Check dependency licenses before adding packages; new animation packages need
  a concrete justification because GSAP, Motion, OGL, and Three are available.

## Verification and delivery

- Add colocated `bun:test` coverage for new logic, gates, and hooks.
- Manually verify visual work in both locales and themes. For navigation, check
  the top state, detached state, hero transition, keyboard focus, and touch targets.
- For animation or performance changes, use `?probe=1`; a frame-dropping scroll
  is not done.
- Before a PR, run typecheck, tests, lint, and build; then follow the root PR
  template and include the visual verification result.

## Deployment

Production deployment is manual through the `Deploy site` GitHub Actions
workflow. Merging to `main` does not deploy automatically. See
[`docs/development/site-deploy.md`](../../docs/development/site-deploy.md).
