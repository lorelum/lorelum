import { ParticleField } from "./particle-field";

/**
 * Full-page background for the landing page.
 *
 * Layered, zero-layout-cost art: a slowly drifting gradient mesh, a light
 * 2D particle field and a vignette. No WebGL; the only continuous cost is
 * the tiny particle canvas, which pauses when the tab is hidden. Deliberately
 * keeps the layer stack small
 * (no full-screen noise/beam overlays) so scrolling stays compositor-cheap.
 */
export function PageBackground() {
  return (
    <>
      <div aria-hidden className="landing-bg" />
      <ParticleField />
      <div aria-hidden className="landing-vignette" />
    </>
  );
}
