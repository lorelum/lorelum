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

- Landing composition and sections: `src/components/landing/`.
- Navigation and its feature-only hooks/CSS: `src/components/navigation/`.
  Do not put navbar implementation or styles in `landing-shell.tsx` or
  `styles/landing.css`.
- Shared landing animation primitives: `landing/motion/`; gates: `landing/gates/`;
  ambient effects: `landing/effects/`.
- User-facing copy: `src/lib/translations.ts`, with both `en` and `zh` values.
- Page-level landing styles: `src/styles/landing.css`; component styles stay
  with their component. Only change `app.css` for global imports or theme tokens.
- Vendored React Bits components: `src/components/react-bits/`, through its
  barrel, with `THIRD_PARTY_NOTICE.md` updated when required.
- Docs: `content/docs/`; routes are added under `src/routes/`.
  `src/routeTree.gen.ts` is generated—never edit it.

## Runtime rules

- Keep SSR safe: access `window`, `document`, `matchMedia`, and `localStorage`
  only in effects, event handlers, or other client-only callbacks.
- Use `landing/motion/gsap-client.ts` for GSAP. Register plugins, create work
  inside `gsap.context`, and return `ctx.revert()`. Use ScrollTrigger for
  viewport behavior under ScrollSmoother.
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

Workers Builds deploys `main` only. See [`docs/site-deploy.md`](../../docs/site-deploy.md).
