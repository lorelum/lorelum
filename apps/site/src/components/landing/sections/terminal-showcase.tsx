import { TerminalDemo } from './terminal-demo';
import { getStrings } from '@/shared/i18n/legacy-translations';
import { Reveal } from '../motion/reveal';
import { GsapScaleUp } from '../motion/gsap-scale-up';

export function TerminalShowcase({ lang }: { lang: string }) {
  const t = getStrings(lang);
  return (
    <Reveal className="mt-16 w-full" y={40} scale={0.97}>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-balance font-display text-2xl font-medium tracking-tight sm:text-3xl">
          {t.terminalSectionTitle}
        </h2>
        <p className="mt-2 text-sm text-fd-muted-foreground">{t.terminalSectionSub}</p>
      </div>
      <div className="relative mx-auto mt-10 max-w-4xl overflow-x-clip">
        <GsapScaleUp fromScale={0.6}>
          <TerminalDemo locale={lang} />
        </GsapScaleUp>
      </div>
    </Reveal>
  );
}
