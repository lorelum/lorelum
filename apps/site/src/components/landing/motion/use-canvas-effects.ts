import { useEffect, useState } from "react";
import { shouldEnableCanvasEffects } from "../gates/motion-gate";

/**
 * Reactive "are cursor-driven effects enabled?" flag, wrapping the pure
 * `shouldEnableCanvasEffects` policy.
 *
 * Defaults to `false` (plain fallback) until hydration confirms a fine
 * pointer, and stays reactive to `(pointer: fine)` changes at runtime.
 */
export function useCanvasEffectsEnabled() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const fine = window.matchMedia("(pointer: fine)");
    const update = () => setEnabled(shouldEnableCanvasEffects({ finePointer: fine.matches }));
    update();
    fine.addEventListener("change", update);
    return () => fine.removeEventListener("change", update);
  }, []);

  return enabled;
}
