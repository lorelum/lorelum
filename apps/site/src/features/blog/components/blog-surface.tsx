import type { ReactNode } from "react";
import { LandingNavbar } from "@/features/landing/navigation/landing-navbar";
import { SiteFooter } from "@/components/landing/sections/site-footer";

/**
 * Layout shell for a blog screen: the site's chrome around a reading scope.
 *
 * The navbar and footer are the site's and stay outside `.blog-scope`, so the
 * blog cannot restyle shared chrome and shared chrome cannot disagree between
 * blog routes.
 *
 * The scope's stylesheet is imported by the screens rather than here: both
 * screens already load `styles/blog.css` for their own scoped rules, and the
 * bundle is deduplicated, so keeping the import at the screen keeps one
 * obvious place where a screen declares the surface it renders.
 */

const READING_MEASURE = "max-w-[var(--lore-reading-width)]";

interface BlogSurfaceProps {
  readonly lang: string;
  readonly children: ReactNode;
  /**
   * Width of the reading column. Defaults to the production reading measure;
   * the article passes its own so the column can sit beside the TOC rail.
   */
  readonly mainClassName?: string;
}

export function BlogSurface({ lang, children, mainClassName }: BlogSurfaceProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LandingNavbar lang={lang} />

      <main
        className={`lorelum-ui blog-scope mx-auto w-full flex-1 px-4 pb-24 pt-24 ${
          mainClassName ?? READING_MEASURE
        }`}
      >
        {children}
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
