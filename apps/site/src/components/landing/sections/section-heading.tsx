import { Reveal } from "../motion/reveal";
import { SplitTextReveal } from "../motion/split-text-reveal";

export function SectionHeading({
  eyebrow,
  title,
  sub,
}: {
  eyebrow?: string;
  title: string;
  sub?: string;
}) {
  return (
    <>
      {eyebrow ? (
        <Reveal className="mx-auto inline-flex items-center rounded-full border border-fd-border/60 bg-fd-card/50 px-3.5 py-1 backdrop-blur">
          <span className="landing-shimmer-text bg-gradient-to-r from-indigo-400 via-violet-400 to-cyan-400 bg-clip-text font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-transparent">
            {eyebrow}
          </span>
        </Reveal>
      ) : null}
      <h2 className="mx-auto mt-4 text-balance font-display text-4xl font-medium tracking-tight sm:text-5xl">
        <SplitTextReveal text={title} mode="auto" />
      </h2>
      {sub ? (
        <p className="mx-auto mt-5 max-w-2xl text-balance text-base leading-relaxed text-fd-muted-foreground sm:text-lg">
          <SplitTextReveal text={sub} mode="auto" />
        </p>
      ) : null}
    </>
  );
}
