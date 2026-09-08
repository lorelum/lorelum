import { LogoLoop, type LogoItem } from '@/components/react-bits';
import { getStrings } from '@/lib/translations';
import { Reveal } from '../motion/reveal';
import { SectionHeading } from './section-heading';

/**
 * Brand logos, served locally from /public/logos (downloaded once at build
 * time — no runtime CDN). Monochrome set: Simple Icons rasterized at
 * #1e293b, favicons for brands without an official SI entry; `landing.css`
 * inverts them under `html.dark` so the wall reads on both themes.
 *
 * Rule files (AGENTS.md / CLAUDE.md / .cursorrules) use the markdown/owner
 * brand; agent tools get their own brand mark plus an outbound link, mirroring
 * the upstream LogoLoop logo-wall usage. Bitmap logos (Codex, Continue) are
 * cropped to the mark with their backgrounds made transparent and follow the
 * theme inversion like the vector marks; Aider's wordmark keeps its brand
 * green via `logo-keep-color` (inverting green would turn it pink).
 *
 * Layout: each entry is a stacked tile (logo above, name below) at a fixed
 * tile width so one sequence spans ~one viewport — a screenshot captures the
 * whole set once instead of two squished half-copies of it.
 */
const BRAND_LOGOS: Array<{ name: string; src: string; href?: string; wide?: boolean }> = [
  { name: 'AGENTS.md', src: '/logos/agentsmd.ico', href: 'https://agents.md' },
  { name: 'CLAUDE.md', src: '/logos/markdown.svg' },
  { name: '.cursorrules', src: '/logos/markdown.svg' },
  { name: 'Cursor', src: '/logos/cursor.svg', href: 'https://cursor.com' },
  { name: 'Claude Code', src: '/logos/claude.svg', href: 'https://claude.com/product/claude-code' },
  { name: 'Codex', src: '/logos/codex.png', href: 'https://openai.com/codex/' },
  { name: 'Continue', src: '/logos/continue.png', href: 'https://continue.dev' },
  { name: 'Aider', src: '/logos/aider.svg', href: 'https://aider.chat', wide: true },
];

export function Ecosystem({ lang }: { lang: string }) {
  const t = getStrings(lang);

  const logos: LogoItem[] = BRAND_LOGOS.map(({ name, src, href, wide }) => ({
    node: (
      <span className="flex w-32 flex-col items-center gap-2.5">
        <img
          src={src}
          alt=""
          width={48}
          height={48}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={wide ? 'logo-keep-color h-12 w-auto max-w-full object-contain' : 'size-12 object-contain'}
        />
        <span className="font-mono text-sm text-fd-muted-foreground">{name}</span>
      </span>
    ),
    title: name,
    ariaLabel: name,
    ...(href && { href }),
  }));

  return (
    <section id="ecosystem" className="relative mx-auto w-full max-w-6xl scroll-mt-24 px-4 py-24 sm:py-32">
      <SectionHeading eyebrow={t.ecosystemEyebrow} title={t.ecosystemHeading} sub={t.ecosystemSub} />
      <Reveal className="mt-14">
        <LogoLoop
          className="logo-wall"
          logos={logos}
          speed={24}
          gap={40}
          pauseOnHover
          fadeOut
          fadeOutColor="var(--color-fd-background)"
          ariaLabel={t.ecosystemHeading}
        />
      </Reveal>
    </section>
  );
}
