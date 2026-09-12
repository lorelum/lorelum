import { useLayoutEffect, type ReactNode } from "react";
import { registerGsapPlugins, ScrollSmoother } from "@/shared/motion/gsap-client";

export const SMOOTH_WRAPPER_ID = "smooth-wrapper";
export const SMOOTH_CONTENT_ID = "smooth-content";

/**
 * ScrollSmoother for the landing page, replacing Lenis.
 *
 * Mirrors Antigravity's setup — `smooth: 0.6`, `effects: true`,
 * `smoothTouch: 0.1`, and a `normalizeScroll` that tolerates the nested
 * terminal demo scroller.
 *
 * The `#smooth-wrapper`/`#smooth-content` ids are rendered by `LandingShell`.
 * Created in a layout effect so child
 * `useEffect`-driven ScrollTriggers always mount after it exists.
 */
export function SmoothScroll({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    registerGsapPlugins();

    const wrapper = document.getElementById(SMOOTH_WRAPPER_ID);
    const content = document.getElementById(SMOOTH_CONTENT_ID);
    if (!wrapper || !content) return;

    const smoother = ScrollSmoother.create({
      wrapper: `#${SMOOTH_WRAPPER_ID}`,
      content: `#${SMOOTH_CONTENT_ID}`,
      smooth: 0.6,
      effects: true,
      smoothTouch: 0.1,
      normalizeScroll: { allowNestedScroll: true },
    });

    return () => smoother.kill();
  }, []);

  return <>{children}</>;
}
