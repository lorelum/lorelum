import { ChevronDown } from "lucide-react";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { Reveal } from "../motion/reveal";
import { SectionHeading } from "./section-heading";

export function Faq({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const faqs = [
    { q: t.faq1q, a: t.faq1a },
    { q: t.faq2q, a: t.faq2a },
    { q: t.faq3q, a: t.faq3a },
    { q: t.faq4q, a: t.faq4a },
  ];

  return (
    <section className="relative mx-auto w-full max-w-3xl px-4 py-24 sm:py-32">
      <SectionHeading eyebrow={t.faqEyebrow} title={t.faqHeading} />
      <div className="mt-12 text-left">
        {faqs.map((faq, i) => (
          <Reveal key={faq.q} delay={i * 80}>
            <details className="group border-b border-fd-border/60 py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-medium tracking-tight [&::-webkit-details-marker]:hidden">
                {faq.q}
                <ChevronDown className="size-5 shrink-0 text-fd-muted-foreground transition-transform duration-300 group-open:rotate-180" />
              </summary>
              <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-300 ease-out group-open:grid-rows-[1fr]">
                <div className="overflow-hidden">
                  <p className="pt-3 text-sm leading-relaxed text-fd-muted-foreground">{faq.a}</p>
                </div>
              </div>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
