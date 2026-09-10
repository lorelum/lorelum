import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { flushSync } from 'react-dom';
import { useEffect, useState } from 'react';
import { Button } from '@lorelum/ui/components/button';
import { cn } from '@lorelum/ui/lib/utils';
import { getStrings } from '@/shared/i18n/legacy-translations';

/** Compact theme toggle owned by the site navbar rather than Fumadocs. */
export function ThemeToggle({ lang, className }: { lang: string; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = getStrings(lang);

  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';
  const handleThemeChange = () => {
    const nextTheme = isDark ? 'light' : 'dark';

    // Keep the smooth cross-document transition used by Fumadocs' original
    // control, while retaining a normal fallback for browsers without the API.
    if (document?.startViewTransition) {
      document.startViewTransition(() => flushSync(() => setTheme(nextTheme)));
    } else {
      setTheme(nextTheme);
    }
  };

  return (
    <Button
      type="button"
      aria-label={t.toggleTheme}
      aria-pressed={isDark}
      variant="ghost"
      size="icon-sm"
      className={cn(
        'site-theme-toggle rounded-full p-0 text-fd-foreground transition-[color,background-color] duration-[160ms] ease-out hover:bg-[color-mix(in_oklab,var(--color-fd-primary)_9%,transparent)] hover:text-fd-primary dark:hover:bg-[color-mix(in_oklab,var(--color-fd-primary)_16%,transparent)] dark:hover:text-[color-mix(in_oklab,var(--color-fd-foreground)_72%,var(--color-fd-muted-foreground))] [&_svg]:size-4',
        className,
      )}
      onClick={handleThemeChange}
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
