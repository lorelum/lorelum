import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import type { DocsLayoutProps } from "fumadocs-ui/layouts/docs";
import { gitConfig } from "@/shared/config/git";
import { i18n } from "@/shared/i18n/config";
import { DocsNavControls } from "./docs-nav-controls";
import { DocsBlogBanner } from "./docs-blog-banner";
import { DocsBrand } from "./docs-brand";

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

  return {
    i18n: false,
    searchToggle: withSearch ? undefined : { enabled: false },
    nav: {
      // A component rather than a node: the title slot is what fumadocs wraps
      // in its own link, and that link's prefix matching is what claimed the
      // brand was the current page on every prefixed docs page.
      title: DocsBrand,
      url: homeUrl,
    },
    themeSwitch: {
      component: <DocsNavControls locale={locale} />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    sidebar: {
      // Primary-navigation entry so readers inside the docs tree can reach
      // the blog; the banner slot renders above the content page tree. It is a
      // component rather than an inline link because the current-destination
      // state comes from the router's location.
      banner: <DocsBlogBanner locale={locale} />,
    },
  };
}
