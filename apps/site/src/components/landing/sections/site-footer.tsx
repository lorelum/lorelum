import { Link, useLocation } from "@tanstack/react-router";
import { BrandLockup } from "@/shared/ui/brand-lockup";
import { gitConfig } from "@/shared/config/git";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import {
  destinationPath,
  isCurrentDestination,
} from "@/features/landing/navigation/navigation-destination";

export function SiteFooter({ lang }: { lang: string }) {
  const t = getStrings(lang);
  const { pathname } = useLocation();
  // One destination, one answer: the footer is a navigation landmark, so the
  // blog entry states where the reader is the same way the header does, rather
  // than depending on which spelling of the URL they arrived by.
  const onBlog = isCurrentDestination(pathname, "blog", i18n.languages);
  const githubUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

  return (
    <footer className="relative border-t border-fd-border/60">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-fd-muted-foreground sm:flex-row">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:justify-start">
          <BrandLockup />
          <span className="h-4 w-px bg-fd-border/60" aria-hidden="true" />
          <p>© {new Date().getFullYear()}</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link
            to="/$lang/docs/$"
            params={{ lang, _splat: "" }}
            className="transition-colors hover:text-fd-foreground"
          >
            {t.footerDocs}
          </Link>
          {/* The footer is on every page, so it is where a reader who landed
              deep inside the docs or the blog looks for the other surfaces. */}
          <Link
            to={destinationPath("blog", lang, i18n.defaultLanguage)}
            activeOptions={{ exact: true }}
            aria-current={onBlog ? "page" : undefined}
            className="transition-colors hover:text-fd-foreground"
          >
            {t.navBlog}
          </Link>
          <a
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-fd-foreground"
          >
            {t.footerGithub}
          </a>
          <a
            href={`${githubUrl}/discussions`}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-fd-foreground"
          >
            {t.footerDiscussions}
          </a>
          <a
            href={`${githubUrl}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
            className="transition-colors hover:text-fd-foreground"
          >
            {t.footerLicense}
          </a>
        </nav>
      </div>
    </footer>
  );
}
