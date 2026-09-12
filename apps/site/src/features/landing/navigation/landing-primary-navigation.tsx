import { Link } from '@tanstack/react-router';
import { i18n } from '@/shared/i18n/config';
import { getStrings } from '@/shared/i18n/legacy-translations';

/** The central product destinations in the three-zone landing header. */
export function LandingPrimaryNavigation({ lang }: { lang: string }) {
  const homePath = lang === i18n.defaultLanguage ? '/' : `/${lang}`;
  const t = getStrings(lang);

  return (
    <div className="hidden items-center gap-1 md:flex">
      <Link to={homePath} className="landing-navbar__link">
        {t.navHome}
      </Link>
      <Link to="/$lang/docs/$" params={{ lang, _splat: '' }} className="landing-navbar__link">
        {t.navDocs}
      </Link>
    </div>
  );
}
