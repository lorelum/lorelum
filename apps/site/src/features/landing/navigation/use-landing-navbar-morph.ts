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
 * Background and elevation follow scrolling; the compact shape follows the hero
 * or supplied masthead. Accept an element so the effect reruns when Suspense
 * mounts the article's masthead.
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

    // Hero-less pages still reveal the background and elevation when scrolled.
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
        onEnter: () => {
          panel.classList.add("landing-navbar__panel--detached");
          background.play();
        },
        onLeaveBack: () => {
          panel.classList.remove("landing-navbar__panel--detached");
          background.reverse();
        },
      });
      // Suspense can rerun the effect after the page has already crossed the trigger.
      panel.classList.toggle("landing-navbar__panel--detached", detachTrigger.progress > 0);

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
        panel.classList.remove("landing-navbar__panel--detached");
      };
    }, nav);

    return () => ctx.revert();
  }, [heroId, navRef, collapseTrigger]);
}
