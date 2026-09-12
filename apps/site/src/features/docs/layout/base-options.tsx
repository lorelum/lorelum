import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { BrandLockup } from "@/shared/ui/brand-lockup";
import { ThemeToggle } from "@/shared/ui/theme-toggle";
import { gitConfig } from "@/shared/config/git";
import { i18n } from "@/shared/i18n/config";

interface BaseOptions {
  /**
   * Show the Fumadocs search trigger in the nav. Marketing landing pages
   * keep the nav clean and hide it; docs pages keep it enabled.
   */
  withSearch?: boolean;
}

/**
 * Shared layout options for both the home and docs layouts.
 *
 * `locale` drives the Fumadocs UI language (via the root provider) and the
 * nav language switcher; it is read from the route params on every page.
 */
export function baseOptions(
  locale: string = i18n.defaultLanguage,
  opts: BaseOptions = {},
): BaseLayoutProps {
  const { withSearch = true } = opts;

  return {
    // Language selection is intentionally kept out of the product navigation.
    i18n: false,
    searchToggle: withSearch ? undefined : { enabled: false },
    nav: {
      title: <BrandLockup />,
    },
    themeSwitch: {
      component: <ThemeToggle lang={locale} />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
