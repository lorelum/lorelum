import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollSmoother } from 'gsap/ScrollSmoother';
import { SplitText } from 'gsap/SplitText';

/**
 * Browser-safe registration point for Lorelum-owned GSAP choreography.
 *
 * GSAP's ES modules are side-effect free at import time, so importing them
 * in a server component is safe; only the `registerPlugin` call needs a
 * browser. Keeping registration here means site-owned feature components
 * share one idempotent registration path. Vendored React Bits source remains
 * self-contained and must not import this module.
 */
let registered = false;

export function registerGsapPlugins() {
  if (registered || typeof window === 'undefined') return;
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);
  registered = true;
}

export { gsap, ScrollTrigger, ScrollSmoother, SplitText };
