import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Star } from "lucide-react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { DecryptedText } from "@/vendor/react-bits";
import { gitConfig } from "@/shared/config/git";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { HeroAurora } from "../effects/hero-aurora";
import { TerminalShowcase } from "./terminal-showcase";
import { useCanvasEffectsEnabled } from "../motion/use-canvas-effects";
import { gsap, registerGsapPlugins } from "@/shared/motion/gsap-client";
import { MotionAwareTextType } from "../motion-aware/motion-aware-text-type";
import { MotionAwareSpecularButton } from "../motion-aware/motion-aware-specular-button";
import { specularCtaProps } from "./specular-cta-preset";
import { usePauseOffscreen } from "../motion/use-viewport-anim";

/**
 * Hero — Antigravity-grade type, alive on three axes:
 *
 *  1. Load: CSS masked line rise (transform + clip-path, one-shot).
 *  2. Cursor: title and terminal move at different depths on a spring, so the
 *     hero has dimensional life.
 *  3. Scroll: the copy block exits (fade + rise) as the hero leaves while the
 *     terminal lingers slightly longer (CSS view() timeline, compositor).
 *
 * The WebGL aurora is the only glow layer on the page — deliberately. Every
 * additional bloom (hero glow, ambient orbs, terminal glow) stacked on top of
 * it read as flicker, so they were removed. The aurora is gated to
 * dark/desktop and pauses when the hero scrolls away.
 */
export function Hero({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
  const navigate = useNavigate();
  const sectionRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  // Reactive fine-pointer gate (hydration-gated, follows `(pointer: fine)`
  // changes) — the canonical capability check, see AGENTS.md "Where things go".
  const pointerEffectsEnabled = useCanvasEffectsEnabled();

  // Pause the gradient-text sweep (and any other CSS animation) once the hero
  // scrolls away, so it stops repainting off-screen. ScrollTrigger — the
  // page's canonical viewport gate (see use-viewport-anim).
  usePauseOffscreen({ ref: sectionRef, selector: ".landing-gradient-text" });

  // Hero scroll exit — fades + lifts the copy as the section leaves. The
  // terminal below is NOT faded here: it is an opaque "real terminal" that
  // owns its own scroll animation (GsapScaleUp in TerminalShowcase), and any
  // hero-side opacity scrub makes the page background bleed through as fog.
  useEffect(() => {
    const section = sectionRef.current;
    const copy = copyRef.current;
    if (!section || !copy) return;
    registerGsapPlugins();

    const ctx = gsap.context(() => {
      const copyEnd = () => section.offsetHeight * 0.55;

      gsap.fromTo(
        copy,
        { opacity: 1, y: 0 },
        {
          opacity: 0,
          y: -46,
          ease: "none",
          scrollTrigger: {
            trigger: section,
            start: "top top",
            end: copyEnd,
            scrub: true,
          },
        },
      );
    });

    return () => ctx.revert();
  }, []);

  // Cursor parallax — normalized pointer (-1..1) eased by springs. Title only;
  // the terminal stays fixed so it reads as a real, stationary window.
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const smx = useSpring(mx, { stiffness: 60, damping: 18, mass: 0.8 });
  const smy = useSpring(my, { stiffness: 60, damping: 18, mass: 0.8 });
  const titleX = useTransform(smx, (v) => v * -14);
  const titleY = useTransform(smy, (v) => v * -9);

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerEffectsEnabled) return;
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    mx.set(((e.clientX - rect.left) / rect.width - 0.5) * 2);
    my.set(((e.clientY - rect.top) / rect.height - 0.5) * 2);
  };
  const onPointerLeave = () => {
    mx.set(0);
    my.set(0);
  };

  return (
    <section
      id="landing-hero"
      ref={sectionRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className="relative isolate w-full overflow-x-clip"
    >
      <HeroAurora />

      <div className="relative mx-auto flex min-h-[100svh] w-full max-w-6xl flex-col items-center justify-center px-4 pb-24 pt-16 text-center sm:pt-20">
        <div ref={copyRef} className="landing-hero-scroll flex w-full flex-col items-center">
          <span className="landing-hero-item inline-flex items-center gap-2 rounded-full border border-fd-border/60 bg-fd-card/50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-fd-muted-foreground backdrop-blur">
            <span className="landing-badge-dot size-1.5 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
            <DecryptedText
              text={t.heroBadge}
              animateOn="inViewHover"
              revealDirection="start"
              sequential={false}
              speed={30}
              maxIterations={8}
              encryptedClassName="landing-decrypt-scrambled"
              useOriginalCharsOnly
            />
          </span>

          <motion.div className="w-full" style={{ x: titleX, y: titleY }}>
            <h1 className="landing-hero-title mx-auto mt-8 max-w-5xl text-balance font-display text-[clamp(3rem,8.5vw,7.25rem)] font-medium leading-[1.0] tracking-[-0.035em]">
              <span className="landing-line block" style={{ animationDelay: "0.05s" }}>
                {t.heroTitleBefore}
                <span className="landing-gradient-text">{t.heroTitleGradient}</span>
                {t.heroTitleComma}
              </span>
              <span className="landing-line block" style={{ animationDelay: "0.18s" }}>
                {t.heroTitleAfter}
              </span>
            </h1>
          </motion.div>

          <p className="landing-hero-sub mx-auto mt-7 max-w-2xl text-balance text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
            {t.heroSub}
          </p>

          {/* Typewriter subline — short phrases that loop after the hero loads.
              `min-h` reserves one line so the CTA buttons below don't jump as
              the text types/erases. Wrapper keeps it SSR-safe. */}
          <div className="landing-hero-item mt-4 min-h-6" style={{ animationDelay: "0.26s" }}>
            <MotionAwareTextType
              text={t.heroTypewriter}
              className="font-mono text-sm tracking-wide text-fd-muted-foreground/90 sm:text-[15px]"
              cursorClassName="text-fd-primary"
              scrollContainerRef={sectionRef}
            />
          </div>

          <div
            className="landing-hero-item mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-3"
            style={{ animationDelay: "0.32s" }}
          >
            <MotionAwareSpecularButton
              {...specularCtaProps}
              tintOpacity={0.88}
              onClick={() => navigate({ to: "/$lang/docs/$", params: { lang, _splat: "" } })}
            >
              {t.ctaDocs}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </MotionAwareSpecularButton>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex h-[3.375rem] items-center gap-2 rounded-full border border-fd-border bg-fd-card/60 px-7 text-sm font-semibold text-fd-foreground shadow-sm backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-fd-primary/50 hover:bg-fd-accent/15 hover:shadow-[0_10px_30px_-10px_rgba(0,0,0,0.35)]"
            >
              <Star className="size-4 transition-all duration-200 group-hover:scale-110 group-hover:-rotate-12 group-hover:fill-amber-400 group-hover:text-amber-400" />
              {t.ctaGithub}
            </a>
          </div>

          <p
            className="landing-hero-item mt-5 text-xs tracking-wide text-fd-muted-foreground/70"
            style={{ animationDelay: "0.42s" }}
          >
            {t.heroTrust}
          </p>
        </div>

        <div className="w-full">
          <TerminalShowcase lang={lang} />
        </div>
      </div>
    </section>
  );
}
