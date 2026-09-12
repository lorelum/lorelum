import { Link, useParams } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { getStrings } from '@/shared/i18n/legacy-translations';
import { BrandLockup } from '@/shared/ui/brand-lockup';

/**
 * Global 404. Lives under the home layout so the nav stays usable on
 * unknown routes; the lang param (when present) keeps i18n links coherent.
 */
export function NotFound() {
  const { lang = 'en' } = useParams({ strict: false });
  const t = getStrings(lang);

  return (
    <HomeLayout nav={{ title: <BrandLockup /> }} className="py-32 text-center">
      <div className="flex flex-col items-center gap-4">
        <h1 className="text-6xl font-bold text-fd-muted-foreground">404</h1>
        <h2 className="text-2xl font-semibold">{t.notFoundTitle}</h2>
        <p className="max-w-md text-fd-muted-foreground">{t.notFoundDescription}</p>
        <Link
          to="/$lang"
          params={{ lang }}
          className="mt-4 rounded-lg bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
        >
          {t.backHome}
        </Link>
      </div>
    </HomeLayout>
  );
}
