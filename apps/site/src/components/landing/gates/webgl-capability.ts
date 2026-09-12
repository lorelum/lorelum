/**
 * WebGL hardware-acceleration detection for the landing page.
 *
 * Some environments cannot hand the browser a GPU at all — remote desktops,
 * VMs, disabled/driverless adapters — and Edge/Chrome then falls back to a
 * software rasterizer. The GPU name reported for those backends is exactly
 * what Windows/ANGLE expose:
 *
 *   - "Microsoft Basic Render Driver"  (Windows software fallback / WARP)
 *   - "Google SwiftShader" / "SwiftShader"  (Chrome's software GL)
 *   - "llvmpipe" (Mesa software rasterizer)
 *
 * A full-screen WebGL aurora is the single most expensive layer on the landing
 * page, and under software rendering its cost scales brutally with viewport
 * area (a maximized window at 60Hz can drop to ~30fps, while CSS-only layers
 * stay smooth). So the hero drops the WebGL aurora when the renderer is
 * software and keeps the CSS gradient mesh + orbs — visually near-identical on
 * the affected machines, full effect preserved everywhere else.
 *
 * The classifier is a pure function (unit tested); the client-side probe that
 * feeds it is in `webgl-renderer.ts` (browser-only, rAF-free, called once).
 */

/** Renderer strings known to be pure software rasterizers (case-insensitive
 *  substring match on the unmasked GL_RENDERER string). */
const SOFTWARE_RENDERER_MARKERS = [
  "microsoft basic render driver",
  "swiftshader",
  "llvmpipe",
  "softpipe",
  "software",
];

/** True when `renderer` names a software (CPU) GL implementation. */
export function isSoftwareRenderer(renderer: string): boolean {
  const lowered = renderer.toLowerCase();
  return SOFTWARE_RENDERER_MARKERS.some((marker) => lowered.includes(marker));
}
