/*
 * Vendored from React Bits (https://reactbits.dev) — ScrollFloat
 * (TypeScript + Tailwind variant).
 * Source: https://reactbits.dev/r/ScrollFloat-TS-TW
 * License: MIT + Commons Clause (see https://reactbits.dev/LICENSE.md).
 * See apps/site/THIRD_PARTY_NOTICE.md.
 *
 * Adapted for Lorelum:
 *   - Keeps the bare `gsap`/`ScrollTrigger` import but moves the
 *     `registerPlugin(ScrollTrigger)` call out of the module top level into
 *     the effect. GSAP's ES modules are side-effect free at import, and the
 *     top-level call would run on the server during SSR (no `window` yet);
 *     registering inside the client-only effect is SSR-safe and idempotent
 *     (shared `gsap` singleton).
 *   - Reduced-motion / ScrollSmoother behavior follows the same pattern as
 *     the rest of the landing: callers gate the component (see the
 *     `motion-aware-*` wrappers) rather than the vendored file doing it.
 */
import React, { useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

interface ScrollFloatProps {
  children: ReactNode;
  scrollContainerRef?: RefObject<HTMLElement>;
  containerClassName?: string;
  textClassName?: string;
  animationDuration?: number;
  ease?: string;
  scrollStart?: string;
  scrollEnd?: string;
  stagger?: number;
}

const ScrollFloat: React.FC<ScrollFloatProps> = ({
  children,
  scrollContainerRef,
  containerClassName = "",
  textClassName = "",
  animationDuration = 1,
  ease = "back.inOut(2)",
  scrollStart = "center bottom+=50%",
  scrollEnd = "bottom bottom-=40%",
  stagger = 0.03,
}) => {
  const containerRef = useRef<HTMLHeadingElement>(null);

  const splitText = useMemo(() => {
    const text = typeof children === "string" ? children : "";
    // Split by words (not chars) and keep each word in a `whitespace-nowrap`
    // span so a narrow container can never break a word mid-glyph (the old
    // per-char split broke "rules" into "rul"+"es" on a constrained CTA
    // heading). Words still flow onto new lines at spaces, so the heading
    // wraps naturally; the per-word reveal is visually close to the per-char
    // version and far more robust.
    const words = text.split(" ");
    return words.map((word, index) => (
      <span key={index}>
        {index > 0 ? <span className="inline-block">&nbsp;</span> : null}
        <span className="inline-block whitespace-nowrap">{word}</span>
      </span>
    ));
  }, [children]);

  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger);
    const el = containerRef.current;
    if (!el) return;

    const scroller =
      scrollContainerRef && scrollContainerRef.current ? scrollContainerRef.current : window;

    const charElements = el.querySelectorAll(".inline-block");

    gsap.fromTo(
      charElements,
      {
        willChange: "opacity, transform",
        opacity: 0,
        yPercent: 120,
        scaleY: 2.3,
        scaleX: 0.7,
        transformOrigin: "50% 0%",
      },
      {
        duration: animationDuration,
        ease: ease,
        opacity: 1,
        yPercent: 0,
        scaleY: 1,
        scaleX: 1,
        stagger: stagger,
        scrollTrigger: {
          trigger: el,
          scroller,
          start: scrollStart,
          end: scrollEnd,
          scrub: true,
        },
      },
    );
  }, [scrollContainerRef, animationDuration, ease, scrollStart, scrollEnd, stagger]);

  return (
    <h2 ref={containerRef} className={`my-5 overflow-hidden ${containerClassName}`}>
      <span className={`inline-block text-[clamp(1.6rem,4vw,3rem)] leading-[1.5] ${textClassName}`}>
        {splitText}
      </span>
    </h2>
  );
};

export default ScrollFloat;
