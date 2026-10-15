import type { ReactNode } from "react";
import { LandingNavbar } from "@/features/landing/navigation/landing-navbar";
import { SiteFooter } from "@/components/landing/sections/site-footer";

/** Shared site chrome around the blog scope; column layout belongs to `BlogShell`. */
interface BlogSurfaceProps {
  readonly lang: string;
  readonly children: ReactNode;
  readonly index?: boolean;
  /** Whether the shared navbar renders its language control; the blog 404 turns it off. */
  readonly withLanguageToggle?: boolean;
  /** Explicit target for the navbar's language control (see `LandingNavbar`). */
  readonly languageHref?: string;
  /** Masthead whose bottom crossing collapses the navbar; omitted on the index. */
  readonly collapseTrigger?: HTMLElement | null;
}

export function BlogSurface({
  lang,
  children,
  withLanguageToggle,
  languageHref,
  collapseTrigger,
  index = false,
}: BlogSurfaceProps) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LandingNavbar
        lang={lang}
        withLanguageToggle={withLanguageToggle}
        languageHref={languageHref}
        collapseTrigger={collapseTrigger}
      />

      <main
        className={`lorelum-ui blog-scope w-full flex-1 ${index ? "blog-scope--index pb-16 pt-16" : "px-4 pb-24 pt-24"}`}
      >
        {children}
      </main>

      <SiteFooter lang={lang} />
    </div>
  );
}
