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
 * Keep background attachment and hero shape transitions independent.
 */
export function useLandingNavbarMorph(navRef: RefObject<HTMLElement | null>, heroId: string) {
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

      // The morph is the part that needs a hero to measure, so it is the only
      // thing skipped when there is none.
      const scrollTrigger =
        hero === null
          ? undefined
          : ScrollTrigger.create({
              trigger: hero,
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
  }, [heroId, navRef]);
}
