import { Archive, EyeOff, ShieldAlert } from "lucide-react";
import { SpotlightCard } from "@/vendor/react-bits";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { Reveal } from "../motion/reveal";
import { ScrollParallax } from "../motion/scroll-parallax";
import { SectionHeading } from "./section-heading";
import { TintedIcon, type AccentTint } from "./tinted-icon";

/**
 * Problem — three restrained spotlight cards. Number + icon up top, a strong
 * title, one body paragraph. The cards stay visually light (translucent
 * surface, hairline border) so the section reads like Antigravity: content
 * floating on the background, not heavy boxes.
 */
export function Problem({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const drift = [26, 12, 20]; // per-column parallax amplitude
  // Problem reads as warning, so the accent tube runs warm (amber/rose/orange).
  const tints: AccentTint[] = [
    { text: "text-amber-400", grad: "from-amber-500/15 via-orange-500/15 to-rose-400/15" },
    { text: "text-rose-400", grad: "from-rose-500/15 via-red-500/15 to-orange-400/15" },
    { text: "text-orange-400", grad: "from-orange-500/15 via-amber-400/15 to-yellow-400/15" },
  ];
  const items = [
    { icon: ShieldAlert, title: t.problem1Title, body: t.problem1Body },
    { icon: Archive, title: t.problem2Title, body: t.problem2Body },
    { icon: EyeOff, title: t.problem3Title, body: t.problem3Body },
  ];

  return (
    <section className="relative mx-auto w-full max-w-6xl px-4 py-24 sm:py-32">
      <SectionHeading eyebrow={t.problemEyebrow} title={t.problemHeading} sub={t.problemSub} />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {items.map((item, i) => {
          const tint = tints[i % tints.length];
          return (
            <Reveal key={item.title} className="h-full" delay={i * 100}>
              <ScrollParallax from={drift[i]} to={-drift[i]} className="h-full">
                <SpotlightCard className="group h-full bg-fd-card/40">
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-mono text-sm font-medium tracking-[0.18em] ${tint.text}`}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <TintedIcon icon={item.icon} tint={tint} delayMs={i * 100} size="sm" />
                  </div>
                  <h3 className="mt-6 font-display text-xl font-medium tracking-tight">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                    {item.body}
                  </p>
                </SpotlightCard>
              </ScrollParallax>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
