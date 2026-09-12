import { Link } from "@tanstack/react-router";
import { BrandLockup } from "@/shared/ui/brand-lockup";
import { gitConfig } from "@/shared/config/git";
import { getStrings } from "@/shared/i18n/legacy-translations";

export function SiteFooter({ lang }: { lang: string }) {
  const t = getStrings(lang);
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
