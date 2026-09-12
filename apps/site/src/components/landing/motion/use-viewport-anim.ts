import { useEffect, type RefObject } from 'react';
import { gsap, registerGsapPlugins, ScrollTrigger } from '@/shared/motion/gsap-client';

interface Target {
  ref: RefObject<HTMLElement | null>;
  /** Match elements inside `ref` instead of the element itself. */
  selector?: string;
}

/**
 * Pause CSS animations while the target is outside the viewport.
 *
 * This is the landing's canonical viewport gate: ScrollTrigger inside a
 * `gsap.context` (same pattern as every other viewport gate on the page, so
 * the smoother's scroller and refresh timing are handled). IntersectionObserver
 * does fire under the current ScrollSmoother setup (verified with the fps
 * probe's `io` line), but ScrollTrigger stays the one idiom for viewport gates
 * — see AGENTS.md hard rule 3. When the tracked element leaves the viewport it
 * gets `.is-offscreen` (`animation-play-state: paused`) and the class is
 * removed on return.
 *
 * Two forms:
 *   usePauseOffscreen({ ref })                  // the element itself
 *   usePauseOffscreen({ ref, selector: '.x' })  // matches inside the element
 *
 * Wire CSS like:
 *   .foo { animation: ... infinite; }
 *   .foo.is-offscreen { animation-play-state: paused; }
 *
 * The trigger is created unconditionally.
 */
export function usePauseOffscreen(target: Target, className = 'is-offscreen') {
  const { ref, selector } = target;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerGsapPlugins();

    const apply = (offscreen: boolean) => {
      const targets = selector ? Array.from(el.querySelectorAll<HTMLElement>(selector)) : [el];
      for (const t of targets) t.classList.toggle(className, offscreen);
    };

    const ctx = gsap.context(() => {
      const trigger = ScrollTrigger.create({
        trigger: el,
        start: 'top bottom',
        end: 'bottom top',
        onToggle: (self) => apply(!self.isActive),
      });
      return () => trigger.kill();
    });

    return () => {
      apply(false);
      ctx.revert();
    };
  }, [ref, selector, className]);
}
