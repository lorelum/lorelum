import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/shared/lib/cn';

/**
 * Scroll-in reveal wrapper.
 *
 * IntersectionObserver-driven (works in every browser, unlike CSS
 * `animation-timeline: view()`), one-shot and cheap: the observer fires once
 * when the element enters the viewport, then disconnects. No per-frame JS.
 *
 * SSR-safe: content renders visible in the initial HTML (no flash for
 * above-the-fold content, no invisible content if JS is disabled). After
 * hydration, elements already on screen stay visible; elements below the
 * fold hide and animate in when scrolled to.
 *
 * `delay` staggers siblings (cards in a grid), so the reveal cascades
 * instead of everything arriving at once.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 28,
  scale = 0.98,
}: {
  children: ReactNode;
  className?: string;
  /** Transition delay in ms — use i * 90 for card cascades. */
  delay?: number;
  /** Travel distance in px. */
  y?: number;
  /** Starting scale (1 = none). */
  scale?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // SSR + first paint: visible. The effect decides whether to hide + reveal.
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Already on screen after hydration: keep it visible, no reveal.
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) {
      setVisible(true);
      return;
    }
    setVisible(false);
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style = {
    '--reveal-y': `${y}px`,
    '--reveal-scale': String(scale),
    transitionDelay: `${delay}ms`,
  } as React.CSSProperties;

  return (
    <div
      ref={ref}
      className={cn('landing-reveal', visible && 'is-visible', className)}
      style={style}
    >
      {children}
    </div>
  );
}
