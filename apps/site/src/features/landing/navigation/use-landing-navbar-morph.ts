import { useEffect, type RefObject } from "react";
import { gsap, registerGsapPlugins, ScrollTrigger } from "@/shared/motion/gsap-client";

const backgroundDuration = 0.48;
const morphDuration = 0.72;
const desktopBreakpoint = 1024;
const compactMaxWidth = 896;
const mobileHorizontalMargin = 8;

function getCompactWidth() {
  const viewportWidth = window.innerWidth;
  if (viewportWidth < desktopBreakpoint) {
    return viewportWidth - mobileHorizontalMargin * 2;
  }

  return Math.min(viewportWidth * 0.5, compactMaxWidth);
}

/**
 * Keep background attachment and shape transitions independent.
 *
 * `collapseTrigger` is for surfaces that have no hero: the landing page measures
 * the hero's bottom edge, and every other route used to get no morph at all
 * (the trigger was simply not created, so the navbar stayed full width however
 * far the reader scrolled). A surface that passes an element gets the same
 * compact state, entered when that element's bottom passes the navbar — the
 * article passes its masthead. Surfaces that pass nothing are unchanged.
 *
 * It takes the element, not a ref: the article's masthead arrives with the
 * suspended body, after the navbar's own effect has already run, so a ref read
 * once at mount would be `null` and the morph would never be created (measured:
 * the panel stayed 1425px and square however far the page scrolled). Passing the
 * element makes the effect re-run when it appears.
 */
export function useLandingNavbarMorph(
  navRef: RefObject<HTMLElement | null>,
  heroId: string,
  collapseTrigger?: HTMLElement | null,
) {
  useEffect(() => {
    const nav = navRef.current;
    const panel = nav?.querySelector<HTMLElement>(".landing-navbar__panel");
    const surface = nav?.querySelector<HTMLElement>(".landing-navbar__surface");
    if (!nav || !panel || !surface) return;

    // The hero is optional: every non-landing route renders this navbar without
    // one. It used to be part of the guard above, so on those routes the whole
    // effect returned early and the surface timeline was never created — the
    // navbar stayed at its initial opacity however far the reader scrolled
    // (measured: opacity 0 at the top and after 600px on the blog index, the
    // legacy /blog path and the article, against 0 → 1 on the landing page).
    const hero = document.getElementById(heroId);

    registerGsapPlugins();

    const ctx = gsap.context(() => {
      const background = gsap.timeline({
        paused: true,
        defaults: {
          duration: backgroundDuration,
          ease: "power2.inOut",
        },
      });
      background.to(surface, { opacity: 1 });

      let morph: gsap.core.Timeline | undefined;
      const runMorph = (compact: boolean) => {
        morph?.kill();
        morph = gsap.timeline({
          defaults: {
            duration: morphDuration,
            ease: "power2.out",
          },
        });

        morph.to(
          panel,
          compact
            ? {
                marginTop: "0.75rem",
                width: getCompactWidth,
                borderRadius: "999px",
              }
            : {
                marginTop: 0,
                width: "100%",
                borderRadius: 0,
              },
          0,
        );
      };

      const detachTrigger = ScrollTrigger.create({
        start: 1,
        end: 1,
        onEnter: () => background.play(),
        onLeaveBack: () => background.reverse(),
      });

      // The morph needs something to measure: the hero on the landing page, or
      // whatever a hero-less surface hands over. Without either, the surface
      // keeps the full-width navbar, which is what the docs surface wants.
      const measured = hero ?? collapseTrigger ?? null;
      const scrollTrigger =
        measured === null
          ? undefined
          : ScrollTrigger.create({
              trigger: measured,
              start: "bottom top+=56",
              onEnter: () => runMorph(true),
              onLeaveBack: () => runMorph(false),
            });

      return () => {
        detachTrigger.kill();
        scrollTrigger?.kill();
        background.kill();
        morph?.kill();
      };
    }, nav);

    return () => ctx.revert();
  }, [heroId, navRef, collapseTrigger]);
}
