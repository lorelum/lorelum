import { Languages } from "lucide-react";
import { Link, useLocation } from "@tanstack/react-router";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";

export function languageSwitchPath(pathname: string, lang: string): string {
  const localePrefix = `/${lang}`;
  const suffix =
    pathname === localePrefix || pathname === `${localePrefix}/`
      ? "/"
      : pathname.startsWith(`${localePrefix}/`)
        ? pathname.slice(localePrefix.length)
        : pathname;

  if (lang === "zh") return suffix === "/" ? "/" : `/en${suffix}`;
  return suffix === "/" ? "/zh" : `/zh${suffix}`;
}

/**
 * Compact site-wide language control. By default it preserves the current page
 * by swapping the locale prefix; a surface that knows better (a blog article,
 * which knows whether its translation is published) passes `href` instead.
 */
export function LanguageToggle({
  lang,
  className,
  href,
}: {
  lang: string;
  className?: string;
  href?: string;
}) {
  const { pathname } = useLocation();
  const targetLanguage = lang === "zh" ? i18n.defaultLanguage : "zh";
  const targetPath = href ?? languageSwitchPath(pathname, lang);
  const targetLabel = targetLanguage === "zh" ? "中文" : "EN";
  const t = getStrings(lang);

  return (
    <Link
      to={targetPath}
      aria-label={`${t.switchTo} ${targetLabel}`}
      className={`site-language-toggle inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-sm font-medium text-fd-foreground transition-[color,background-color] duration-[160ms] ease-out hover:bg-[color-mix(in_oklab,var(--color-fd-primary)_9%,transparent)] hover:text-[var(--site-link)] dark:hover:bg-[color-mix(in_oklab,var(--color-fd-primary)_16%,transparent)] dark:hover:text-[color-mix(in_oklab,var(--color-fd-foreground)_72%,var(--color-fd-muted-foreground))] ${className ?? ""}`}
    >
      <Languages aria-hidden="true" className="size-4" />
      <span>{targetLabel}</span>
    </Link>
  );
}
