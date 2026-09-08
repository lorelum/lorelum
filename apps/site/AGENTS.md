# AGENTS.md — apps/site

> Frontend-specific rules for AI coding agents working in this package. The
> [root AGENTS.md](../../AGENTS.md) still applies (strict TypeScript, typed
> errors, no silent failures, file organization, testing, git workflow). This
> file adds what is unique to a marketing/documentation frontend and wins on
> conflict inside `apps/site`.

## What this package is

The Lorelum landing + bilingual docs site: TanStack Start (SSR + prerender),
Fumadocs MDX, Tailwind v4 (CSS-first), React 19, GSAP, and vendored
[React Bits](https://reactbits.dev) components. Deployed to Cloudflare Workers
(see `docs/site-deploy.md`). It is the product's public face — visual quality
and performance are acceptance criteria, not polish.

## Commands

```bash
bun run --filter @lorelum/site dev        # vite dev → http://localhost:3000
bun run --filter @lorelum/site typecheck  # tsc --noEmit
bun run --filter @lorelum/site test       # bun test
bun run --filter @lorelum/site build      # static + Worker output in dist/
bun run lint                              # oxlint (repo root)
```

CI runs typecheck + lint + test on every PR. A PR that fails any of them is
not done.

## Where things go

| You are adding…                        | It goes in…                                        | Never…                                   |
| -------------------------------------- | -------------------------------------------------- | ---------------------------------------- |
| a landing section                      | `src/components/landing/sections/`                 | —                                        |
| user-facing copy (any language)        | `src/lib/translations.ts`                          | hardcode strings in components           |
| animation capability check             | `src/components/landing/gates/` (+ colocated test) | inline `matchMedia` calls in components  |
| shared animation hook / GSAP primitive | `src/components/landing/motion/`                   | a new top-level util file                |
| feature-scoped animation hook          | next to its feature (for example `src/components/navigation/`) | putting feature-only logic in shared motion |
| an ambient / effect component          | `src/components/landing/effects/`                  | a second background layer                |
| a motion-aware gate wrapper            | `src/components/landing/motion-aware/`             | an ungated wrapper named `motion-aware-*`|
| site navigation components             | `src/components/navigation/`                       | putting navbar code in `landing-shell.tsx` |
| a vendored React Bits component        | `src/components/react-bits/` + barrel `index.ts`   | `npm install` an animation library       |
| third-party component CSS              | `src/styles/vendor.css`                            | inline `<style>` or new top-level CSS    |
| page-level landing CSS                 | `src/styles/landing.css`                           | putting component CSS here by default    |
| component-owned CSS                    | next to the component (for example `src/components/navigation/*.css`) | putting it in `landing.css` or `app.css` |
| SEO head / meta                        | `src/lib/meta.ts` + route `head`                   | `<title>` back into `__root.tsx`         |
| static assets                          | `public/`                                          | `src/` (imports are for code only)       |
| docs page                              | `content/docs/*.mdx` + `*.zh.mdx`                  | one locale without the other             |

Page-level composition (`landing-page.tsx`, `landing-shell.tsx`, the
dev-only `fps-probe.tsx`) stays at the `landing/` root — it is the stable
import surface the routes consume.

`src/routeTree.gen.ts` is **generated** by TanStack Router. Never edit it; add
a file under `src/routes/` instead.

## Hard rules

These exist because breaking them caused real bugs here. Each names a file to
copy — read it before writing your own version.

1. **SSR safety.** The site server-renders and prerenders. No `window`,
   `document`, `matchMedia`, or `localStorage` at module top level or during
   render. Access browser APIs only inside effects, event handlers, or other
   client-only callbacks. Copy `src/components/landing/sections/hero.tsx`
   (gates read in effects, refs for elements).

2. **GSAP lifecycle.** Import gsap and register plugins via
   `src/components/landing/motion/gsap-client.ts` (`registerGsapPlugins()`
   before any ScrollTrigger/ScrollSmoother/SplitText use). Create tweens
   inside `gsap.context(() => {...})` and return `ctx.revert()` — never
   `gsap.matchMedia()` and never bare globals. Generic primitives belong in
   `landing/motion/`; hooks used only by a feature may stay with that feature.
   Copy `sections/hero.tsx` and `src/components/landing/motion/split-text-reveal.tsx`.

3. **ScrollTrigger is the canonical viewport gate.** Run/pause work based on
   viewport with ScrollTrigger — usually `usePauseOffscreen` from
   `src/components/landing/motion/use-viewport-anim.ts` — so every gate
   follows the ScrollSmoother's scroller and refresh timing with one idiom.
   IntersectionObserver **does** fire under the current ScrollSmoother setup
   (measured with the fps probe's `io` line: counts rise on every viewport
   crossing), but transform-based smooth scrolling has silent IO failure modes
   in other configurations, and the old "observers never fire" rule was
   measured to be false. If you must use IO anyway, verify with `?probe=1`
   first and say why in the PR.

4. **Canvas/WebGL effects are gated and single-layer.** New canvas, WebGL or
   per-frame effects must (a) render through a `motion-aware-*` wrapper in
   `landing/motion-aware/` that checks `shouldEnableCanvasEffects` from
   `gates/motion-gate`, (b) derive particle counts from
   `gates/particle-budget`, and (c) not add a second background layer —
   `effects/page-background.tsx` is the one ambient layer. Three stacked glow
   layers already had to be deleted for flicker. Copy:
   `src/components/landing/motion-aware/motion-aware-specular-button.tsx`,
   `src/components/landing/effects/antigravity.tsx` (SSR-safe Canvas usage).

5. **No `prefers-reduced-motion` machinery.** Product decision (recorded in
   commit `eec3b0e`): the site does not honor the OS reduce-motion setting.
   Gates branch on pointer type and hardware capability only. Do not re-add
   `matchMedia('(prefers-reduced-motion: …)')` or `motion-reduce:` classes.

6. **Bilingual or broken.** Every user-facing string goes through
   `LandingStrings` in `src/lib/translations.ts` with **both** the `en` and
   `zh` entries; typecheck fails on one-sided changes. Keep keys grouped by
   section with a comment, as the file already does.

7. **Vendored third-party code is ledgered.** React Bits components live in
   `src/components/react-bits/` with their license header, keep upstream
   structure, and are imported **only via the `@/components/react-bits`
   barrel**. Adding, removing or rewriting one requires a matching row in
   `apps/site/THIRD_PARTY_NOTICE.md`. Anything ported from elsewhere gets its
   own notice section with provenance and open license questions called out —
   and if a port cannot be licensed, rewrite it rather than ship it (see the
   antigravity ring's rewrite history in THIRD_PARTY_NOTICE.md).

8. **Dark mode is class-based and animated.** `dark:` is re-bound to `.dark` on `<html>`
   (`@custom-variant` in `app.css`), not `prefers-color-scheme`. Monochrome
   logo/mark assets invert under `html.dark` via `landing.css`; an asset that
   must keep brand color opts out with `.logo-keep-color`. Theme controls must
   use the View Transition API with `flushSync` when available and fall back to
   `setTheme`, so theme changes never snap unnecessarily. Verify both themes
   and the transition in a browser before declaring done. Copy:
   `src/components/navigation/theme-toggle.tsx`.

9. **Check dependencies before adding them.** The repo is Apache-2.0 core —
   no GPL/AGPL deps without maintainer sign-off. Native-JS packages need
   matching `@types/*` (`three` → `@types/three`, pinned to the same minor —
   a stale local install once masked this and broke CI). Animation needs are
   already covered by `gsap`, `motion`, `ogl`, `three`; adding another
   animation library needs justification in the PR.

## Verification loop

- Logic (gates, hooks, lib) ships with colocated `*.test.ts` (`bun test`).
  Copy: `gates/particle-budget.test.ts`.
- Visual changes are verified in the dev server — both themes, both locales
  (`/en`, `/zh`) — before the PR is marked ready.
- Navigation and theme changes must be checked at scroll position `0`, after
  leaving the top, and after crossing the hero; verify keyboard focus, touch
  targets, and the theme transition in browsers with and without View
  Transition support when practical.
- Touching animation/perf? Check the FPS overlay in dev: append `?probe=1`
  (`fps-probe.tsx`, dev-only). A scroll that drops frames is not done.
- `bun run --filter @lorelum/site build` must pass before merging; it is also
  what Cloudflare runs.
- Before opening the PR, fill every section of the root
  [PR template](../../.github/PULL_REQUEST_TEMPLATE.md), include the exact
  issue being closed, and record visual verification notes.

## Deployment

Git-integrated Workers Builds deploys **`main` only**; feature branches don't
build. Details, quotas and manual `wrangler deploy` flow:
[`docs/site-deploy.md`](../../docs/site-deploy.md).

## When in doubt

Visual/UX questions are product decisions — ask, don't guess, and don't
"fix" unrelated visuals in passing. Git workflow (PRs, Conventional Commits,
issue links) follows the root AGENTS.md.
