import { Link, useLocation } from "@tanstack/react-router";
import { Newspaper } from "lucide-react";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import {
  destinationPath,
  isCurrentDestination,
} from "@/features/landing/navigation/navigation-destination";

/**
 * The blog entry in the docs sidebar.
 *
 * Aligned with the primary navigation: the blog destination is derived from the
 * current pathname, so `aria-current` marks it the same way the header does, and
 * the primary colour is reserved for that state instead of being the link's
 * permanent colour. A link that always wears the current-page colour reads as
 * position feedback while carrying none.
 *
 * The icon follows the sidebar's own convention rather than introducing one: the
 * items above and below get their icons from a lucide name in the page's
 * frontmatter (`icon: Rocket`, resolved by `lucideIconsPlugin`), rendered at
 * `size-4` with the label's own colour — measured on `/zh/docs/quickstart/`: 16×16,
 * `rgb(101,108,115)` beside a muted label and `rgb(22,130,99)` beside the current
 * one, 8px from the text. This row has no frontmatter, so it imports the same
 * family directly and matches those numbers: `size-4`, `gap-2`, `currentColor`
 * (which is what makes it follow the label into the primary state), decorative and
 * therefore `aria-hidden`. The padding is `p-2` rather than the `px-2 py-1.5` it
 * had, so the row is the same height as the items it sits above — measured 6px
 * against their 8px.
 */
export function DocsBlogBanner({ locale }: { readonly locale: string }) {
  const { pathname } = useLocation();
  const isCurrent = isCurrentDestination(pathname, "blog", i18n.languages);

  return (
    <Link
      to={destinationPath("blog", locale, i18n.defaultLanguage)}
      aria-current={isCurrent ? "page" : undefined}
      className="mb-2 inline-flex items-center gap-2 rounded-md p-2 text-sm font-medium text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground aria-[current=page]:text-fd-primary"
    >
      <Newspaper aria-hidden="true" className="size-4 shrink-0" />
      {getStrings(locale).navBlog}
    </Link>
  );
}
