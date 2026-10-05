import type { ReactNode } from "react";
import { LandingNavbar } from "@/features/landing/navigation/landing-navbar";
import { SiteFooter } from "@/components/landing/sections/site-footer";

/**
 * The site's chrome around a blog surface.
 *
 * The navbar and footer are the site's and stay outside `.blog-scope`, so the
 * blog cannot restyle shared chrome and shared chrome cannot disagree between
 * blog routes.
 *
 * This is deliberately *not* where the columns live: what sits beside the
 * reading column is the screen's business (`BlogShell`), and this element only
 * spans the surface. It used to carry a reading-measure max-width, which made
 * every blog screen a centred island — at 1920px the index used 664px of a
 * 1905px viewport and the article's rail sat 481px from the right edge.
 *
 * The scope's stylesheet is imported by the screens rather than here: both
 * screens already load `styles/blog.css` for their own scoped rules, and the
 * bundle is deduplicated, so keeping the import at the screen keeps one
 * obvious place where a screen declares the surface it renders.
 */
interface BlogSurfaceProps {
  readonly lang: string;
  readonly children: ReactNode;
  readonly index?: boolean;
  /**
   * Whether the shared navbar renders its language control. The article turns
   * it off: the post's own translation entry is the accurate one.
   */
  readonly withLanguageToggle?: boolean;
  /**
   * Element whose bottom crossing puts the shared navbar into its compact
   * state. Blog screens pass the article's masthead so the navbar behaves on
   * scroll the way it does on the landing page, where the hero plays that role;
   * the docs surface passes nothing and keeps the full-width navbar.
   */
  readonly collapseTrigger?: HTMLElement | null;
}

export function BlogSurface({
  lang,
  children,
  withLanguageToggle,
  collapseTrigger,
  index = false,
}: BlogSurfaceProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LandingNavbar
        lang={lang}
        withLanguageToggle={withLanguageToggle}
        collapseTrigger={collapseTrigger}
      />

      <main className={`lorelum-ui blog-scope w-full flex-1 ${index ? "blog-scope--index pb-16 pt-16" : "px-4 pb-24 pt-24"}`}>{children}</main>

      <SiteFooter lang={lang} />
    </div>
  );
}
