# Third-party notices

This project vendors third-party source code. Each vendored file keeps its original
license header; this file records provenance for review.

## React Bits — animated components

- Source: <https://reactbits.dev> · <https://github.com/DavidHDev/react-bits>
- License: **MIT + Commons Clause** (<https://reactbits.dev/LICENSE.md>)
- Vendored into `apps/site/src/vendor/react-bits/` (TypeScript + Tailwind variants):
- Snapshot date: **2026-08-25** (files fetched on this date; `git log` per file may show later
  first-commit dates when a file landed in a later commit, but the vendored content matches this
  upstream snapshot). Re-diff against upstream to pick up fixes.

| Component | Registry id | Runtime dependency |
| --- | --- | --- |
| Aurora | `Aurora-TS-TW` | `ogl` |
| CountUp | `CountUp-TS-TW` | `motion` |
| DecryptedText | `DecryptedText-TS-TW` | `motion` |
| LogoLoop | `LogoLoop-TS-TW` | none |
| ScrollFloat | `ScrollFloat-TS-TW` | `gsap` |
| SpecularButton | `specular-button` (JS + CSS variant, ported to TS) | `ogl` |
| SpotlightCard | `SpotlightCard-TS-TW` | none |
| TextType | `TextType-TS-TW` | `gsap` |
| VariableProximity | `VariableProximity-TS-TW` | `motion` |

Notes:

- Components are copied as source (shadcn/jsrepo registry style), not installed as a
  package, and are lightly edited to fit this project's Fumadocs/Tailwind v4 theme.
- The MIT + Commons Clause license permits free and commercial use, but restricts
  selling the software itself. Lorelum's core remains Apache-2.0; these files keep
  their own license headers.
- `ScrollFloat`, `TargetCursor`, and `TextType` were vendored on **2026-09-03**
  (later than the original 2026-08-25 snapshot) and only need `gsap`, which the
  project already depends on.
- The vendored `ScrollFloat` keeps its `gsap.registerPlugin(ScrollTrigger)` call
  but moved it out of the module top level into the component's effect, so no
  GSAP plugin registration runs on the server during SSR. `TextType` dropped the
  upstream `'use client'` directive (unnecessary in this Vite/SSR project).
- `TargetCursor` was vendored as the landing's global pointer reticle (replacing a
  hand-rolled `CustomCursor`) and later **removed entirely** when the reticle proved
  unreadable on the light theme; the vendored file is gone from the tree.
- `SpecularButton` was vendored on **2026-09-07** from the JS + CSS variant and ported
  to TypeScript; it adds one local prop, `enableFx`, so the `motion-aware-*` wrapper
  can skip the WebGL canvas for touch users. Its component CSS lives in
  `apps/site/src/styles/vendor.css` (upstream class names kept verbatim).
- `ParticleText` was vendored on **2026-09-07** and **removed the same day** when the
  hero word switched to `WarpText`; the vendored file (and its site budget module)
  are gone from the tree.
- `WarpText` was vendored on **2026-09-07** (JS + CSS variant, ported to TypeScript)
  and **removed the same day**: the hero word went back to the plain CSS
  `landing-gradient-text` sweep after the shader's warped letterforms proved to be
  the wrong look for the heading. The vendored file is gone from the tree.
- `Magnet` was vendored in the original snapshot and later **removed** when the CTAs
  switched to `SpecularButton`; the vendored file is gone from the tree.
- `Aurora` (WebGL fragment shader) is the single GPU-heavy layer. It is lazy-loaded
  (`React.lazy`, separate async chunk), gated to dark theme + desktop pointer +
  dark theme only, resolution/DPR-capped, and its rAF loop pauses when
  the hero is offscreen or the tab is hidden. It pulls in the `ogl` runtime
  dependency (MIT).
- Because `Aurora` must stay in its own lazy chunk, it alone is imported directly
  from `@/vendor/react-bits/aurora`; every other vendored component is imported
  through the `@/vendor/react-bits` barrel (`src/vendor/react-bits/index.ts`)
  so a future upgrade/swap touches one place.
- Two upstream components fetched in the original snapshot (`BlurText`,
  `GradientText`) are **not vendored** — they had no consumers in this site, and
  were never checked in. Keep the vendored set to what is actually used.

## Landing particle ring — original effect, inspired by antigravity.google

- `src/components/landing/effects/antigravity.tsx` is **Lorelum's own GPU
  particle effect** (shader and host code written for this project), visually
  inspired by the particle ring on Google's Antigravity marketing site
  (antigravity.google). No code from that site is used. An earlier state of
  this file was a direct port of the site's shaders; it was rewritten
  in-place on 2026-09-08 (clean-room reimplementation of the sim and render
  passes) specifically to clear this license question. The upstream site's
  terms grant no reuse rights, which is why the port was replaced rather
  than kept.
- The only third-party code in the file is the 3D simplex-noise GLSL
  (`SNOISE`), from **webgl-noise** by Ashima Arts / Stefan Gustavson —
  <https://github.com/ashima/webgl-noise>, **MIT license**. The MIT header is
  preserved above the constant in the file.
- Runtime deps: `three`, `@react-three/fiber` (already in `package.json`).
  Mounted only on fine-pointer devices via
  `src/components/landing/motion-aware/motion-aware-antigravity.tsx`.
- `src/lib/poisson-disc.ts` (Bridson's poisson-disc sampling) is project
  code, not third-party.
- **Closed compliance item:** the earlier "upstream license not verified"
  concern applied to the direct port only and is resolved by the rewrite.

## GSAP — animation engine + ScrollTrigger/ScrollSmoother
- Package: `gsap@3.15.0` (`apps/site` dependency)
- Source: <https://gsap.com> · <https://github.com/greensock/GSAP>
- License: **GSAP Standard "no charge" license** (<https://gsap.com/standard-license/>).
  Free for commercial use; not GPL/AGPL, so it does not affect Lorelum's Apache-2.0 core.
- Used for the landing page's ScrollSmoother smooth scroll, ScrollTrigger scrub
  parallax + hero exit, SplitText word/char reveals, the custom dot+ring cursor,
  the panel scale reveal, and the terminal's GSAP sine float. Registered once in
  `apps/site/src/shared/motion/gsap-client.ts`, then consumed by Landing. The site has
  no motion-preference gating (removed with the rest of the landing's
  reduced-motion machinery on 2026-09-07).
