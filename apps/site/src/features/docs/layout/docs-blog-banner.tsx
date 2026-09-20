import { Link, useLocation } from "@tanstack/react-router";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { destinationOf, destinationPath } from "@/features/landing/navigation/navigation-destination";

/**
 * The blog entry in the docs sidebar.
 *
 * Aligned with the primary navigation: the blog destination is derived from the
 * current pathname, so `aria-current` marks it the same way the header does, and
 * the primary colour is reserved for that state instead of being the link's
 * permanent colour. A link that always wears the current-page colour reads as
 * position feedback while carrying none.
 */
export function DocsBlogBanner({ locale }: { readonly locale: string }) {
  const { pathname } = useLocation();
  const isCurrent = destinationOf(pathname, i18n.languages) === "blog";

  return (
    <Link
      to={destinationPath("blog", locale, i18n.defaultLanguage)}
      aria-current={isCurrent ? "page" : undefined}
      className="mb-2 inline-flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground aria-[current=page]:text-fd-primary"
    >
      {getStrings(locale).navBlog}
    </Link>
  );
}
