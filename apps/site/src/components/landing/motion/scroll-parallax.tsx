import { useEffect, useRef, type ReactNode } from 'react';
import { gsap, registerGsapPlugins } from '@/shared/motion/gsap-client';
import { cn } from '@/shared/lib/cn';

/**
 * Scroll-linked vertical parallax wrapper, driven by a ScrollTrigger scrub.
 *
 * Translates children from `from` to `to` px as the element travels through
 * the viewport. Motion is tied to scroll progress so it stays parallax on
 * every browser (no `animation-timeline` dependency) and composes cleanly
 * with ScrollSmoother — the scrub lives on the smoother's transformed
 * content, so the element never fights the smooth wrapper. It is fully
 * disabled for touch users (element stays put) and the
 * whole tween is cleaned up on unmount, so SPA navigation can't leak.
 */
export function ScrollParallax({
  children,
  className,
  from = 24,
  to = -24,
}: {
  children: ReactNode;
  className?: string;
  from?: number;
  to?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerGsapPlugins();

    const ctx = gsap.context(() => {
      gsap.fromTo(
        el,
        { y: from },
        {
          y: to,
          ease: 'none',
          scrollTrigger: {
            trigger: el,
            start: 'top bottom',
            end: 'bottom top',
            scrub: true,
          },
        },
      );
    });

    return () => ctx.revert();
  }, [from, to]);

  return (
    <div ref={ref} className={cn('landing-parallax', className)}>
      {children}
    </div>
  );
}
