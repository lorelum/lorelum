import { Link, useLocation } from "@tanstack/react-router";
import { i18n } from "@/shared/i18n/config";
import { getStrings } from "@/shared/i18n/legacy-translations";
import { destinationOf, destinationPath, type NavigationDestination } from "./navigation-destination";

/**
 * The central product destinations in the three-zone landing header.
 *
 * The current destination is marked with `aria-current="page"` and a text-only
 * active state. That state cannot come from the link's own active check: the href
 * is the canonical unprefixed path (`/blog`) while the reader may be on the
 * prefixed spelling (`/en/blog/…`, which the prefixed routes serve for the
 * default locale too), and the router's check compares href with pathname. The
 * destination is therefore derived from the current pathname, so one page has one
 * answer whichever way its URL is spelled.
 */
export function LandingPrimaryNavigation({ lang }: { lang: string }) {
  const { pathname } = useLocation();
  const t = getStrings(lang);
  const current = destinationOf(pathname, i18n.languages);
  const mark = (destination: NavigationDestination) =>
    current === destination ? ("page" as const) : undefined;

  return (
    <div className="hidden items-center gap-1 md:flex">
      <Link
        to={destinationPath("home", lang, i18n.defaultLanguage)}
        className="landing-navbar__link"
        // `exact` only silences the router's own prefix matching, which marked
        // Home current on `/zh/blog/...` (measured): `/zh` is a prefix of every
        // prefixed page. The mark below is the one that decides.
        activeOptions={{ exact: true }}
        aria-current={mark("home")}
      >
        {t.navHome}
      </Link>
      <Link
        to="/$lang/docs/$"
        params={{ lang, _splat: "" }}
        className="landing-navbar__link"
        activeOptions={{ exact: true }}
        aria-current={mark("docs")}
      >
        {t.navDocs}
      </Link>
      <Link
        to={destinationPath("blog", lang, i18n.defaultLanguage)}
        className="landing-navbar__link"
        activeOptions={{ exact: true }}
        aria-current={mark("blog")}
      >
        {t.navBlog}
      </Link>
    </div>
  );
}
