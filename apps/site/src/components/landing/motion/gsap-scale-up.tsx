import { useEffect, useRef, type ReactNode } from "react";
import { gsap, registerGsapPlugins } from "@/shared/motion/gsap-client";
import { cn } from "@/shared/lib/cn";

/**
 * Antigravity-style scroll-scrubbed scale-up.
 *
 * The element starts at `fromScale` and grows to its natural size as it
 * scrolls from "top hits the viewport bottom" to "top hits the viewport
 * center", with `scrub: 1` so the scale follows the scroll position with a
 * short catch-up. This mirrors antigravity.google's landing video section:
 *
 *   gsap.from(section, { scrollTrigger: { start: 'top bottom', end: 'top center', scrub: 1 }, scale: 0.5, ease: 'power2.out' })
 *
 * The tween registers unconditionally for all visitors.
 */
export function GsapScaleUp({
  children,
  className,
  fromScale = 0.5,
}: {
  children: ReactNode;
  className?: string;
  /** Scale at the moment the element's top enters the viewport bottom. */
  fromScale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerGsapPlugins();

    const ctx = gsap.context(() => {
      gsap.from(el, {
        scrollTrigger: {
          trigger: el,
          start: "top bottom",
          end: "top center",
          scrub: 1,
        },
        scale: fromScale,
        ease: "power2.out",
      });
    });

    return () => ctx.revert();
  }, [fromScale]);

  return (
    <div ref={ref} className={cn("will-change-transform", className)}>
      {children}
    </div>
  );
}
