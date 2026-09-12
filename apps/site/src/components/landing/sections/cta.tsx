import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Star } from "lucide-react";
import { ScrollFloat } from "@/vendor/react-bits";
import { gitConfig } from "@/shared/config/git";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { GsapScaleUp } from "../motion/gsap-scale-up";
import { MotionAwareAntigravity } from "../motion-aware/motion-aware-antigravity";
import { MotionAwareSpecularButton } from "../motion-aware/motion-aware-specular-button";
import { specularCtaProps } from "./specular-cta-preset";

/**
 * CTA — the closing moment, in the spirit of antigravity.google: a full-bleed
 * glass panel with a canvas particle background (glowing particle ring that
 * eases toward the cursor) behind an oversized headline. The section spans
 * the full viewport width so the panel reads as a hero, not a centered card.
 */
export function Cta({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
  const navigate = useNavigate();

  return (
    <section className="relative w-full overflow-hidden px-4 py-28 sm:py-36">
      <GsapScaleUp fromScale={0.6}>
        <div className="relative overflow-hidden rounded-[2.5rem] border border-white/10 bg-black backdrop-blur">
          {/* Particle field on a pure-black night-sky backdrop, under the
              content (mirrors the Antigravity site, where particles render on
              the dark panel below the headline/buttons). */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-[1]">
            <MotionAwareAntigravity />
          </div>

          <div className="relative z-10 px-6 py-24 text-center sm:px-16 sm:py-28">
            <ScrollFloat
              containerClassName="mx-auto max-w-3xl text-balance font-display text-5xl font-medium tracking-tight text-white sm:text-7xl"
              textClassName="text-balance"
              animationDuration={1.1}
              ease="back.inOut(2)"
              stagger={0.03}
            >
              {t.ctaHeading}
            </ScrollFloat>
            <p className="mx-auto mt-6 max-w-lg text-balance text-base text-white/70 sm:text-lg">
              {t.ctaSub}
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-x-4 gap-y-3">
              <MotionAwareSpecularButton
                {...specularCtaProps}
                tintOpacity={0.82}
                blur={8}
                onClick={() => navigate({ to: "/$lang/docs/$", params: { lang, _splat: "" } })}
              >
                {t.ctaDocs}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </MotionAwareSpecularButton>
              <a
                href={githubUrl}
                target="_blank"
                rel="noreferrer"
                className="group inline-flex h-[3.375rem] items-center gap-2 rounded-full border border-white/25 bg-white/5 px-7 text-sm font-semibold text-white backdrop-blur transition-all duration-200 hover:-translate-y-0.5 hover:border-white/60 hover:bg-white/10 hover:shadow-[0_10px_30px_-10px_rgba(255,255,255,0.25)]"
              >
                <Star className="size-4 transition-all duration-200 group-hover:scale-110 group-hover:-rotate-12 group-hover:fill-amber-300 group-hover:text-amber-300" />
                {t.ctaGithub}
              </a>
            </div>
          </div>
        </div>
      </GsapScaleUp>
    </section>
  );
}
