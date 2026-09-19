import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { Link } from "@tanstack/react-router";
import { BrandLockup } from "@/shared/ui/brand-lockup";
import { gitConfig } from "@/shared/config/git";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { DocsNavControls } from "./docs-nav-controls";

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
): BaseLayoutProps & Pick<DocsLayoutProps, "sidebar"> {
  const { withSearch = true } = opts;
  const homeUrl = locale === i18n.defaultLanguage ? "/" : `/${locale}`;
  const blogUrl = locale === i18n.defaultLanguage ? "/blog" : `/${locale}/blog`;

  return {
    i18n: false,
    searchToggle: withSearch ? undefined : { enabled: false },
    nav: {
      title: <BrandLockup />,
      url: homeUrl,
    },
    themeSwitch: {
      component: <DocsNavControls locale={locale} />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    sidebar: {
      // Primary-navigation entry so readers inside the docs tree can reach
      // the blog; the banner slot renders above the content page tree.
      banner: (
        <Link
          to={blogUrl}
          className="mb-2 inline-flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-fd-primary transition-colors hover:bg-fd-accent"
        >
          {getStrings(locale).navBlog}
        </Link>
      ),
    },
  };
}
