import { FileText, Package, Server, Zap } from 'lucide-react';
import { SpotlightCard } from '@/vendor/react-bits';
import { getStrings } from '@/shared/i18n/legacy-translations';
import { Reveal } from '../motion/reveal';
import { ScrollParallax } from '../motion/scroll-parallax';
import { SectionHeading } from './section-heading';
import { TintedIcon, type AccentTint } from './tinted-icon';

/**
 * Features — an asymmetric bento so the section has rhythm instead of a
 * uniform card wall. The two wide cards get a horizontal layout; the two
 * narrow ones stay vertical. All cards share the same spotlight hover.
 */
export function Features({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const drift = [24, 12, 16, 28]; // per-card parallax amplitude
  // Each feature carries its own accent hue so the bento isn't a purple wall.
  const tints: AccentTint[] = [
    { text: 'text-indigo-400', grad: 'from-indigo-500/20 via-violet-500/20 to-cyan-400/20' },
    { text: 'text-emerald-400', grad: 'from-emerald-500/20 via-teal-500/20 to-cyan-400/20' },
    { text: 'text-amber-400', grad: 'from-amber-500/20 via-orange-500/20 to-rose-400/20' },
    { text: 'text-cyan-400', grad: 'from-cyan-500/20 via-sky-500/20 to-indigo-400/20' },
  ];
  const items = [
    { icon: FileText, title: t.feature1Title, body: t.feature1Body, wide: true },
    { icon: Zap, title: t.feature2Title, body: t.feature2Body, wide: false },
    { icon: Server, title: t.feature3Title, body: t.feature3Body, wide: false },
    { icon: Package, title: t.feature4Title, body: t.feature4Body, wide: true },
  ];

  return (
    <section id="features" className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-24 sm:py-32">
      <SectionHeading eyebrow={t.featuresEyebrow} title={t.featuresHeading} sub={t.featuresSub} />
      <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const tint = tints[i % tints.length];
          return (
            <Reveal
              key={item.title}
              className={item.wide ? 'lg:col-span-2' : 'lg:col-span-1'}
              delay={i * 110}
            >
              <ScrollParallax from={drift[i % 4]} to={-drift[i % 4]} className="h-full">
                <SpotlightCard className="group h-full">
                <div className={item.wide ? 'flex h-full flex-col gap-5 sm:flex-row sm:items-start' : ''}>
                  <TintedIcon icon={item.icon} tint={tint} delayMs={i * 90} size="md" />
                  <div className={item.wide ? 'sm:pt-0.5' : 'mt-5'}>
                    <div className="flex items-center gap-3">
                      <span className={`font-mono text-xs font-medium tracking-[0.18em] ${tint.text}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <h3 className="font-display text-lg font-medium tracking-tight">{item.title}</h3>
                    </div>
                    <p className="mt-3 max-w-xl text-sm leading-relaxed text-fd-muted-foreground">
                      {item.body}
                    </p>
                  </div>
                </div>
                </SpotlightCard>
              </ScrollParallax>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}
