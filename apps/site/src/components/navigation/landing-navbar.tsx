import { useRef } from 'react';
import { Link } from '@tanstack/react-router';
import { i18n } from '@/lib/i18n';
import { BrandLockup } from './brand-lockup';
import { GitHubLink } from './github-link';
import { LandingPrimaryNavigation } from './landing-primary-navigation';
import { ThemeToggle } from './theme-toggle';
import { useLandingNavbarMorph } from './use-landing-navbar-morph';
import './landing-navbar.css';

const heroId = 'landing-hero';

/**
 * A static three-zone product navigation: brand, primary destinations, and
 * utilities. Scroll behavior is intentionally kept out until the base visual
 * state has been reviewed.
 */
export function LandingNavbar({ lang }: { lang: string }) {
  const homePath = lang === i18n.defaultLanguage ? '/' : `/${lang}`;
  const navRef = useRef<HTMLElement>(null);
  useLandingNavbarMorph(navRef, heroId);

  return (
    <nav ref={navRef} className="landing-navbar fixed inset-x-0 top-0 z-50" aria-label="Main navigation">
      <div className="landing-navbar__panel">
        <div className="landing-navbar__surface" aria-hidden="true" />
        <div className="landing-navbar__content mx-auto grid h-full w-full max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6">
          <div className="justify-self-start">
            <Link
              to={homePath}
              className="cursor-pointer rounded-lg text-fd-foreground transition-opacity hover:opacity-75"
            >
              <BrandLockup />
            </Link>
          </div>

          <LandingPrimaryNavigation lang={lang} />

          <div className="flex items-center justify-self-end gap-1">
            <ThemeToggle lang={lang} />
            <GitHubLink />
          </div>
        </div>
      </div>
    </nav>
  );
}
