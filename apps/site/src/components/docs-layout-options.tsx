import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BrandLockup } from '@/components/navigation/brand-lockup';
import { ThemeToggle } from '@/components/navigation/theme-toggle';
import { i18n } from '@/lib/i18n';
import { gitConfig } from '@/lib/shared';
import { getStrings } from '@/lib/translations';

/** User-facing names for each locale, used in the nav title suffix. */
const localeNames: Record<string, string> = {
  en: 'English',
  zh: '中文',
};

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
  const localeSuffix = locale === i18n.defaultLanguage ? '' : ` · ${localeNames[locale] ?? locale}`;
  const { withSearch = true } = opts;

  return {
    // Language selection is intentionally kept out of the product navigation.
    i18n: false,
    searchToggle: withSearch ? undefined : { enabled: false },
    nav: {
      title: <BrandLockup suffix={`${getStrings(locale).footerDocs}${localeSuffix}`} />,
    },
    themeSwitch: {
      component: <ThemeToggle lang={locale} />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
