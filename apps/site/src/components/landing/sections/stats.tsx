import { useRef } from 'react';
import { CountUp } from '@/vendor/react-bits';
import { getStrings, type LandingStrings } from '@/shared/i18n/legacy-translations';
import { Reveal } from '../motion/reveal';
import { SectionHeading } from './section-heading';
import { usePauseOffscreen } from '../motion/use-viewport-anim';

const STATS: Array<{
  value: number;
  suffix: string;
  labelKey: keyof LandingStrings;
}> = [
  { value: 1, suffix: '', labelKey: 'stats1Label' },
  { value: 2, suffix: '', labelKey: 'stats2Label' },
  { value: 100, suffix: '%', labelKey: 'stats3Label' },
];

export function Stats({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const sectionRef = useRef<HTMLElement>(null);
  // Pause the gradient-number sweep once this section scrolls out of view.
  usePauseOffscreen({ ref: sectionRef, selector: '.landing-gradient-text' });

  return (
    <section ref={sectionRef} className="relative mx-auto w-full max-w-6xl px-4 py-24 sm:py-32">
      <SectionHeading eyebrow={t.statsEyebrow} title={t.statsHeading} />
      <div className="mt-16 grid gap-12 sm:grid-cols-3">
        {STATS.map((stat, i) => (
          <Reveal key={stat.labelKey} className="text-center" delay={i * 120}>
            <div className="landing-gradient-text font-mono text-6xl font-medium tracking-tight tabular-nums sm:text-7xl">
              <CountUp to={stat.value} duration={1.8} />
              {stat.suffix}
            </div>
            <p className="mt-3 text-sm text-fd-muted-foreground">{t[stat.labelKey]}</p>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
