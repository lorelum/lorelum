import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { flushSync } from 'react-dom';
import { useEffect, useState } from 'react';
import { getStrings } from '@/lib/translations';
import './theme-toggle.css';

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
    <button
      type="button"
      aria-label={t.toggleTheme}
      aria-pressed={isDark}
      className={`site-theme-toggle ${className ?? ''}`}
      onClick={handleThemeChange}
    >
      {isDark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </button>
  );
}
