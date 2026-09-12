import { Cta } from "./sections/cta";
import { Ecosystem } from "./sections/ecosystem";
import { Faq } from "./sections/faq";
import { Features } from "./sections/features";
import { Hero } from "./sections/hero";
import { Problem } from "./sections/problem";
import { SiteFooter } from "./sections/site-footer";
import { Stats } from "./sections/stats";

/**
 * Full landing page composition. `lang` drives every string via the shared
 * translations dictionary. The smooth-scroll + fixed nav live on the outer
 * `LandingShell`; this component owns only the narrated sections, so it is
 * usable inside any layout.
 */
export function LandingPage({ lang }: { lang: string }) {
  return (
    <div className="relative flex flex-1 flex-col">
      <Hero lang={lang} />
      <Problem lang={lang} />
      <Features lang={lang} />
      <Stats lang={lang} />
      <Ecosystem lang={lang} />
      <Faq lang={lang} />
      <Cta lang={lang} />
      <SiteFooter lang={lang} />
    </div>
  );
}
