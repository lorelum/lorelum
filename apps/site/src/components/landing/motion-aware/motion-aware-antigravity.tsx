import Antigravity from "../effects/antigravity";
import { useCanvasEffectsEnabled } from "../motion/use-canvas-effects";

/**
 * Motion-aware gate for the particle ring on the CTA card — Lorelum's own
 * GPU particle effect (see `../effects/antigravity.tsx`), visually inspired
 * by the one on antigravity.google.
 *
 * The ring runs a GPU ping-pong sim on a WebGL `<Canvas>` (three +
 * @react-three/fiber), which is heavy, so it only runs on fine-pointer
 * devices. On the server or on touch we render nothing, so no WebGL context
 * is created and nothing animates.
 *
 * The values below are the tuned look for the dark CTA panel (colors
 * #7189ff / #3074f9 / #05060f live in the component itself).
 */
export function MotionAwareAntigravity() {
  const enabled = useCanvasEffectsEnabled();

  if (!enabled) {
    return null;
  }

  return (
    <Antigravity
      density={220}
      pointScale={0.65}
      bandWidth={0.16}
      coreWidth={0.055}
      pullStrength={0.24}
    />
  );
}
